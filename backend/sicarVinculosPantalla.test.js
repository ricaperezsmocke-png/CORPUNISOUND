const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('../node_modules/react');
const { renderToStaticMarkup } = require('../node_modules/react-dom/server');
// Evita el worker de esbuild bloqueado en el sandbox de Windows; no cambia la transformación.
process.env.ESBUILD_WORKER_THREADS = '0';
const { transformSync } = require('../node_modules/esbuild');

test('la cola carga el catálogo existente y muestra Ocosingo en lugar de Tienda 1', async () => {
  const estados = [];
  const efectos = [];
  const rutas = [];
  let indice = 0;
  const react = { ...React,
    useState(inicial) {
      const i = indice++;
      if (!(i in estados)) estados[i] = inicial;
      return [estados[i], valor => { estados[i] = valor; }];
    },
    useEffect: fn => { efectos.push(fn); },
    useCallback: fn => fn,
  };
  const item = { sucursal_id: '1', cli_id: '100', nombre: 'Ana', estado: 'pendiente', version: 1,
    numero_compras: 0, monto_centavos: 0, puede_resolver: true };
  const api = { async apiFetch(ruta) {
    rutas.push(ruta);
    const datos = ruta === '/sucursales' ? [{ id: 1, nombre: 'Ocosingo' }] : { items: [item], siguiente: null };
    return { ok: true, json: async () => datos };
  } };
  const fuente = fs.readFileSync(path.join(__dirname, '../src/SicarVinculos.jsx'), 'utf8');
  const codigo = transformSync(fuente, { loader: 'jsx', format: 'cjs' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', codigo)(mod, mod.exports, nombre => {
    if (nombre === 'react') return react;
    if (nombre === './api') return api;
    throw new Error(`Importación inesperada: ${nombre}`);
  });
  renderToStaticMarkup(React.createElement(mod.exports.default));
  for (const efecto of efectos.splice(0)) efecto();
  await new Promise(resolve => setImmediate(resolve));
  indice = 0;
  const html = renderToStaticMarkup(React.createElement(mod.exports.default));
  assert.match(html, /Ana · Ocosingo/);
  assert.doesNotMatch(html, /Tienda 1/);
  assert.ok(rutas.includes('/sucursales'));
});
