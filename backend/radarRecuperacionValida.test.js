/**
 * radarRecuperacionValida.test.js — Una venta CANCELADA podía cerrar una
 * demanda como "recuperada".
 *
 * EL DEFECTO: ni la lista de ventas candidatas (`radar/consultas.js`) ni la
 * validación al vincular (`validarVenta` en `radarDemanda.js`) miraban el
 * estatus de la venta. Solo comprobaban la sucursal y que esa venta no
 * estuviera ya usada en otra demanda. Una venta cancelada aparecía en el
 * selector y se podía vincular.
 *
 * QUÉ LE CUESTA A VICTOR: ve una recuperación que no ocurrió —dinero que
 * nadie pagó— y, peor para compras, esa necesidad desaparece de la lista de
 * pendientes: el producto deja de pedirse porque el sistema cree que ya se
 * vendió.
 *
 * Y LA OTRA MITAD: una venta puede cancelarse DESPUÉS de haberse vinculado.
 * El reporte volvía a sumarla sin comprobar nada, así que la recuperación
 * seguía contando aunque la venta ya no existiera como tal.
 *
 * LA REGLA: una venta cancelada no acredita nada, ni al vincular ni al leer.
 * No se inventa más política que esa: una venta cerrada y un apartado vivo
 * siguen sirviendo como hasta hoy, porque en los dos casos el cliente sí
 * volvió. Cancelar una venta ya vinculada tampoco reabre la demanda sola:
 * deja de acreditarse el importe y queda a la vista.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listarVentasCandidatas } = require("./radar/consultas");
const { obtenerAnalisis, cambiarEstado } = require("./radarDemanda");

const HOY = "2026-08-20";
const global = { verTodas: true };

function base() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      ventas: [
        { id: 1, fecha: HOY, sucursal_id: 1, estatus: "cerrada", total: 500, cliente_id: 1 },
        { id: 2, fecha: HOY, sucursal_id: 1, estatus: "cancelada", total: 500, cliente_id: 1 },
      ],
      venta_detalle: [],
    },
    inventario: { existencias: [], compras: [], compra_detalle: [], traspasos: [] },
    "catalogo-productos": { productos: [{ id: 10, sku: "G-1", nombre: "Guitarra", activo: true }], proveedores: [] },
    crm: { clientes: [{ id: 1, nombre: "Cliente", sucursal_id: 1 }] },
    admin: { usuarios: [{ id: 1, nombre: "Ana", activo: true, sucursal_id: 1 }] },
    radar_demanda: {
      registros: [{
        id: 1, sucursal_id: 1, producto_id: 10, cantidad: 1, estado: "REGISTRADA",
        fecha_registro: `${HOY}T12:00:00Z`, motivo_no_venta: "SIN_EXISTENCIA",
        producto_buscado: "Guitarra", venta_recuperada_id: null,
      }],
      seguimientos: [], ultimo_id: 1, ultimo_seguimiento_id: 0,
    },
  };
}

const demandaDe = (DB) => DB.radar_demanda.registros[0];

test("una venta cancelada NO se ofrece como candidata para cerrar la demanda", () => {
  const DB = base();
  const candidatas = listarVentasCandidatas(DB, demandaDe(DB), {});
  const ids = candidatas.map((v) => Number(v.id));
  assert.ok(ids.includes(1), "la venta cerrada sí es candidata");
  assert.ok(!ids.includes(2), "la cancelada no tiene nada que hacer en el selector");
});

test("vincular una venta cancelada a mano se rechaza, no solo se esconde en la pantalla", () => {
  const DB = base();
  assert.throws(
    () => cambiarEstado(DB, 1, "CONVERTIDA", { venta_recuperada_id: 2 }, global, 1),
    /cancelada|no encontrada|no vá?lida/i
  );
  assert.equal(demandaDe(DB).estado, "REGISTRADA", "la demanda sigue viva");
  assert.equal(demandaDe(DB).venta_recuperada_id, null);
});

test("vincular la venta CERRADA sigue funcionando igual que siempre", () => {
  const DB = base();
  cambiarEstado(DB, 1, "CONVERTIDA", { venta_recuperada_id: 1 }, global, 1);
  assert.equal(demandaDe(DB).estado, "CONVERTIDA");
  assert.equal(Number(demandaDe(DB).venta_recuperada_id), 1);
});

test("si la venta se cancela DESPUÉS de vincularse, deja de contar como recuperada", () => {
  const DB = base();
  cambiarEstado(DB, 1, "CONVERTIDA", { venta_recuperada_id: 1 }, global, 1);
  const antes = obtenerAnalisis(DB, global, { fecha_inicio: HOY, fecha_fin: HOY });
  assert.equal(antes.recuperacion.ventas_recuperadas, 1, "mientras la venta vive, cuenta");

  DB.pos.ventas.find((v) => v.id === 1).estatus = "cancelada";
  const despues = obtenerAnalisis(DB, global, { fecha_inicio: HOY, fecha_fin: HOY });
  assert.equal(despues.recuperacion.ventas_recuperadas, 0, "cancelada ya no acredita recuperación");
  assert.equal(despues.recuperacion.valor_recuperado, 0);
});
