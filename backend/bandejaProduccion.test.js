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
