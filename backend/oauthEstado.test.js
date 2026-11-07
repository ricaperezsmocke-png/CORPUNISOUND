/**
 * oauthEstado.test.js — El registro de `state` de OAuth en aislamiento:
 * aleatorio, de un solo uso, con vencimiento y ligado a proveedor y usuario.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { crearRegistroEstados, VIGENCIA_MS } = require("./oauthEstado");

const VICTOR = { id: 1, nombre: "Victor" };

test("un state válido se consume una vez y devuelve quién lo pidió", () => {
  const r = crearRegistroEstados();
  const s = r.emitir("drive", VICTOR);
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(r.consumir("drive", s), { usuario_id: 1, usuario_nombre: "Victor" });
  assert.strictEqual(r.consumir("drive", s), null, "el segundo uso se rechaza");
});

test("dos states nunca se repiten", () => {
  const r = crearRegistroEstados();
  assert.notStrictEqual(r.emitir("drive", VICTOR), r.emitir("drive", VICTOR));
});

test("sin state, vacío, desconocido o que no es texto → null", () => {
  const r = crearRegistroEstados();
  r.emitir("drive", VICTOR);
  for (const malo of [undefined, null, "", "abc", ["x"], 5]) assert.strictEqual(r.consumir("drive", malo), null);
});

test("un state de otro proveedor se rechaza y queda quemado", () => {
  const r = crearRegistroEstados();
  const s = r.emitir("ml", VICTOR);
  assert.strictEqual(r.consumir("drive", s), null);
  assert.strictEqual(r.consumir("ml", s), null, "se borró al usarlo aunque no sirviera");
});

test("un state vencido se rechaza", () => {
  let t = 1000;
  const r = crearRegistroEstados({ ahora: () => t });
  const s = r.emitir("drive", VICTOR);
  t += VIGENCIA_MS;
  assert.strictEqual(r.consumir("drive", s), null);
});

test("los vencidos se purgan al emitir otro", () => {
  let t = 0;
  const r = crearRegistroEstados({ ahora: () => t });
  r.emitir("drive", VICTOR);
  r.emitir("drive", VICTOR);
  t += VIGENCIA_MS + 1;
  r.emitir("drive", VICTOR);
  assert.strictEqual(r._pendientes(), 1);
});
