const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearGarantia, marcarEnviada, registrarResolucion } = require("./garantias");
const { reporteGastosGarantias } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

/**
 * Siembra gastos con fecha controlada (no usa agregarGasto, que estampa
 * new Date()) para que las pruebas de rango de fechas sean deterministas.
 */
function sembrarGasto(DB, garantiaId, { tipo, monto, fecha, descripcion = "", archivo = false }) {
  const id = DB.inventario.garantia_gastos.length + 1;
  DB.inventario.garantia_gastos.push({
    id,
    garantia_id: garantiaId,
    tipo,
    monto,
    descripcion,
    nombre_archivo: archivo ? "factura.pdf" : null,
    drive_file_id: archivo ? `file-${id}` : null,
    drive_link: archivo ? `https://drive.google.com/file/d/file-${id}/view` : null,
    usuario: "Victor",
    fecha,
  });
}

/** Dos garantías en sucursales distintas (1 Ocosingo, 2 Yajalón) con gastos. */
function escenario() {
  const DB = construirDBPrueba();
  const g1 = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // Ocosingo, Arroz 1kg
  const g2 = crearGarantia(DB, { producto_id: 2 }, 2, USUARIO); // Yajalón, Refresco 600ml
  sembrarGasto(DB, g1.id, { tipo: "traslado", monto: 150, fecha: "2026-07-10T12:00:00.000Z" });
  sembrarGasto(DB, g1.id, { tipo: "reparacion", monto: 500, fecha: "2026-07-15T12:00:00.000Z", descripcion: "Cambio de pastilla", archivo: true });
  sembrarGasto(DB, g2.id, { tipo: "traslado", monto: 200, fecha: "2026-07-20T12:00:00.000Z" });
  sembrarGasto(DB, g2.id, { tipo: "otro", monto: 75.5, fecha: "2026-08-02T12:00:00.000Z" });
  return { DB, g1, g2 };
}

test("reporteGastosGarantias: lista todos los gastos y suma el total", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-08-31" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 4);
  assert.strictEqual(r.totales.numero_gastos, 4);
  assert.strictEqual(r.totales.total, 150 + 500 + 200 + 75.5);
  assert.strictEqual(r.totales.numero_garantias, 2, "los 4 gastos vienen de 2 garantías distintas");
  assert.strictEqual(r.totales.numero_sin_comprobante, 3, "solo uno de los 4 trae comprobante");
});

test("reporteGastosGarantias: enriquece cada renglón con folio, sucursal, producto y etiqueta", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  const reparacion = r.general.find((f) => f.tipo === "reparacion");
  assert.strictEqual(reparacion.folio, "G-0001");
  assert.strictEqual(reparacion.sucursal_nombre, "Ocosingo");
  assert.strictEqual(reparacion.producto_nombre, "Arroz 1kg");
  assert.strictEqual(reparacion.tipo_etiqueta, "Reparación");
  assert.strictEqual(reparacion.descripcion, "Cambio de pastilla");
  assert.ok(reparacion.drive_link, "el gasto con comprobante conserva su link de Drive");
  assert.strictEqual(reparacion.fecha, "2026-07-15", "la fecha se recorta a YYYY-MM-DD");

  const traslado = r.general.find((f) => f.sucursal_nombre === "Yajalón");
  assert.strictEqual(traslado.folio, "G-0002");
  assert.strictEqual(traslado.producto_nombre, "Refresco 600ml");
  assert.strictEqual(traslado.drive_link, null, "sin comprobante ⇒ link null");
});

test("reporteGastosGarantias: el general viene ordenado por fecha ascendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  const fechas = r.general.map((f) => f.fecha);
  assert.deepStrictEqual(fechas, [...fechas].sort((a, b) => a.localeCompare(b)));
});

test("reporteGastosGarantias: respeta el rango de fechas", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 3, "el gasto de agosto queda fuera");
  assert.strictEqual(r.totales.total, 150 + 500 + 200);
});

test("reporteGastosGarantias: incluye los gastos del último día del rango (fecha ISO recortada)", () => {
  const { DB } = escenario();
  // El gasto de reparación es 2026-07-15T12:00:00.000Z. Sin recortar la hora,
  // "2026-07-15T12:00..." > "2026-07-15" y el renglón se perdería.
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-15", fecha_fin: "2026-07-15" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].monto, 500);
});

test("reporteGastosGarantias: filtra por tipo", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { tipo: "traslado" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 2);
  assert.strictEqual(r.totales.total, 150 + 200);
  assert.ok(r.general.every((f) => f.tipo === "traslado"));
});

test("reporteGastosGarantias: agrupa por tipo ordenado por total descendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.porTipo.map((f) => f.tipo), ["reparacion", "traslado", "otro"]);
  const traslado = r.porTipo.find((f) => f.tipo === "traslado");
  assert.strictEqual(traslado.numero_gastos, 2);
  assert.strictEqual(traslado.total, 350);
  assert.strictEqual(traslado.tipo_etiqueta, "Traslado");
});

test("reporteGastosGarantias: agrupa por sucursal ordenado por total descendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Ocosingo", "Yajalón"]);
  assert.strictEqual(r.porSucursal[0].total, 650);
  assert.strictEqual(r.porSucursal[0].numero_gastos, 2);
  assert.strictEqual(r.porSucursal[1].total, 275.5);
});

test("reporteGastosGarantias: un usuario amarrado solo ve los gastos de SU sucursal", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, { verTodas: false, sucursalId: 2 });

  assert.strictEqual(r.general.length, 2, "solo los 2 gastos de la garantía de Yajalón");
  assert.strictEqual(r.totales.total, 275.5);
  assert.ok(r.general.every((f) => f.sucursal_nombre === "Yajalón"));
  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Yajalón"]);
});

test("reporteGastosGarantias: un gasto huérfano (sin garantía existente) nunca se cuela", () => {
  const { DB } = escenario();
  sembrarGasto(DB, 999, { tipo: "otro", monto: 10000, fecha: "2026-07-11T12:00:00.000Z" });

  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 4, "el gasto huérfano se ignora");
  assert.strictEqual(r.totales.total, 150 + 500 + 200 + 75.5);
});

test("reporteGastosGarantias: sin gastos regresa estructura vacía en ceros", () => {
  const DB = construirDBPrueba();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.general, []);
  assert.deepStrictEqual(r.porTipo, []);
  assert.deepStrictEqual(r.porSucursal, []);
  assert.strictEqual(r.totales.numero_gastos, 0);
  assert.strictEqual(r.totales.numero_garantias, 0);
  assert.strictEqual(r.totales.total, 0);
  assert.strictEqual(r.totales.numero_sin_comprobante, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fase 3: resolución/estado, desglose y filtro por proveedor, filtro de
// gastos sin comprobante.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escenario con proveedores y resoluciones REALES (pasando por marcarEnviada +
 * registrarResolucion, no fijando los campos a mano) para que los estados que
 * se prueban sean estados que la máquina de estados puede producir de verdad.
 *
 *   G-0001  Ocosingo   prov 1  RECHAZADA (cerrada)  -> gasto 300  = pérdida
 *   G-0002  Ocosingo   prov 2  NOTA DE CRÉDITO      -> gasto 100  = NO es pérdida
 *   G-0003  Yajalón    prov 1  aún ENVIADA          -> gasto 50   = en riesgo
 *   G-0004  Yajalón    sin proveedor  registrada    -> gasto 25 con comprobante
 */
function escenarioFase3() {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].proveedores.push(
    { id: 1, nombre: "Distribuidora Musical", rfc: "DMU010101AAA" },
    { id: 2, nombre: "Yamaha México", rfc: "YAM020202BBB" },
  );

  const g1 = crearGarantia(DB, { producto_id: 1, proveedor_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g1.id, { destino_tipo: "proveedor", destino_nombre: "Distribuidora Musical" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g1.id, { tipo_resolucion: "rechazada", notas: "Mal uso" }, USUARIO, ALCANCE_TODAS);

  const g2 = crearGarantia(DB, { producto_id: 1, proveedor_id: 2 }, 1, USUARIO);
  marcarEnviada(DB, g2.id, { destino_tipo: "proveedor", destino_nombre: "Yamaha México" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g2.id, { tipo_resolucion: "nota_credito", notas: "Reembolso" }, USUARIO, ALCANCE_TODAS);

  const g3 = crearGarantia(DB, { producto_id: 2, proveedor_id: 1 }, 2, USUARIO);
  marcarEnviada(DB, g3.id, { destino_tipo: "cedis", destino_nombre: "CEDIS" }, USUARIO, ALCANCE_TODAS);

  const g4 = crearGarantia(DB, { producto_id: 2 }, 2, USUARIO);

  sembrarGasto(DB, g1.id, { tipo: "traslado", monto: 300, fecha: "2026-07-10T12:00:00.000Z" });
  sembrarGasto(DB, g2.id, { tipo: "reparacion", monto: 100, fecha: "2026-07-11T12:00:00.000Z" });
  sembrarGasto(DB, g3.id, { tipo: "traslado", monto: 50, fecha: "2026-07-12T12:00:00.000Z" });
  sembrarGasto(DB, g4.id, { tipo: "otro", monto: 25, fecha: "2026-07-13T12:00:00.000Z", archivo: true });
  return { DB, g1, g2, g3, g4 };
}

test("Fase 3: cada renglón trae estado, resolución y proveedor con sus etiquetas", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  const rechazada = r.general.find((f) => f.folio === "G-0001");
  assert.strictEqual(rechazada.estado, "cerrada");
  assert.strictEqual(rechazada.estado_etiqueta, "Cerrada");
  assert.strictEqual(rechazada.tipo_resolucion, "rechazada");
  assert.strictEqual(rechazada.resolucion_etiqueta, "Rechazada (no procede)");
  assert.strictEqual(rechazada.proveedor_nombre, "Distribuidora Musical");

  const abierta = r.general.find((f) => f.folio === "G-0003");
  assert.strictEqual(abierta.estado, "enviada");
  assert.strictEqual(abierta.estado_etiqueta, "Enviada");
  assert.strictEqual(abierta.tipo_resolucion, null, "una garantía sin resolver no inventa resolución");
  assert.strictEqual(abierta.resolucion_etiqueta, "—");

  const sinProveedor = r.general.find((f) => f.folio === "G-0004");
  assert.strictEqual(sinProveedor.proveedor_nombre, "Sin proveedor");
});

test("Fase 3: total_rechazado suma SOLO los gastos de garantías rechazadas", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.strictEqual(r.totales.total, 300 + 100 + 50 + 25);
  assert.strictEqual(r.totales.total_rechazado, 300, "solo el gasto de G-0001 (rechazada) es pérdida");
});

test("Fase 3: una nota de crédito NO cuenta como pérdida", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  const notaCredito = r.general.find((f) => f.folio === "G-0002");

  assert.strictEqual(notaCredito.tipo_resolucion, "nota_credito");
  assert.ok(!String(r.totales.total_rechazado).includes("100"), "los $100 de la nota de crédito no entran a total_rechazado");
  assert.strictEqual(r.totales.total_rechazado, 300);
});

test("Fase 3: total_sin_resolver suma los gastos de garantías que siguen abiertas", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  // G-0003 (enviada, $50) y G-0004 (registrada, $25) no están cerradas.
  assert.strictEqual(r.totales.total_sin_resolver, 75);
});

test("Fase 3: filtra por proveedor_id", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, { proveedor_id: 1 }, ALCANCE_TODAS);

  assert.deepStrictEqual(r.general.map((f) => f.folio).sort(), ["G-0001", "G-0003"]);
  assert.strictEqual(r.totales.total, 350);
});

test("Fase 3: agrupa por proveedor, con renglón propio para los que no tienen", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(
    r.porProveedor.map((f) => [f.proveedor, f.numero_gastos, f.total]),
    [["Distribuidora Musical", 2, 350], ["Yamaha México", 1, 100], ["Sin proveedor", 1, 25]],
    "ordenado por total descendente"
  );
});

test("Fase 3: sin_comprobante deja solo los gastos sin comprobante", () => {
  const { DB } = escenarioFase3();
  const r = reporteGastosGarantias(DB, { sin_comprobante: "1" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 3, "el único con comprobante (G-0004) queda fuera");
  assert.ok(r.general.every((f) => f.drive_link === null));
  assert.strictEqual(r.totales.total, 450);
  assert.strictEqual(r.totales.numero_sin_comprobante, 3);
});

test("Fase 3: sin_comprobante en 'false'/'0'/'' NO filtra nada (trampa del query string)", () => {
  const { DB } = escenarioFase3();
  // Un query param llega SIEMPRE como string: con un `if (sin_comprobante)`
  // pelón, "false" y "0" son verdaderos y filtrarían sin que nadie lo pidiera.
  for (const valor of ["false", "0", ""]) {
    const r = reporteGastosGarantias(DB, { sin_comprobante: valor }, ALCANCE_TODAS);
    assert.strictEqual(r.general.length, 4, `sin_comprobante="${valor}" no debe filtrar`);
  }
  for (const valor of ["1", "true"]) {
    const r = reporteGastosGarantias(DB, { sin_comprobante: valor }, ALCANCE_TODAS);
    assert.strictEqual(r.general.length, 3, `sin_comprobante="${valor}" sí debe filtrar`);
  }
});

test("Fase 3: los filtros nuevos respetan el alcance de sucursal", () => {
  const { DB } = escenarioFase3();
  // Gerente amarrado a Yajalón (2). El proveedor 1 tiene gastos en AMBAS
  // sucursales; solo debe ver el de la suya.
  const r = reporteGastosGarantias(DB, { proveedor_id: 1 }, { verTodas: false, sucursalId: 2 });

  assert.deepStrictEqual(r.general.map((f) => f.folio), ["G-0003"]);
  assert.strictEqual(r.totales.total, 50);
  assert.deepStrictEqual(r.porProveedor.map((f) => f.proveedor), ["Distribuidora Musical"]);
  assert.strictEqual(r.totales.total_rechazado, 0, "la garantía rechazada es de Ocosingo, no debe filtrarse aquí");
});
