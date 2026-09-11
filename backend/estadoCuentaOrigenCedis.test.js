/**
 * La deuda de una tienda con la cuenta común nace de la mercancía que compró el
 * CEDIS y le mandó. Un traspaso entre dos tiendas solo mueve lo que ya se cobró
 * una vez: si también se cobrara, el mismo recorrido quedaría cargado a las dos.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { crearTraspaso, recibirTraspaso } = require("./traspasos");
const { estadoCuenta } = require("./estadoCuenta");

const TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { id: 1, nombre: "Prueba" };

function prepararDB() {
  const DB = construirDBPrueba();
  // El CEDIS (6) necesita existencia para poder enviar.
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 6, cantidad_actual: 100, cantidad_minima: 0, cantidad_maxima: 0 });
  return DB;
}

// Pasa por las funciones reales: descuenta al origen, abona al destino y deja
// el traspaso "recibido" con la foto del costo, igual que en la tienda.
function recibirTraspasoDePrueba(DB, { origen, destino, cantidad, costo }) {
  DB["catalogo-productos"].productos.find((p) => p.id === 1).costo = costo;
  const t = crearTraspaso(DB, { producto_id: 1, cantidad, sucursal_destino_id: destino }, origen, USUARIO);
  return recibirTraspaso(DB, t.id, {}, destino, USUARIO);
}

test("un traspaso entre tiendas NO genera deuda con la cuenta comun", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 1, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, {}, TODAS);
  const yajalon = ec.resumen.find((r) => r.sucursal_id === 2);
  assert.equal(yajalon ? yajalon.recibido : 0, 0, "esa mercancia no vino del CEDIS");
  assert.equal(ec.totales.recibido, 0);
});

test("un traspaso DESDE el CEDIS si genera deuda", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 6, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, {}, TODAS);
  assert.equal(ec.resumen.find((r) => r.sucursal_id === 2).recibido, 200);
});

test("la misma mercancia no se cobra dos veces por reenviarse", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 6, destino: 1, cantidad: 2, costo: 100 });
  recibirTraspasoDePrueba(DB, { origen: 1, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, {}, TODAS);
  assert.equal(ec.totales.recibido, 200, "un solo recorrido desde el CEDIS, un solo cargo");
  assert.equal(ec.resumen.find((r) => r.sucursal_id === 1).recibido, 200, "se le cobra a quien lo recibio del CEDIS");
});

test("el detalle de una tienda tampoco lista traspasos entre tiendas como cargo", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 6, destino: 2, cantidad: 1, costo: 100 });
  recibirTraspasoDePrueba(DB, { origen: 1, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, { sucursal_id: 2 }, TODAS);
  const cargos = ec.movimientos.filter((m) => m.tipo === "mercancia");
  assert.equal(cargos.length, 1, "solo el que vino del CEDIS");
  assert.equal(cargos[0].cargo, 100);
});

test("un origen CEDIS guardado como texto sigue contando", () => {
  // Regla 4: un id puede llegar como texto; la guarda compara ya normalizada.
  const DB = prepararDB();
  const t = recibirTraspasoDePrueba(DB, { origen: 6, destino: 2, cantidad: 2, costo: 100 });
  t.sucursal_origen_id = "6";
  const ec = estadoCuenta(DB, {}, TODAS);
  assert.equal(ec.resumen.find((r) => r.sucursal_id === 2).recibido, 200);
});
