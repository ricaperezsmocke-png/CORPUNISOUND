const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function ejecutarInstrumentacion(valor) {
  const env = { ...process.env, SENTRY_DSN: "https://public@example.com/1" };
  if (valor === undefined) delete env.SENTRY_ENABLED;
  else env.SENTRY_ENABLED = valor;

  const codigo = `
    const instrumento = require("./instrument");
    const Sentry = require("@sentry/node");
    Promise.resolve(Sentry.close(0)).then((cerrado) => {
      process.stdout.write(JSON.stringify({
        habilitado: instrumento.sentryHabilitado,
        cliente: !!Sentry.getClient(),
        cerrado,
      }));
    });
  `;
  const resultado = spawnSync(process.execPath, ["-e", codigo], {
    cwd: __dirname, env, encoding: "utf8",
  });
  assert.strictEqual(resultado.status, 0, resultado.stderr);
  return JSON.parse(resultado.stdout);
}

test("sin SENTRY_ENABLED conserva la inicialización actual", () => {
  const resultado = ejecutarInstrumentacion(undefined);
  assert.strictEqual(resultado.habilitado, true);
  assert.strictEqual(resultado.cliente, true);
});

test('SENTRY_ENABLED="false" no inicializa un cliente Sentry', () => {
  const resultado = ejecutarInstrumentacion("false");
  assert.strictEqual(resultado.habilitado, false);
  assert.strictEqual(resultado.cliente, false);
  assert.strictEqual(resultado.cerrado, true);
});

test('SENTRY_ENABLED="true" conserva la inicialización actual', () => {
  const resultado = ejecutarInstrumentacion("true");
  assert.strictEqual(resultado.habilitado, true);
  assert.strictEqual(resultado.cliente, true);
});

test('SENTRY_ENABLED="false" permite arrancar el backend con operaciones no-op', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "corpunisound-sentry-off-"));
  const dbPath = path.join(carpeta, "datos.sqlite");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SENTRY_ENABLED: "false",
    DB_PATH: dbPath,
    ANTHROPIC_API_KEY: "",
    RESPALDO_LLAVE: "",
    CLAVE_RESTAURACION: "",
  };
  const codigo = `
    const app = require("./server");
    const Sentry = require("@sentry/node");
    if (Sentry.getClient()) process.exit(2);
    Sentry.captureException(new Error("no se envía"));
    const servidor = app.listen(0, () => servidor.close(() => process.exit(0)));
  `;
  const resultado = spawnSync(process.execPath, ["-e", codigo], {
    cwd: __dirname, env, encoding: "utf8", timeout: 20000,
  });
  try {
    assert.strictEqual(resultado.status, 0, resultado.stderr || resultado.stdout);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
