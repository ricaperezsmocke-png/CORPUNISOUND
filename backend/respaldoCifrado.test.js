const { test } = require("node:test");
const assert = require("node:assert");
const {
  llaveDesdeEnv, empaquetar, desempaquetar, generarLlaveNueva, LARGO_IV, LARGO_TAG,
} = require("./respaldoCifrado");

const LLAVE = Buffer.from("a".repeat(64), "hex");
const OTRA_LLAVE = Buffer.from("b".repeat(64), "hex");

test("empaquetar y desempaquetar devuelve exactamente el mismo objeto", () => {
  const original = {
    pos: { ventas: [{ id: 1, total: 1234.56, cliente: "Ana Pérez" }] },
    crm: { clientes: [{ id: 1, nombre: "Café Yajalón", saldo: 0 }] },
    texto: "acentos: ñáéíóú — y símbolos $ % €",
    nulo: null, booleano: false, cero: 0,
  };
  const paquete = empaquetar(original, LLAVE);
  assert.ok(Buffer.isBuffer(paquete));
  assert.deepStrictEqual(desempaquetar(paquete, LLAVE), original);
});

test("el paquete NO contiene el texto en claro", () => {
  const paquete = empaquetar({ secreto: "CONTRASENA_DE_VICTOR" }, LLAVE);
  assert.ok(!paquete.toString("utf8").includes("CONTRASENA_DE_VICTOR"));
  assert.ok(!paquete.toString("latin1").includes("CONTRASENA_DE_VICTOR"));
});

test("con la llave equivocada FALLA — no devuelve basura", () => {
  const paquete = empaquetar({ a: 1 }, LLAVE);
  assert.throws(() => desempaquetar(paquete, OTRA_LLAVE), /no se pudo descifrar/);
});

test("un archivo alterado un solo byte FALLA (esto es lo que compra GCM)", () => {
  const paquete = empaquetar({ ventas: 100 }, LLAVE);
  const alterado = Buffer.from(paquete);
  alterado[alterado.length - 1] ^= 0x01;
  assert.throws(() => desempaquetar(alterado, LLAVE), /no se pudo descifrar/);
});

test("un archivo truncado FALLA con mensaje claro, no con un crash raro", () => {
  const paquete = empaquetar({ a: 1 }, LLAVE);
  assert.throws(() => desempaquetar(paquete.subarray(0, 10), LLAVE), /incompleto o dañado/);
});

test("dos paquetes del MISMO objeto son distintos (IV aleatorio por archivo)", () => {
  const a = empaquetar({ a: 1 }, LLAVE);
  const b = empaquetar({ a: 1 }, LLAVE);
  assert.notStrictEqual(a.toString("base64"), b.toString("base64"));
  assert.notStrictEqual(
    a.subarray(0, LARGO_IV).toString("hex"),
    b.subarray(0, LARGO_IV).toString("hex"),
  );
});

test("comprime: un objeto repetitivo pesa mucho menos que su JSON", () => {
  const grande = { filas: Array.from({ length: 2000 }, (_, i) => ({ id: i, nombre: "Producto de prueba", activo: true })) };
  const crudo = Buffer.byteLength(JSON.stringify(grande), "utf8");
  assert.ok(empaquetar(grande, LLAVE).length < crudo / 3, "debería comprimir al menos 3x");
});

test("llaveDesdeEnv devuelve null cuando no está configurada", () => {
  assert.strictEqual(llaveDesdeEnv({}), null);
  assert.strictEqual(llaveDesdeEnv({ RESPALDO_LLAVE: "" }), null);
});

test("llaveDesdeEnv LANZA si la llave está mal formada (no falla en silencio)", () => {
  assert.throws(() => llaveDesdeEnv({ RESPALDO_LLAVE: "corta" }), /64 caracteres hexadecimales/);
  assert.throws(() => llaveDesdeEnv({ RESPALDO_LLAVE: "z".repeat(64) }), /64 caracteres hexadecimales/);
});

test("llaveDesdeEnv acepta una llave válida y da 32 bytes", () => {
  const llave = llaveDesdeEnv({ RESPALDO_LLAVE: "a".repeat(64) });
  assert.strictEqual(llave.length, 32);
});

test("generarLlaveNueva produce 64 hex distintos cada vez", () => {
  const a = generarLlaveNueva();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(a, generarLlaveNueva());
});

test("una llave generada sirve para ida y vuelta", () => {
  const llave = llaveDesdeEnv({ RESPALDO_LLAVE: generarLlaveNueva() });
  assert.deepStrictEqual(desempaquetar(empaquetar({ ok: true }, llave), llave), { ok: true });
});
