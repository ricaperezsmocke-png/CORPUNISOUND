const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registrarRutasBandeja } = require("./bandejaRutas");

test("el canal simulado solo existe con NODE_ENV development o test explícito", () => {
  const rutas = [];
  const app = { get: r => rutas.push(`GET ${r}`), post: r => rutas.push(`POST ${r}`), put: r => rutas.push(`PUT ${r}`) };
  const deps = { DB: {}, bandeja: {}, disponible: () => true, requiereLogin: () => {}, requierePermiso: () => () => {},
    resolverPermisosDeRol: () => [], resolverAlcanceAutorizado: () => ({}) };
  const anterior = process.env.NODE_ENV;
  try {
    for (const entorno of ["production", undefined, "", "staging"]) {
      if (entorno === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = entorno;
      rutas.length = 0;
      registrarRutasBandeja(app, deps);
      assert.equal(rutas.some(r => r.includes("simulado")), false, String(entorno));
    }
    rutas.length = 0;
    process.env.NODE_ENV = "test";
    registrarRutasBandeja(app, deps);
    assert.equal(rutas.includes("POST /api/mensajes/simulado/entrante"), true);
  } finally { process.env.NODE_ENV = anterior; }
});

test("sin base para la bandeja, sus rutas se registran y responden 503 sin tumbar el arranque", () => {
  const rutas = {};
  const app = { get: (r, ...m) => { rutas[`GET ${r}`] = m.at(-1); }, post: (r, ...m) => { rutas[`POST ${r}`] = m.at(-1); },
    put: (r, ...m) => { rutas[`PUT ${r}`] = m.at(-1); } };
  registrarRutasBandeja(app, { DB: {}, bandeja: null, disponible: () => false, requiereLogin: () => {}, requierePermiso: () => () => {},
    resolverPermisosDeRol: () => [], resolverAlcanceAutorizado: () => ({}) });
  let estado;
  rutas["GET /api/mensajes/conversaciones"]({ query: {} }, { status: s => { estado = s; return { json: () => {} }; } });
  assert.equal(estado, 503);
});
