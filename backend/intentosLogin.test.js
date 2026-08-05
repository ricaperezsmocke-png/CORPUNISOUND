const { test } = require("node:test");
const assert = require("node:assert");
const {
  crearRegistroIntentos,
  estaBloqueado,
  registrarFallo,
  registrarExito,
  MAX_INTENTOS,
  BLOQUEO_MS,
} = require("./intentosLogin");

test("una cuenta recién vista no está bloqueada", () => {
  const store = crearRegistroIntentos();
  assert.strictEqual(estaBloqueado(store, "victor").bloqueado, false);
});

test("menos de MAX_INTENTOS fallos no bloquea", () => {
  const store = crearRegistroIntentos();
  for (let i = 0; i < MAX_INTENTOS - 1; i++) registrarFallo(store, "victor");
  assert.strictEqual(estaBloqueado(store, "victor").bloqueado, false);
});

test("al llegar a MAX_INTENTOS fallos, la cuenta queda bloqueada con tiempo restante", () => {
  const store = crearRegistroIntentos();
  for (let i = 0; i < MAX_INTENTOS; i++) registrarFallo(store, "victor");
  const r = estaBloqueado(store, "victor");
  assert.strictEqual(r.bloqueado, true);
  assert.ok(r.restanteMs > 0 && r.restanteMs <= BLOQUEO_MS);
});

test("un inicio de sesión exitoso limpia los fallos acumulados", () => {
  const store = crearRegistroIntentos();
  for (let i = 0; i < MAX_INTENTOS - 1; i++) registrarFallo(store, "victor");
  registrarExito(store, "victor");
  // arranca de cero: un fallo más no debe bloquear
  registrarFallo(store, "victor");
  assert.strictEqual(estaBloqueado(store, "victor").bloqueado, false);
});

test("el bloqueo se levanta solo cuando pasa BLOQUEO_MS", () => {
  const store = crearRegistroIntentos();
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_INTENTOS; i++) registrarFallo(store, "victor", t0);
  assert.strictEqual(estaBloqueado(store, "victor", t0 + 1).bloqueado, true);
  assert.strictEqual(estaBloqueado(store, "victor", t0 + BLOQUEO_MS - 1).bloqueado, true);
  // justo al vencer el bloqueo, vuelve a permitir el intento
  assert.strictEqual(estaBloqueado(store, "victor", t0 + BLOQUEO_MS).bloqueado, false);
});

test("tras vencer el bloqueo, el contador quedó limpio (no basta un fallo para volver a bloquear)", () => {
  const store = crearRegistroIntentos();
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_INTENTOS; i++) registrarFallo(store, "victor", t0);
  // consultar el estado justo al vencer descarta el registro viejo
  assert.strictEqual(estaBloqueado(store, "victor", t0 + BLOQUEO_MS).bloqueado, false);
  registrarFallo(store, "victor", t0 + BLOQUEO_MS);
  assert.strictEqual(estaBloqueado(store, "victor", t0 + BLOQUEO_MS).bloqueado, false);
});

test("el usuario se normaliza: no se puede esquivar el bloqueo cambiando mayúsculas o espacios", () => {
  const store = crearRegistroIntentos();
  for (let i = 0; i < MAX_INTENTOS; i++) registrarFallo(store, "Victor");
  // el atacante prueba con otra caja de letras / con espacios: sigue bloqueado
  assert.strictEqual(estaBloqueado(store, "  VICTOR ").bloqueado, true);
});

test("un usuario vacío o nulo no revienta ni bloquea", () => {
  const store = crearRegistroIntentos();
  assert.strictEqual(estaBloqueado(store, "").bloqueado, false);
  assert.strictEqual(estaBloqueado(store, null).bloqueado, false);
  registrarFallo(store, null);
  registrarExito(store, undefined);
});

test("cuentas distintas se bloquean por separado", () => {
  const store = crearRegistroIntentos();
  for (let i = 0; i < MAX_INTENTOS; i++) registrarFallo(store, "victor");
  assert.strictEqual(estaBloqueado(store, "victor").bloqueado, true);
  assert.strictEqual(estaBloqueado(store, "ana").bloqueado, false);
});
