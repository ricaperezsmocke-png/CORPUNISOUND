/**
 * radarPedidoMarcado.test.js — "Ya lo pedí": silenciar una fila tres semanas.
 *
 * EL PROBLEMA QUE RESUELVE: el sistema no sabe qué mercancía ya se le pidió al
 * proveedor. Una compra, aquí, es mercancía QUE YA LLEGÓ: se registra y sube la
 * existencia en el acto. No existe el pedido hecho y no recibido. Así que la
 * pantalla de Compras seguiría diciendo "revisar compra" de un producto durante
 * todas las semanas que tarde el proveedor, y la forma de obedecerla es comprar
 * de más y dejar dinero parado en mercancía.
 *
 * DECISIÓN DE VICTOR (2026-09-20): no se captura fecha de entrega ni se monta
 * una bitácora de pedidos con responsable. Se marca la fila como "ya lo pedí" y
 * se silencia TRES SEMANAS. Si a las tres semanas no llegó, vuelve a salir, que
 * es justo cuando conviene volver a mirarla.
 *
 * QUÉ SIGNIFICA SILENCIAR: la fila no desaparece ni se esconde. Deja de
 * presentarse como una compra por hacer y pasa a "observar", diciendo que ya se
 * pidió, quién lo marcó y cuántos días le quedan al silencio. Esconderla del
 * todo sería peor: nadie podría revisar lo que está esperando.
 *
 * LO QUE NO HACE: no registra una compra, no crea una orden, no toca catálogo
 * ni inventario, no sube existencia. Es una nota del Radar sobre sus propias
 * filas. El día que la mercancía llegue de verdad, se recibe por donde se ha
 * recibido siempre.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DIAS_SILENCIO, marcarPedido, quitarMarcaPedido, pedidoVigente, listarPedidosMarcados,
} = require("./radar/pedidosMarcados");
const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
const { clasificarEvidenciaCompra } = require("./radarDemandaReglas");

const HOY = "2026-08-20";
const global = { verTodas: true };
const USUARIO = { id: 7, nombre: "Victor" };

function base() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }],
      ventas: [{ id: 1, fecha: HOY, sucursal_id: 1, estatus: "cerrada" }],
      venta_detalle: [{ id: 1, venta_id: 1, producto_id: 10, cantidad: 10 }],
    },
    inventario: {
      existencias: [{ producto_id: 10, sucursal_id: 1, cantidad_actual: 0, cantidad_minima: 5, cantidad_maxima: 0 }],
      compras: [], compra_detalle: [], traspasos: [],
    },
    "catalogo-productos": {
      productos: [{ id: 10, sku: "CUERDA-01", nombre: "Cuerdas", proveedor_id: 1, activo: true }],
      proveedores: [{ id: 1, nombre: "Proveedor" }],
    },
    crm: { clientes: [] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const expedienteDe = (DB, hoy = HOY) => obtenerEvidenciaCompras(DB, global, { fecha_fin: hoy })
  .productos.find((p) => p.producto.producto_id === 10 && p.sucursal.sucursal_id === 1);

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

test("el silencio dura tres semanas: eso es lo que decidió Victor", () => {
  assert.equal(DIAS_SILENCIO, 21);
});

test("sin marcar, el agotado sale como compra por hacer", () => {
  const DB = base();
  const exp = expedienteDe(DB);
  assert.equal(clasificarEvidenciaCompra(exp).clasificacion, "REVISAR_COMPRA");
  assert.equal(exp.pedido_proveedor.marcado, false);
});

test("al marcarlo, deja de pedirse y dice quién lo marcó y cuánto le queda", () => {
  const DB = base();
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  const exp = expedienteDe(DB);
  assert.equal(exp.pedido_proveedor.marcado, true);
  assert.equal(exp.pedido_proveedor.marcado_por, "Victor");
  assert.equal(exp.pedido_proveedor.fecha_marca, HOY);
  assert.equal(exp.pedido_proveedor.vence, sumarDias(HOY, DIAS_SILENCIO));
  assert.equal(exp.pedido_proveedor.dias_restantes, DIAS_SILENCIO);

  const fallo = clasificarEvidenciaCompra(exp);
  assert.equal(fallo.clasificacion, "OBSERVAR", "ya no es una compra por hacer");
  assert.ok(fallo.razones.includes("PEDIDO_MARCADO_AL_PROVEEDOR"), "y la razón se ve en pantalla");
});

test("sigue apareciendo en la pantalla: se silencia, no se esconde", () => {
  const DB = base();
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  assert.ok(expedienteDe(DB), "el producto se puede seguir consultando");
});

test("el día 20 sigue callado y el día 22 vuelve a pedirse solo", () => {
  const DB = base();
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);

  const dia20 = sumarDias(HOY, 20);
  assert.equal(clasificarEvidenciaCompra(expedienteDe(DB, dia20)).clasificacion, "OBSERVAR");

  const dia22 = sumarDias(HOY, 22);
  const vencido = expedienteDe(DB, dia22);
  assert.equal(vencido.pedido_proveedor.marcado, false, "el silencio caducó");
  assert.equal(clasificarEvidenciaCompra(vencido).clasificacion, "REVISAR_COMPRA");
});

test("se puede quitar la marca si la mercancía llegó antes o se canceló el pedido", () => {
  const DB = base();
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  quitarMarcaPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  const exp = expedienteDe(DB);
  assert.equal(exp.pedido_proveedor.marcado, false);
  assert.equal(clasificarEvidenciaCompra(exp).clasificacion, "REVISAR_COMPRA");
});

test("volver a marcar renueva el plazo desde la fecha nueva", () => {
  const DB = base();
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  const dia10 = sumarDias(HOY, 10);
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, dia10);
  const exp = expedienteDe(DB, dia10);
  assert.equal(exp.pedido_proveedor.fecha_marca, dia10);
  assert.equal(exp.pedido_proveedor.dias_restantes, DIAS_SILENCIO);
  assert.equal(listarPedidosMarcados(DB).length, 1, "no se duplica la marca");
});

test("la marca es de un producto EN UNA tienda, no de todas", () => {
  const DB = base();
  DB.inventario.existencias.push({
    producto_id: 10, sucursal_id: 2, cantidad_actual: 0, cantidad_minima: 5, cantidad_maxima: 0,
  });
  DB.pos.ventas.push({ id: 2, fecha: HOY, sucursal_id: 2, estatus: "cerrada" });
  DB.pos.venta_detalle.push({ id: 2, venta_id: 2, producto_id: 10, cantidad: 10 });

  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  const evidencia = obtenerEvidenciaCompras(DB, global, { fecha_fin: HOY });
  const enPalenque = evidencia.productos.find((p) => p.sucursal.sucursal_id === 2);
  assert.equal(enPalenque.pedido_proveedor.marcado, false, "Palenque sigue necesitándolo");
  assert.equal(clasificarEvidenciaCompra(enPalenque).clasificacion, "REVISAR_COMPRA");
});

test("marcar no toca existencias, ni catálogo, ni registra una compra", () => {
  const DB = base();
  const existenciaAntes = JSON.stringify(DB.inventario.existencias);
  const catalogoAntes = JSON.stringify(DB["catalogo-productos"]);
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  assert.equal(JSON.stringify(DB.inventario.existencias), existenciaAntes);
  assert.equal(JSON.stringify(DB["catalogo-productos"]), catalogoAntes);
  assert.equal(DB.inventario.compras.length, 0, "no inventa una recepción de mercancía");
  assert.equal(DB.inventario.compra_detalle.length, 0);
});

test("no se puede marcar un producto que no existe ni una tienda inventada", () => {
  const DB = base();
  assert.throws(() => marcarPedido(DB, { producto_id: 999, sucursal_id: 1 }, USUARIO, HOY), /producto/i);
  assert.throws(() => marcarPedido(DB, { producto_id: 10, sucursal_id: 99 }, USUARIO, HOY), /sucursal/i);
});

test("pedidoVigente responde lo mismo que ve la pantalla", () => {
  const DB = base();
  assert.equal(pedidoVigente(DB, 10, 1, HOY), null);
  marcarPedido(DB, { producto_id: 10, sucursal_id: 1 }, USUARIO, HOY);
  assert.ok(pedidoVigente(DB, 10, 1, HOY));
  assert.equal(pedidoVigente(DB, 10, 1, sumarDias(HOY, 22)), null);
});
