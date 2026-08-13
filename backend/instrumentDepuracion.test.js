/**
 * instrumentDepuracion.test.js — El depurador de secretos que corre como
 * `beforeSend` de Sentry (ver backend/instrument.js).
 *
 * Se llama a depurarSecretos() directamente, con eventos armados a mano: no
 * hace falta levantar Sentry de verdad ni mandar nada por red.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { depurarSecretos } = require("./instrument");

function eventoConVars(vars) {
  return {
    exception: {
      values: [
        {
          type: "Error",
          value: "algo truena",
          stacktrace: { frames: [{ filename: "respaldos.js", function: "crearRespaldo", vars }] },
        },
      ],
    },
  };
}

test("una variable local llamada 'llave' queda filtrada", () => {
  const evento = eventoConVars({ llave: "a".repeat(64), otraCosa: 123 });
  const depurado = depurarSecretos(evento);
  const vars = depurado.exception.values[0].stacktrace.frames[0].vars;
  assert.strictEqual(vars.llave, "[Filtrado]");
  assert.strictEqual(vars.otraCosa, 123);
});

test("una variable llamada 'LLAVE' (mayúsculas) también se filtra", () => {
  const evento = eventoConVars({ LLAVE: "b".repeat(64) });
  const vars = depurarSecretos(evento).exception.values[0].stacktrace.frames[0].vars;
  assert.strictEqual(vars.LLAVE, "[Filtrado]");
});

test("variables con nombres de secretos del sistema (RESPALDO_LLAVE, CLAVE_RESTAURACION, etc.) se filtran", () => {
  const evento = eventoConVars({
    RESPALDO_LLAVE: "x",
    CLAVE_RESTAURACION: "y",
    TOKEN_DESCARGA_RESPALDOS: "z",
    JWT_SECRET: "w",
    ML_CLIENT_SECRET: "v",
    password: "p",
    contraseña: "c",
    authorization: "Bearer abc",
  });
  const vars = depurarSecretos(evento).exception.values[0].stacktrace.frames[0].vars;
  for (const clave of Object.keys(vars)) {
    assert.strictEqual(vars[clave], "[Filtrado]", `${clave} debió quedar filtrado`);
  }
});

test("una variable inocente (nombre_archivo, tipo) NO se toca", () => {
  const evento = eventoConVars({ nombre_archivo: "unisound-2026-08-11-1600-1.respaldo", tipo: "dia" });
  const vars = depurarSecretos(evento).exception.values[0].stacktrace.frames[0].vars;
  assert.strictEqual(vars.nombre_archivo, "unisound-2026-08-11-1600-1.respaldo");
  assert.strictEqual(vars.tipo, "dia");
});

test("también filtra extra, tags, contexts y request.data/headers", () => {
  const evento = {
    extra: { clave: "secreta", detalle: "ok" },
    tags: { token: "abc", ambiente: "produccion" },
    contexts: { config: { jwt_secret: "s" } },
    request: {
      data: { contrasena: "1234" },
      headers: { Authorization: "Bearer abc" },
    },
  };
  const depurado = depurarSecretos(evento);
  assert.strictEqual(depurado.extra.clave, "[Filtrado]");
  assert.strictEqual(depurado.extra.detalle, "ok");
  assert.strictEqual(depurado.tags.token, "[Filtrado]");
  assert.strictEqual(depurado.tags.ambiente, "produccion");
  assert.strictEqual(depurado.contexts.config.jwt_secret, "[Filtrado]");
  assert.strictEqual(depurado.request.data.contrasena, "[Filtrado]");
  assert.strictEqual(depurado.request.headers.Authorization, "[Filtrado]");
});

// ---------- Seguridad ante basura: nunca debe lanzar ----------

test("un evento null o undefined no revienta", () => {
  assert.doesNotThrow(() => depurarSecretos(null));
  assert.doesNotThrow(() => depurarSecretos(undefined));
  assert.strictEqual(depurarSecretos(null), null);
});

test("un evento sin exception no revienta", () => {
  const evento = { message: "algo pasó" };
  assert.doesNotThrow(() => depurarSecretos(evento));
  assert.strictEqual(depurarSecretos(evento).message, "algo pasó");
});

test("exception sin stacktrace o sin frames no revienta", () => {
  assert.doesNotThrow(() => depurarSecretos({ exception: { values: [{ type: "Error" }] } }));
  assert.doesNotThrow(() => depurarSecretos({ exception: { values: [{ stacktrace: {} }] } }));
  assert.doesNotThrow(() => depurarSecretos({ exception: { values: [{ stacktrace: { frames: null } }] } }));
  assert.doesNotThrow(() => depurarSecretos({ exception: { values: "no-es-un-arreglo" } }));
  assert.doesNotThrow(() => depurarSecretos({ exception: null }));
});

test("un evento con un ciclo (self-reference) no revienta ni cuelga", () => {
  const vars = { llave: "secreta" };
  vars.self = vars; // ciclo directo
  const evento = eventoConVars(vars);
  evento.extra = evento; // ciclo hacia el evento completo
  assert.doesNotThrow(() => depurarSecretos(evento));
  const varsDepuradas = evento.exception.values[0].stacktrace.frames[0].vars;
  assert.strictEqual(varsDepuradas.llave, "[Filtrado]");
});

test("estructuras inesperadas (frame.vars no es objeto, valores primitivos raros) no revientan", () => {
  const evento = {
    exception: {
      values: [
        { stacktrace: { frames: [{ vars: "no-es-un-objeto" }, { vars: 42 }, { vars: null }, null, {}] } },
      ],
    },
  };
  assert.doesNotThrow(() => depurarSecretos(evento));
});
