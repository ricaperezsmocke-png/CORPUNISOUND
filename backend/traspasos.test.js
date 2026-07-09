const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearTraspaso, recibirTraspaso, listarTraspasos } = require("./traspasos");

const USUARIO_OCOSINGO = { id: 1, nombre: "Gerente Ocosingo" };
const USUARIO_YAJALON = { id: 3, nombre: "Gerente Yajalón" };

test("crearTraspaso descuenta de inmediato la existencia de origen y queda en_transito", () => {
  const DB = construirDBPrueba();
  // producto 1 tiene 120 en sucursal 1 (fixture)
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2, comentario: "Reabasto" }, 1, USUARIO_OCOSINGO);
  assert.strictEqual(t.estatus, "en_transito");
  assert.strictEqual(t.sucursal_origen_id, 1);
  assert.strictEqual(t.sucursal_destino_id, 2);
  assert.strictEqual(t.cantidad, 20);
  const existOrigen = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1);
  assert.strictEqual(existOrigen.cantidad_actual, 100, "se descontó de inmediato");
  const existDestino = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 2);
  assert.ok(!existDestino || existDestino.cantidad_actual === 0, "destino NO recibe nada todavía");
});

test("crearTraspaso rechaza si no hay existencia suficiente en origen", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearTraspaso(DB, { producto_id: 1, cantidad: 999, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO),
    /No hay existencia suficiente/
  );
});

test("crearTraspaso rechaza origen y destino iguales", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearTraspaso(DB, { producto_id: 1, cantidad: 5, sucursal_destino_id: 1 }, 1, USUARIO_OCOSINGO));
});

test("recibirTraspaso abona exactamente la cantidad enviada y guarda el comentario", () => {
  const DB = construirDBPrueba();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  const recibido = recibirTraspaso(DB, t.id, { comentario: "Llegaron 2 piezas con la caja dañada" }, 2, USUARIO_YAJALON);
  assert.strictEqual(recibido.estatus, "recibido");
  assert.strictEqual(recibido.comentario_recepcion, "Llegaron 2 piezas con la caja dañada");
  const existDestino = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 2);
  assert.strictEqual(existDestino.cantidad_actual, 20, "se abona exactamente lo enviado, sin importar el comentario");
});

test("recibirTraspaso crea la fila de existencia en destino si el producto no tenía registro ahí", () => {
  const DB = construirDBPrueba();
  // producto 3 solo tiene existencia en sucursal 3 (fixture); lo mandamos a la 4
  const t = crearTraspaso(DB, { producto_id: 3, cantidad: 10, sucursal_destino_id: 4 }, 3, USUARIO_OCOSINGO);
  recibirTraspaso(DB, t.id, {}, 4, USUARIO_YAJALON);
  const existDestino = DB.inventario.existencias.find((e) => e.producto_id === 3 && e.sucursal_id === 4);
  assert.ok(existDestino, "debe crear la fila de existencia en destino");
  assert.strictEqual(existDestino.cantidad_actual, 10);
});

test("recibirTraspaso rechaza si lo confirma alguien de otra sucursal", () => {
  const DB = construirDBPrueba();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  assert.throws(() => recibirTraspaso(DB, t.id, {}, 3, USUARIO_YAJALON), /no es para tu sucursal/);
});

test("recibirTraspaso rechaza un traspaso ya recibido", () => {
  const DB = construirDBPrueba();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  recibirTraspaso(DB, t.id, {}, 2, USUARIO_YAJALON);
  assert.throws(() => recibirTraspaso(DB, t.id, {}, 2, USUARIO_YAJALON), /ya fue recibido/);
});

test("listarTraspasos: usuario amarrado ve los que son origen O destino de su sucursal", () => {
  const DB = construirDBPrueba();
  crearTraspaso(DB, { producto_id: 1, cantidad: 10, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO); // 1 -> 2
  crearTraspaso(DB, { producto_id: 3, cantidad: 5, sucursal_destino_id: 4 }, 3, USUARIO_OCOSINGO);   // 3 -> 4, no toca a 2
  const paraSucursal2 = listarTraspasos(DB, { verTodas: false, sucursalId: 2 });
  assert.strictEqual(paraSucursal2.length, 1);
  assert.strictEqual(paraSucursal2[0].sucursal_destino_id, 2);
});

test("listarTraspasos: usuario global ve todos y puede filtrar por estatus", () => {
  const DB = construirDBPrueba();
  const t1 = crearTraspaso(DB, { producto_id: 1, cantidad: 10, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  crearTraspaso(DB, { producto_id: 3, cantidad: 5, sucursal_destino_id: 4 }, 3, USUARIO_OCOSINGO);
  recibirTraspaso(DB, t1.id, {}, 2, USUARIO_YAJALON);
  const todos = listarTraspasos(DB, { verTodas: true, sucursalId: null });
  assert.strictEqual(todos.length, 2);
  const pendientes = listarTraspasos(DB, { verTodas: true, sucursalId: null }, "en_transito");
  assert.strictEqual(pendientes.length, 1);
});
