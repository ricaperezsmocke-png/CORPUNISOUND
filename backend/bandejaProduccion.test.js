const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registrarRutasBandeja } = require("./bandejaRutas");

test("en producción el canal simulado no existe", () => {
  const rutas = [];
  const app = { get: r => rutas.push(`GET ${r}`), post: r => rutas.push(`POST ${r}`), put: r => rutas.push(`PUT ${r}`) };
  const deps = { DB: {}, bandeja: {}, disponible: () => true, requiereLogin: () => {}, requierePermiso: () => () => {},
    resolverPermisosDeRol: () => [], resolverAlcanceAutorizado: () => ({}) };
  const anterior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    registrarRutasBandeja(app, deps);
    assert.equal(rutas.some(r => r.includes("simulado")), false);
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
