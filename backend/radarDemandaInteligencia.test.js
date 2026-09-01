const { test } = require("node:test");
const assert = require("node:assert/strict");
const { obtenerEvidenciaCompras, VENTANAS } = require("./radarDemandaInteligencia");

const FIN = "2026-08-20";
const global = { verTodas: true };
const limitada1 = { verTodas: false, sucursalId: 1 };

function demanda(id, cambios = {}) {
  return {
    id, producto_id: 10, sucursal_id: 1, cantidad: 1,
    fecha_registro: "2026-08-20T12:00:00.000Z", cliente_id: null,
    telefono_contacto: "", nombre_contacto: "", motivo_no_venta: "SIN_EXISTENCIA",
    producto_buscado: "", marca_solicitada: "", modelo_solicitado: "",
    variante_solicitada: "", categoria_solicitada: "", ...cambios,
  };
}

function base() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }, { id: 3, nombre: "CEDIS" }],
      ventas: [], venta_detalle: [],
    },
    inventario: { existencias: [], compras: [], compra_detalle: [], traspasos: [] },
    "catalogo-productos": {
      productos: [{ id: 10, sku: "BLX-24", nombre: "Shure BLX24", proveedor_id: 1, activo: true }],
      proveedores: [{ id: 1, nombre: "Configurado" }, { id: 2, nombre: "Proveedor real" }],
    },
    radar_demanda: { registros: [demanda(1)], seguimientos: [], ultimo_id: 1 },
  };
}

function ejecutar(DB, alcance = global) {
  return obtenerEvidenciaCompras(DB, alcance, { fecha_fin: FIN });
}

test("contrato superior no contiene clasificación, score ni recomendación", () => {
  const resultado = ejecutar(base());
  assert.deepEqual(Object.keys(resultado), ["periodo", "productos", "productos_no_manejados", "capacidades"]);
  assert.deepEqual(resultado.periodo.ventanas_dias, VENTANAS);
  assert.equal(resultado.capacidades.pedidos_proveedor_disponibles, false);
  const serializado = JSON.stringify(resultado);
  assert.doesNotMatch(serializado, /clasificacion|score|prioridad|recomendacion|cantidad_sugerida/);
});

test("une catalogado exclusivamente por producto_id y conserva producto inactivo", () => {
  const DB = base();
  DB["catalogo-productos"].productos[0].activo = false;
  DB.radar_demanda.registros.push(demanda(2, { producto_id: 999, producto_buscado: "Shure BLX24" }));
  const resultado = ejecutar(DB);
  assert.equal(resultado.productos.length, 1);
  assert.equal(resultado.productos_no_manejados.length, 0);
  assert.deepEqual(resultado.productos[0].producto, { producto_id: 10, sku: "BLX-24", nombre: "Shure BLX24", producto_activo: false });
  assert.equal(resultado.productos[0].radar["180d"].solicitudes, 1);
});

test("calcula las cinco ventanas Radar con fechas inclusivas", () => {
  const DB = base();
  DB.radar_demanda.registros = [
    demanda(1, { fecha_registro: "2026-08-20T12:00:00Z", cantidad: 1 }),
    demanda(2, { fecha_registro: "2026-08-14T12:00:00Z", cantidad: 2 }),
    demanda(3, { fecha_registro: "2026-07-22T12:00:00Z", cantidad: 3 }),
    demanda(4, { fecha_registro: "2026-06-22T12:00:00Z", cantidad: 4 }),
    demanda(5, { fecha_registro: "2026-05-23T12:00:00Z", cantidad: 5 }),
    demanda(6, { fecha_registro: "2026-02-22T12:00:00Z", cantidad: 6 }),
  ];
  const radar = ejecutar(DB).productos[0].radar;
  assert.deepEqual(VENTANAS.map((d) => radar[`${d}d`].solicitudes), [2, 3, 4, 5, 6]);
  assert.deepEqual(VENTANAS.map((d) => radar[`${d}d`].cantidad_solicitada), [3, 6, 10, 15, 21]);
  assert.deepEqual([radar["180d"].primera_solicitud, radar["180d"].ultima_solicitud], ["2026-02-22", "2026-08-20"]);
});

test("fecha Radar usa el día local de la tienda", () => {
  const DB = base();
  DB.radar_demanda.registros = [demanda(1, { fecha_registro: "2026-08-21T03:00:00.000Z" })];
  assert.equal(ejecutar(DB).productos[0].radar["7d"].ultima_solicitud, "2026-08-20");
});

test("deduplica contactos por cliente, teléfono y nombre; anónimo no cuenta", () => {
  const DB = base();
  DB.radar_demanda.registros = [
    demanda(1, { cliente_id: 8 }), demanda(2, { cliente_id: 8, telefono_contacto: "otro" }),
    demanda(3, { telefono_contacto: " 961 100 " }), demanda(4, { telefono_contacto: "961 100" }),
    demanda(5, { nombre_contacto: " María   López " }), demanda(6, { nombre_contacto: "maría lópez" }),
    demanda(7),
  ];
  assert.equal(ejecutar(DB).productos[0].radar["30d"].contactos_distintos, 3);
});

test("ventas cuenta sólo cerradas, por producto_id y sucursal", () => {
  const DB = base();
  DB.pos.ventas = [
    { id: 1, fecha: "2026-08-20", sucursal_id: 1, estatus: "cerrada" },
    { id: 2, fecha: "2026-08-20", sucursal_id: 1, estatus: "cancelada" },
    { id: 3, fecha: "2026-08-20", sucursal_id: 1, estatus: "apartado" },
    { id: 4, fecha: "2026-08-20", sucursal_id: 2, estatus: "cerrada" },
  ];
  DB.pos.venta_detalle = [
    { id: 1, venta_id: 1, producto_id: 10, cantidad: 6 },
    { id: 2, venta_id: 1, producto_id: null, cantidad: 100 },
    { id: 3, venta_id: 2, producto_id: 10, cantidad: 20 },
    { id: 4, venta_id: 3, producto_id: 10, cantidad: 30 },
    { id: 5, venta_id: 4, producto_id: 10, cantidad: 40 },
  ];
  const ventas = ejecutar(DB).productos[0].ventas;
  assert.deepEqual(VENTANAS.map((d) => ventas[`unidades_${d}d`]), [6, 6, 6, 6, 6]);
  assert.equal(ventas.promedio_diario_observado_30d, 0.2);
  assert.equal(ventas.promedio_diario_observado_90d, 6 / 90);
});

test("ventanas de ventas son inclusivas y separadas", () => {
  const DB = base();
  DB.pos.ventas = [7, 30, 60, 90, 180].map((dias, i) => ({ id: i + 1, fecha: new Date(Date.UTC(2026, 7, 21 - dias)).toISOString().slice(0, 10), sucursal_id: 1, estatus: "cerrada" }));
  DB.pos.venta_detalle = DB.pos.ventas.map((v) => ({ id: v.id, venta_id: v.id, producto_id: 10, cantidad: 1 }));
  const ventas = ejecutar(DB).productos[0].ventas;
  assert.deepEqual(VENTANAS.map((d) => ventas[`unidades_${d}d`]), [1, 2, 3, 4, 5]);
});

test("inventario presente deriva cero, bajo mínimo, sobre máximo y cobertura", () => {
  const DB = base();
  DB.inventario.existencias.push({ producto_id: 10, sucursal_id: 1, cantidad_actual: 0, cantidad_minima: 5, cantidad_maxima: 20 });
  DB.pos.ventas.push({ id: 1, fecha: FIN, sucursal_id: 1, estatus: "cerrada" });
  DB.pos.venta_detalle.push({ id: 1, venta_id: 1, producto_id: 10, cantidad: 30 });
  let inv = ejecutar(DB).productos[0].inventario;
  assert.deepEqual([inv.existencia_registrada, inv.sin_existencia, inv.bajo_minimo, inv.sobre_maximo, inv.cobertura_dias_30d], [true, true, true, false, 0]);
  DB.inventario.existencias[0].cantidad_actual = 25;
  inv = ejecutar(DB).productos[0].inventario;
  assert.deepEqual([inv.sin_existencia, inv.bajo_minimo, inv.sobre_maximo, inv.cobertura_dias_30d], [false, false, true, 25]);
});

test("fila ausente no se convierte en stock cero", () => {
  const expediente = ejecutar(base()).productos[0];
  assert.deepEqual(expediente.inventario, { existencia_registrada: false, cantidad_actual: null, cantidad_minima: null, cantidad_maxima: null, sin_existencia: null, bajo_minimo: null, sobre_maximo: null, cobertura_dias_30d: null });
  assert.ok(expediente.calidad_datos.includes("SIN_FILA_EXISTENCIA"));
});

test("stock negativo se conserva y anula cobertura", () => {
  const DB = base();
  DB.inventario.existencias.push({ producto_id: 10, sucursal_id: 1, cantidad_actual: -3, cantidad_minima: 5, cantidad_maxima: 20 });
  const expediente = ejecutar(DB).productos[0];
  assert.equal(expediente.inventario.cantidad_actual, -3);
  assert.equal(expediente.inventario.cobertura_dias_30d, null);
  assert.ok(expediente.calidad_datos.includes("STOCK_NEGATIVO"));
});

test("mínimo y máximo cero se marcan como no configurados", () => {
  const DB = base();
  DB.inventario.existencias.push({ producto_id: 10, sucursal_id: 1, cantidad_actual: 8, cantidad_minima: 0, cantidad_maxima: 0 });
  const calidad = ejecutar(DB).productos[0].calidad_datos;
  assert.ok(calidad.includes("MINIMO_NO_CONFIGURADO"));
  assert.ok(calidad.includes("MAXIMO_NO_CONFIGURADO"));
});

test("otras sucursales sólo incluye alcance autorizado y calcula excedente matemático", () => {
  const DB = base();
  DB.inventario.existencias.push(
    { producto_id: 10, sucursal_id: 2, cantidad_actual: 8, cantidad_minima: 3, cantidad_maxima: 20 },
    { producto_id: 10, sucursal_id: 3, cantidad_actual: 7, cantidad_minima: 0, cantidad_maxima: 0 },
  );
  const globalParcial = ejecutar(DB, { verTodas: true, sucursalIds: [1, 2] }).productos[0];
  assert.deepEqual(globalParcial.otras_sucursales.map((x) => [x.sucursal_id, x.excedente_matematico_sobre_minimo]), [[2, 5]]);
  const limitada = ejecutar(DB, limitada1).productos[0];
  assert.deepEqual(limitada.otras_sucursales, []);
  const otraMinimoCero = ejecutar(DB).productos[0].otras_sucursales.find((x) => x.sucursal_id === 3);
  assert.deepEqual([otraMinimoCero.excedente_matematico_sobre_minimo, otraMinimoCero.minimo_configurado], [7, false]);
  assert.ok(otraMinimoCero.calidad_datos.includes("MINIMO_NO_CONFIGURADO"));
});

test("traspasos entrantes permanecen separados de existencia", () => {
  const DB = base();
  DB.inventario.existencias.push({ producto_id: 10, sucursal_id: 1, cantidad_actual: 2, cantidad_minima: 5, cantidad_maxima: 20 });
  DB.inventario.traspasos = [
    { id: 1, producto_id: 10, sucursal_destino_id: 1, cantidad: 4, estatus: "en_transito" },
    { id: 2, producto_id: 10, sucursal_destino_id: 1, cantidad: 6, estatus: "en_transito" },
    { id: 3, producto_id: 10, sucursal_destino_id: 1, cantidad: 9, estatus: "recibido" },
  ];
  const expediente = ejecutar(DB).productos[0];
  assert.equal(expediente.inventario.cantidad_actual, 2);
  assert.deepEqual(expediente.traspasos, { cantidad_entrante_en_transito: 10, numero_traspasos_entrantes: 2 });
});

test("compras identifica última recepción y proveedor real distinto del configurado", () => {
  const DB = base();
  DB.inventario.compras = [
    { id: 1, proveedor_id: 1, sucursal_id: 1, fecha: "2026-05-01T12:00:00Z" },
    { id: 2, proveedor_id: 2, sucursal_id: 2, fecha: "2026-08-10T12:00:00Z" },
  ];
  DB.inventario.compra_detalle = [
    { id: 1, compra_id: 1, producto_id: 10, cantidad: 10, costo: 100 },
    { id: 2, compra_id: 2, producto_id: 10, cantidad: 30, costo: 200 },
  ];
  const expediente = ejecutar(DB).productos[0];
  assert.deepEqual(expediente.proveedores, { proveedor_configurado_id: 1, proveedor_configurado_nombre: "Configurado", ultimo_proveedor_recepcion_id: 2, ultimo_proveedor_recepcion_nombre: "Proveedor real" });
  assert.deepEqual([
    expediente.compras_historicas.ultima_recepcion_fecha,
    expediente.compras_historicas.ultima_recepcion_sucursal_id,
    expediente.compras_historicas.ultimo_proveedor_id,
    expediente.compras_historicas.ultimo_costo,
    expediente.compras_historicas.unidades_recibidas_90d,
    expediente.compras_historicas.unidades_recibidas_180d,
    expediente.compras_historicas.costo_promedio_historico_ponderado,
  ], ["2026-08-10", 2, 2, 200, 30, 40, 175]);
});

test("compras fuera del alcance no se filtran hacia usuario limitado", () => {
  const DB = base();
  DB.inventario.compras = [{ id: 1, proveedor_id: 2, sucursal_id: 2, fecha: "2026-08-10T12:00:00Z" }];
  DB.inventario.compra_detalle = [{ id: 1, compra_id: 1, producto_id: 10, cantidad: 30, costo: 200 }];
  const expediente = ejecutar(DB, limitada1).productos[0];
  assert.equal(expediente.compras_historicas.ultima_recepcion_fecha, null);
  assert.ok(expediente.calidad_datos.includes("SIN_HISTORIAL_COMPRAS"));
});

test("sin ventas, compras ni proveedor emite calidad estructurada", () => {
  const DB = base();
  delete DB["catalogo-productos"].productos[0].proveedor_id;
  const calidad = ejecutar(DB).productos[0].calidad_datos;
  for (const codigo of ["SIN_HISTORIAL_VENTAS", "SIN_HISTORIAL_COMPRAS", "PROVEEDOR_NO_IDENTIFICADO", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"]) assert.ok(calidad.includes(codigo));
});

test("candado numerico separa producto libre sin inventar evidencia", () => {
  const DB = base();
  DB.radar_demanda.registros = [
    demanda(1, { producto_id: null, producto_buscado: " Shure  BLX24 ", marca_solicitada: "Shure", cliente_id: 5, sucursal_id: 1 }),
    demanda(2, { producto_id: null, producto_buscado: "shure blx24", marca_solicitada: " shure ", cliente_id: 5, sucursal_id: 2, cantidad: 2 }),
    demanda(3, { producto_id: null, producto_buscado: "Shure BLX24R", marca_solicitada: "Shure", sucursal_id: 2 }),
  ];
  const resultado = ejecutar(DB);
  assert.equal(resultado.productos.length, 0);
  assert.equal(resultado.productos_no_manejados.length, 2);
  assert.deepEqual([resultado.productos_no_manejados[0].solicitudes, resultado.productos_no_manejados[0].cantidad_solicitada, resultado.productos_no_manejados[0].contactos_distintos, resultado.productos_no_manejados[0].sucursales], [2, 3, 1, 2]);
  assert.doesNotMatch(JSON.stringify(resultado.productos_no_manejados), /inventario|ventas|producto_id/);
});

test("inteligencia agrupa texto libre difuso y expone formas contra el lider", () => {
  const DB = base();
  DB.radar_demanda.registros = [
    demanda(1, { producto_id: null, producto_buscado: "amplificador", cliente_id: 1 }),
    demanda(2, { producto_id: null, producto_buscado: "amolificador", cliente_id: 2 }),
    demanda(3, { producto_id: null, producto_buscado: "amplificador", cliente_id: 3 }),
  ];
  const libres = ejecutar(DB).productos_no_manejados;
  assert.equal(libres.length, 1);
  assert.deepEqual([libres[0].producto_solicitado, libres[0].solicitudes, libres[0].formas_distintas], ["amplificador", 3, 2]);
  assert.deepEqual(libres[0].formas, [
    { forma: "amplificador", apariciones: 2, similitud: 1 },
    { forma: "amolificador", apariciones: 1, similitud: 1 },
  ]);
});

test("inteligencia muestra el producto buscado del lider libre", () => {
  const DB = base();
  DB.radar_demanda.registros = [
    demanda(1, { producto_id: null, producto_buscado: "teclado yamaha", marca_solicitada: "yamaha", modelo_solicitado: "sx600" }),
    demanda(2, { producto_id: null, producto_buscado: "teclado yamaha", marca_solicitada: "yamaha", modelo_solicitado: "sx600" }),
  ];
  const libres = ejecutar(DB).productos_no_manejados;
  assert.equal(libres.length, 1);
  assert.equal(libres[0].producto_solicitado, "teclado yamaha");
  assert.equal(libres[0].formas[0].forma, "teclado yamaha yamaha sx600");
});

test("aislamiento limita expedientes y productos libres a la sucursal autorizada", () => {
  const DB = base();
  DB.radar_demanda.registros.push(
    demanda(2, { sucursal_id: 2 }),
    demanda(3, { sucursal_id: 2, producto_id: null, producto_buscado: "Consola" }),
  );
  const limitada = ejecutar(DB, limitada1);
  assert.deepEqual(limitada.productos.map((x) => x.sucursal.sucursal_id), [1]);
  assert.equal(limitada.productos_no_manejados.length, 0);
  const completa = ejecutar(DB);
  assert.deepEqual(completa.productos.map((x) => x.sucursal.sucursal_id), [1, 2]);
  assert.equal(completa.productos_no_manejados.length, 1);
});

test("motor no modifica DB", () => {
  const DB = base();
  DB.inventario.existencias.push({ producto_id: 10, sucursal_id: 1, cantidad_actual: -1, cantidad_minima: 0, cantidad_maxima: 0 });
  const antes = structuredClone(DB);
  ejecutar(DB);
  assert.deepStrictEqual(DB, antes);
});

test("rechaza fecha final imposible", () => {
  assert.throws(() => obtenerEvidenciaCompras(base(), global, { fecha_fin: "2026-02-30" }), /fecha válida/);
});
