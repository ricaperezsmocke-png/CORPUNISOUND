/**
 * radarDatosInvalidos.test.js — Un registro con la fecha dañada podía tumbar
 * la lista entera, y una fecha ilegible se contaba como demanda de HOY.
 *
 * LOS DOS DEFECTOS:
 *
 * 1. `radar/consultas.js` ordenaba con `b.fecha_registro.localeCompare(...)`.
 *    Si un registro tiene `fecha_registro` nula —dato viejo, importación a
 *    medias, cualquier cosa— eso revienta con TypeError y **la tienda pierde
 *    la lista completa**: no es que falte un renglón, es que no carga nada.
 *
 * 2. `diaLocal` cae en HOY cuando la fecha no se puede interpretar. Ese
 *    respaldo es correcto donde nació —una venta de MercadoLibre no se puede
 *    caer por un ISO raro—, pero en el Radar significa que una demanda con la
 *    fecha rota aparece como registrada hoy: infla la demanda reciente y
 *    ensucia justo la cifra que se mira para comprar.
 *
 * LA REGLA EN EL RADAR: una fecha que no se entiende no se inventa. El
 * registro no entra en ninguna ventana temporal, sigue existiendo y se puede
 * ver, y no arrastra al resto. `backend/fechas.js` NO se toca: lo comparten
 * ventas, cortes y gastos, y ahí el respaldo a hoy sí es lo correcto.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listarDemandas, obtenerAnalisis } = require("./radarDemanda");
const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
const { fechaLocal } = require("./fechas");

const HOY = "2026-08-20";
// El respaldo de `diaLocal` cae en el día REAL de ejecución, no en una fecha
// inventada. Para comprobar que una fecha rota se cuela "como hoy" hay que
// mirar el periodo de hoy de verdad: con una fecha fija la prueba pasaría por
// la razón equivocada.
const HOY_REAL = fechaLocal();
const global = { verTodas: true };

function registro(id, extra = {}) {
  return {
    id, sucursal_id: 1, usuario_id: 1, cliente_id: null, producto_id: null,
    producto_buscado: `Articulo ${id}`, cantidad: 1, motivo_no_venta: "NO_MANEJAMOS",
    estado: "REGISTRADA", fecha_registro: `${HOY}T12:00:00Z`,
    fecha_actualizacion: `${HOY}T12:00:00Z`, venta_recuperada_id: null,
    requiere_seguimiento: false, notas: "", ...extra,
  };
}

function base(registros) {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }], ventas: [], venta_detalle: [] },
    inventario: { existencias: [], compras: [], compra_detalle: [], traspasos: [] },
    "catalogo-productos": { productos: [], proveedores: [] },
    crm: { clientes: [] },
    admin: { usuarios: [{ id: 1, nombre: "Ana", activo: true, sucursal_id: 1 }] },
    radar_demanda: { registros, seguimientos: [], ultimo_id: 99, ultimo_seguimiento_id: 0 },
  };
}

test("una fecha NULA no tumba la lista: la tienda sigue viendo sus demandas", () => {
  const DB = base([registro(1), registro(2, { fecha_registro: null }), registro(3)]);
  const lista = listarDemandas(DB, global, {});
  assert.equal(lista.length, 3, "los tres registros siguen ahí, ninguno desaparece");
});

test("tampoco la tumba una fecha ausente ni uno con fecha de texto basura", () => {
  const DB = base([
    registro(1),
    registro(2, { fecha_registro: undefined }),
    registro(3, { fecha_registro: "fecha-rota" }),
    registro(4, { fecha_registro: 12345 }),
  ]);
  const lista = listarDemandas(DB, global, {});
  assert.equal(lista.length, 4);
});

test("una fecha ilegible NO se cuenta como demanda de hoy en el análisis", () => {
  const DB = base([
    registro(1, { fecha_registro: `${HOY_REAL}T12:00:00Z` }),
    registro(2, { fecha_registro: "fecha-rota" }),
  ]);
  const analisis = obtenerAnalisis(DB, global, { fecha_inicio: HOY_REAL, fecha_fin: HOY_REAL });
  assert.equal(analisis.resumen.total, 1, "solo la demanda con fecha de verdad cuenta en el periodo");
});

test("una fecha nula tampoco se cuela en el periodo de hoy", () => {
  const DB = base([
    registro(1, { fecha_registro: `${HOY_REAL}T12:00:00Z` }),
    registro(2, { fecha_registro: null }),
  ]);
  const analisis = obtenerAnalisis(DB, global, { fecha_inicio: HOY_REAL, fecha_fin: HOY_REAL });
  assert.equal(analisis.resumen.total, 1);
});

test("las fechas válidas se siguen contando exactamente igual", () => {
  const DB = base([registro(1), registro(2), registro(3)]);
  const analisis = obtenerAnalisis(DB, global, { fecha_inicio: HOY, fecha_fin: HOY });
  assert.equal(analisis.resumen.total, 3);
});

test("la evidencia de Compras no revienta ni infla con fechas dañadas", () => {
  const DB = base([
    registro(1, { producto_id: null, fecha_registro: `${HOY_REAL}T12:00:00Z` }),
    registro(2, { fecha_registro: null }),
    registro(3, { fecha_registro: "fecha-rota" }),
  ]);
  const evidencia = obtenerEvidenciaCompras(DB, global, { fecha_fin: HOY_REAL });
  assert.ok(evidencia, "la consulta responde en vez de caerse");
  // Las tres son texto libre sin producto; solo la de fecha buena es demanda
  // reciente utilizable para orientar una compra.
  const solicitudes = evidencia.productos_no_manejados.reduce((s, x) => s + x.solicitudes, 0);
  assert.equal(solicitudes, 1, "las dos de fecha dañada no cuentan como demanda del periodo");
});

test("consultar no modifica la base: una fecha dañada sigue dañada después de leer", () => {
  const DB = base([registro(1, { fecha_registro: null })]);
  listarDemandas(DB, global, {});
  obtenerAnalisis(DB, global, { fecha_inicio: HOY, fecha_fin: HOY });
  assert.equal(DB.radar_demanda.registros[0].fecha_registro, null, "leer no repara ni inventa datos");
});
