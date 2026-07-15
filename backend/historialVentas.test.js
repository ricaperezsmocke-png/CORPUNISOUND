const { test } = require("node:test");
const assert = require("node:assert");
const { parsearReporteVentasSicar } = require("./historialVentas");
const { construirDBPrueba } = require("./testHelpers");
const { previsualizarHistorialVentas, aplicarHistorialVentas } = require("./historialVentas");

// Fragmento sintético que replica la estructura real confirmada del
// "Reporte General de Ventas" de SICAR (5 líneas de encabezado/filtros,
// luego renglones de Ticket/Nota de Venta seguidos de sus renglones de
// producto). NO son datos reales del negocio.
function reporteSicarSintetico(lineasDeDatos) {
  const encabezado = [
    "Reporte General de Ventas,,,,,,,,,,,Periodo:,,,01/01/2018 0:00,,,,,,-,,,15/07/2026 23:59,,,",
    "Documento:,, Todos,,,,,,,,,,,,,,,,,Detalle:,,,,,,, Si",
    "Cliente:,, Todos,,,,,,,,Estado:,, Vigente,,,,,,,Orden:,,,,,,, Fecha",
    "Vendedor:,, Todos,,,,,,,,Usuario:,, Todos,,,,,,,Caja:,,,,, Todas,,",
    "Documento,,,Fecha,,Folio,Cliente,,,Caja,,,,Usuario,,,,,Folio F.,,,Est,,,,Total   ,",
  ];
  return [...encabezado, ...lineasDeDatos].join("\n");
}

test("parsearReporteVentasSicar agrega un ticket con una linea de producto", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 785.58,",
    "PZA,2.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 30.04,,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(resumen.tickets_leidos, 1);
  assert.strictEqual(resumen.renglones_leidos, 1);
  assert.strictEqual(resumen.fecha_min, "2018-01-03");
  assert.strictEqual(resumen.fecha_max, "2018-01-03");
  assert.strictEqual(agregados.length, 1);
  assert.strictEqual(agregados[0].clave, "2X18BICO");
  assert.strictEqual(agregados[0].periodo, "2018-01");
  assert.strictEqual(agregados[0].cantidad, 2);
});

test("parsearReporteVentasSicar suma varias lineas de la misma clave en el mismo mes", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 30.04,",
    "PZA,2.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 30.04,,,,",
    "Ticket,,,15/01/2018,,32240,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,TOÑO,,,,,331,,,V,,,,$ 45.06,",
    "PZA,3.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 45.06,,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(resumen.tickets_leidos, 2);
  assert.strictEqual(agregados.length, 1, "misma clave y mismo mes debe quedar en un solo renglon agregado");
  assert.strictEqual(agregados[0].cantidad, 5);
});

test("parsearReporteVentasSicar separa la misma clave en meses distintos", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 15.02,",
    "PZA,1.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 15.02,,,,",
    "Ticket,,,10/02/2018,,32300,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,TOÑO,,,,,331,,,V,,,,$ 15.02,",
    "PZA,1.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 15.02,,,,",
  ]);
  const { agregados } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 2);
  const periodos = agregados.map((a) => a.periodo).sort();
  assert.deepStrictEqual(periodos, ["2018-01", "2018-02"]);
});

test("parsearReporteVentasSicar reconoce Nota de Venta igual que Ticket", () => {
  const csv = reporteSicarSintetico([
    'Nota de Venta,,,03/01/2018,,770,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,YADY,,,,,,,,V,,,,"$ 5,813.89",',
    "PZA,1.0000,,,[QX1622USB] MEZCLADORA BEHRINGER DE 12 CH,,,,,,,,,,,\"$ 5,483.29\",,,,,,,\"$ 5,483.29\",,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(resumen.tickets_leidos, 1);
  assert.strictEqual(agregados[0].clave, "QX1622USB");
});

test("parsearReporteVentasSicar reconoce unidades distintas a PZA", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,1,PUBLICO EN GENERAL,,,Caja 1,,,,X,,,,,1,,,V,,,,$ 100.00,",
    "METRO,5.0000,,,[CABLE-M] CABLE POR METRO,,,,,,,,,,,$ 20.00,,,,,,,$ 100.00,,,,",
  ]);
  const { agregados } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 1);
  assert.strictEqual(agregados[0].clave, "CABLE-M");
  assert.strictEqual(agregados[0].cantidad, 5);
});

test("parsearReporteVentasSicar ignora renglones fuera de un ticket (encabezado del reporte)", () => {
  const csv = reporteSicarSintetico([]); // solo las 5 lineas de encabezado, sin ningun ticket
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 0);
  assert.strictEqual(resumen.tickets_leidos, 0);
});

test("parsearReporteVentasSicar truena con mensaje claro si no hay ningun ticket en todo el archivo", () => {
  assert.throws(
    () => parsearReporteVentasSicar("esto,no,es,un,reporte,de,sicar"),
    /no se pudo leer como reporte de ventas de SICAR/
  );
});

test("parsearReporteVentasSicar ignora una linea de producto con cantidad no numerica sin tronar", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,1,PUBLICO EN GENERAL,,,Caja 1,,,,X,,,,,1,,,V,,,,$ 0.00,",
    "PZA,N/A,,,[ABC123] PRODUCTO CON CANTIDAD RARA,,,,,,,,,,,$ 0.00,,,,,,,$ 0.00,,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 0);
  assert.strictEqual(resumen.tickets_leidos, 1);
});

test("previsualizarHistorialVentas cuenta claves reconocidas y no reconocidas", () => {
  const DB = construirDBPrueba(); // AB-001, BE-001, LI-001 existen
  const agregados = [
    { clave: "AB-001", periodo: "2020-01", cantidad: 10 },
    { clave: "NO-EXISTE-YA", periodo: "2020-01", cantidad: 5 },
  ];
  const resultado = previsualizarHistorialVentas(DB, agregados);
  assert.strictEqual(resultado.claves_reconocidas, 1);
  assert.strictEqual(resultado.claves_ignoradas, 1);
  assert.strictEqual(resultado.total_renglones_agregados, 2);
});

test("aplicarHistorialVentas crea renglones nuevos en DB.pos.historial_ventas_mensual", () => {
  const DB = construirDBPrueba();
  const agregados = [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }];
  const resultado = aplicarHistorialVentas(DB, agregados, 1);
  assert.strictEqual(resultado.producto_id_actualizados, 1);
  assert.strictEqual(resultado.renglones_aplicados, 1);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 1);
  assert.deepStrictEqual(DB.pos.historial_ventas_mensual[0], { producto_id: 1, sucursal_id: 1, periodo: "2020-01", cantidad: 25 });
});

test("aplicarHistorialVentas ignora claves que no coinciden con ningun producto, sin tronar", () => {
  const DB = construirDBPrueba();
  const agregados = [{ clave: "NO-EXISTE-YA", periodo: "2020-01", cantidad: 5 }];
  const resultado = aplicarHistorialVentas(DB, agregados, 1);
  assert.strictEqual(resultado.renglones_aplicados, 0);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 0);
});

test("aplicarHistorialVentas reimportado reemplaza el valor, no lo suma encima", () => {
  const DB = construirDBPrueba();
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }], 1);
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 40 }], 1);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 1, "no debe crear un segundo renglon para la misma combinacion");
  assert.strictEqual(DB.pos.historial_ventas_mensual[0].cantidad, 40);
});

test("aplicarHistorialVentas distingue la misma clave y mes en sucursales distintas", () => {
  const DB = construirDBPrueba();
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }], 1);
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 60 }], 2);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 2);
});

test("aplicarHistorialVentas nunca toca DB.pos.ventas ni DB.pos.venta_detalle", () => {
  const DB = construirDBPrueba();
  const ventasAntes = JSON.stringify(DB.pos.ventas);
  const detalleAntes = JSON.stringify(DB.pos.venta_detalle);
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }], 1);
  assert.strictEqual(JSON.stringify(DB.pos.ventas), ventasAntes);
  assert.strictEqual(JSON.stringify(DB.pos.venta_detalle), detalleAntes);
});
