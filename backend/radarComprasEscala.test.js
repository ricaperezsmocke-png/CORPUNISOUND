/**
 * radarComprasEscala.test.js — Que la pantalla de Compras siga siendo usable
 * con el catálogo real de la cadena.
 *
 * LO QUE PASÓ: al hacer que Compras vea también los agotados que nadie capturó
 * en el Radar, se abrió la puerta a que cada par producto/sucursal con faltante
 * genere un expediente. Antes eran decenas —solo lo que alguien había escrito—;
 * ahora pueden ser miles.
 *
 * Medido ejecutando, con productos que faltan y se venden en las cinco tiendas:
 *
 *   200 productos  ->  1,000 expedientes  ->   2.8 MB
 *   1,000 productos -> 5,000 expedientes  ->  14.0 MB
 *   3,000 productos -> 15,000 expedientes ->  42.1 MB
 *
 * Cuarenta y dos megas por abrir una pantalla es inaceptable: Render los sirve
 * lento, el navegador los tiene que interpretar y nadie revisa quince mil
 * renglones. La revisión independiente lo encontró y además midió 115 segundos
 * cuando había muchas marcas de pedido, por una búsqueda lineal dentro del
 * bucle.
 *
 * LAS DOS REGLAS QUE SE CONGELAN AQUÍ:
 *
 * 1. Los candidatos que vienen SOLO del inventario se limitan a los más
 *    urgentes, y la respuesta DICE cuántos quedaron fuera. Recortar en silencio
 *    sería peor que no recortar: Victor creería que ya lo vio todo.
 * 2. Buscar si una fila está marcada como pedida no puede costar una pasada por
 *    todas las marcas. Con muchas marcas eso se vuelve cuadrático.
 *
 * Lo capturado en el Radar NUNCA se recorta: si alguien se tomó el trabajo de
 * registrar una demanda, esa fila se ve.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { obtenerEvidenciaCompras, TOPE_CANDIDATOS_INVENTARIO } = require("./radarDemandaInteligencia");
const { marcarPedido } = require("./radar/pedidosMarcados");

const HOY = "2026-08-20";
const global = { verTodas: true };
const SUCURSALES = 5;

/** Catálogo sintético donde TODO falta y TODO se vende: el peor caso real. */
function construir(nProductos, { conDemanda = 0 } = {}) {
  const productos = []; const existencias = []; const ventas = []; const detalle = [];
  for (let p = 1; p <= nProductos; p++) {
    productos.push({ id: p, sku: `SKU-${p}`, nombre: `Producto ${p}`, activo: true, proveedor_id: 1 });
    for (let s = 1; s <= SUCURSALES; s++) {
      existencias.push({
        producto_id: p, sucursal_id: s, cantidad_actual: 0,
        cantidad_minima: 5, cantidad_maxima: 0,
      });
      const id = (p - 1) * SUCURSALES + s;
      ventas.push({ id, fecha: HOY, sucursal_id: s, estatus: "cerrada" });
      // Los productos con id bajo se venden más: así se puede comprobar que el
      // recorte deja arriba lo que más se mueve.
      detalle.push({ id, venta_id: id, producto_id: p, cantidad: Math.max(1, 200 - p) });
    }
  }
  const registros = [];
  for (let i = 1; i <= conDemanda; i++) {
    registros.push({
      id: i, sucursal_id: 1, producto_id: nProductos - i + 1, cantidad: 1,
      estado: "REGISTRADA", fecha_registro: `${HOY}T12:00:00Z`, motivo_no_venta: "SIN_EXISTENCIA",
    });
  }
  return {
    pos: {
      sucursales: Array.from({ length: SUCURSALES }, (_, i) => ({ id: i + 1, nombre: `S${i + 1}` })),
      ventas, venta_detalle: detalle,
    },
    inventario: { existencias, compras: [], compra_detalle: [], traspasos: [] },
    "catalogo-productos": { productos, proveedores: [{ id: 1, nombre: "Prov" }] },
    crm: { clientes: [] },
    radar_demanda: { registros, seguimientos: [], ultimo_id: registros.length },
  };
}

const correr = (DB) => obtenerEvidenciaCompras(DB, global, { fecha_fin: HOY });

test("hay un tope declarado de candidatos que salen solo del inventario", () => {
  assert.equal(typeof TOPE_CANDIDATOS_INVENTARIO, "number");
  assert.ok(TOPE_CANDIDATOS_INVENTARIO > 0);
});

test("un catálogo grande no devuelve un expediente por cada par: se acota", () => {
  const r = correr(construir(1000));
  assert.ok(
    r.productos.length <= TOPE_CANDIDATOS_INVENTARIO,
    `devolvió ${r.productos.length} expedientes, por encima del tope`
  );
});

test("y la respuesta DICE cuántos quedaron fuera, en vez de recortar en silencio", () => {
  const r = correr(construir(1000));
  const total = 1000 * SUCURSALES;
  assert.equal(r.candidatos_inventario.omitidos, total - r.productos.length);
  assert.equal(r.candidatos_inventario.total_detectados, total);
});

test("se quedan los que MÁS se venden: el recorte prioriza, no corta al azar", () => {
  const r = correr(construir(400));
  const ids = r.productos.map((p) => p.producto.producto_id);
  assert.ok(ids.includes(1), "el producto que más vende tiene que estar");
  assert.ok(!ids.includes(400), "el que casi no vende es el que sobra");
});

test("con un catálogo chico no se recorta nada y no se anuncian omitidos", () => {
  const r = correr(construir(20));
  assert.equal(r.productos.length, 100);
  assert.equal(r.candidatos_inventario.omitidos, 0);
});

test("lo capturado en el Radar NUNCA se recorta, aunque el catálogo sea enorme", () => {
  const DB = construir(1000, { conDemanda: 30 });
  const r = correr(DB);
  const conDemanda = DB.radar_demanda.registros.map((x) => Number(x.producto_id));
  for (const productoId of conDemanda) {
    const suyo = r.productos.find(
      (p) => p.producto.producto_id === productoId && p.sucursal.sucursal_id === 1
    );
    assert.ok(suyo, `la demanda capturada del producto ${productoId} no puede desaparecer`);
  }
});

test("muchas marcas de pedido no vuelven lenta la consulta", () => {
  const DB = construir(300);
  for (let p = 1; p <= 300; p++) {
    for (let s = 1; s <= SUCURSALES; s++) {
      marcarPedido(DB, { producto_id: p, sucursal_id: s }, { id: 1, nombre: "Victor" }, HOY);
    }
  }
  const t0 = Date.now();
  correr(DB);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `tardó ${ms} ms con 1500 marcas: la búsqueda vuelve a ser lineal dentro del bucle`);
});

test("las marcas vencidas no se acumulan para siempre", () => {
  const DB = construir(5);
  marcarPedido(DB, { producto_id: 1, sucursal_id: 1 }, { id: 1, nombre: "Victor" }, "2026-01-01");
  marcarPedido(DB, { producto_id: 2, sucursal_id: 1 }, { id: 1, nombre: "Victor" }, HOY);
  assert.equal(DB.radar_demanda.pedidos_marcados.length, 1, "la de enero ya caducó y se limpia al escribir");
  assert.equal(Number(DB.radar_demanda.pedidos_marcados[0].producto_id), 2);
});
