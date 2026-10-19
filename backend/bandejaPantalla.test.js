const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('../node_modules/react');
const { renderToStaticMarkup } = require('../node_modules/react-dom/server');
process.env.ESBUILD_WORKER_THREADS = '0';
const { transformSync } = require('../node_modules/esbuild');
const formatos = { __esModule: true, default: () => null, importe: n => `$${Number(n || 0) / 100}`, fecha: String };
function cargar(archivo, extras = {}) {
  const ruta = path.join(__dirname, '../src', archivo);
  assert.ok(fs.existsSync(ruta), `Falta ${archivo}`);
  const codigo = transformSync(fs.readFileSync(ruta, 'utf8'), { loader: 'jsx', format: 'cjs' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', codigo)(mod, mod.exports, nombre => {
    if (nombre in extras) return extras[nombre];
    if (nombre === 'react') return React;
    if (nombre === './CRMComprasSicar') return formatos;
    if (nombre === './crmEstados') return cargar('crmEstados.js');
    if (nombre === './CRMSeguimiento') return cargar('CRMSeguimiento.jsx');
    if (nombre === './api') return { apiFetch: async () => { throw new Error('API no preparada'); } };
    if (nombre.startsWith('./')) return cargar(`${nombre.slice(2)}.jsx`, extras);
    throw new Error(`Importación inesperada: ${nombre}`);
  });
  return mod.exports;
}
function hooks() {
  const slots = [], pendientes = [];
  let indice = 0;
  const react = { ...React,
    useState(inicial) {
      const i = indice++;
      if (!(i in slots)) slots[i] = typeof inicial === 'function' ? inicial() : inicial;
      return [slots[i], valor => { slots[i] = typeof valor === 'function' ? valor(slots[i]) : valor; }];
    },
    useRef(inicial) { const i = indice++; slots[i] ??= { current: inicial }; return slots[i]; },
    useCallback(fn, deps) {
      const i = indice++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = indice++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) {
        slots[i]?.limpiar?.(); slots[i] = { deps };
        pendientes.push(() => { slots[i].limpiar = fn(); });
      }
    },
  };
  return { react, render(fn, props) { indice = 0; return fn(props); },
    async efectos() { pendientes.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); },
    desmontar() { slots.forEach(s => s?.limpiar?.()); } };
}
function nodos(arbol, tipo) {
  const resultado = [];
  function visitar(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visitar);
    if (n.type === tipo) resultado.push(n);
    visitar(n.props?.children);
  }
  visitar(arbol);
  return resultado;
}
const ok = datos => ({ ok: true, json: async () => datos });

const conv = { id: 7, canal: 'whatsapp', canal_nombre: 'WhatsApp Ocosingo', cliente_id: 11, cliente_nombre: 'Beto', telefono: '9192223344',
  responsable_id: null, responsable_nombre: null, identidad_id: 3, ultima_interaccion_en: '2026-10-18T18:00:00Z', ultimo_texto: 'Hola',
  ultima_direccion: 'entrante', mensajes: [{ id: 1, direccion: 'entrante', texto: '¿Tienen guitarras?', ocurrida_en: '2026-10-18T18:00:00Z' },
    { id: 2, direccion: 'saliente', texto: 'Sí, pásele', ocurrida_en: '2026-10-18T18:05:00Z' }] };

test('bandeja: filtros según permiso, lista con responsable o por identificar', async () => {
  const h = hooks(), rutas = [];
  const api = { apiFetch: async ruta => { rutas.push(ruta); return ok([conv, { ...conv, id: 8, cliente_id: null, cliente_nombre: null }]); } };
  const Bandeja = cargar('CRMBandeja.jsx', { react: h.react, './api': api, './CRMBandejaHilo': { __esModule: true, default: () => null },
    './CRMBandejaHerramientas': { __esModule: true, default: () => null } }).default;
  h.render(Bandeja, { permisos: ['ver_bandeja'] }); await h.efectos();
  let html = renderToStaticMarkup(h.render(Bandeja, { permisos: ['ver_bandeja'] }));
  assert.deepEqual(rutas, ['/mensajes/conversaciones?filtro=mias']);
  for (const texto of ['Mías', 'Sin responsable', 'Por identificar', 'Beto', '9192223344']) assert.ok(html.includes(texto), texto);
  assert.doesNotMatch(html, />Todas</);
  html = renderToStaticMarkup(h.render(Bandeja, { permisos: ['ver_bandeja', 'ver_todas_conversaciones'] }));
  assert.match(html, />Todas</);
});

test('hilo: mensajes en orden, Tomar solo sin responsable y con permiso; reasignar e identificar según permiso', async () => {
  for (const [permisos, datos, esperado, ausente] of [
    [['responder_mensajes'], conv, ['¿Tienen guitarras?', 'Sí, pásele', 'Tomar', 'Enviar'], ['Cambiar responsable', '¿Quién es este contacto?']],
    [['responder_mensajes', 'reasignar_conversaciones'], { ...conv, responsable_id: 1, responsable_nombre: 'Vero' },
      ['Responsable: Vero', 'Cambiar responsable'], ['>Tomar<']],
    [['ligar_identidades'], { ...conv, cliente_id: null, cliente_nombre: null }, ['¿Quién es este contacto?'], ['Enviar', '>Tomar<']],
  ]) {
    const h = hooks();
    const api = { apiFetch: async ruta => ok(ruta === '/vendedores' ? [] : datos) };
    const Hilo = cargar('CRMBandejaHilo.jsx', { react: h.react, './api': api }).default;
    h.render(Hilo, { conversacionId: 7, permisos }); await h.efectos();
    const html = renderToStaticMarkup(h.render(Hilo, { conversacionId: 7, permisos }));
    for (const texto of esperado) assert.ok(html.includes(texto), `${texto} con ${permisos}`);
    for (const texto of ausente) assert.ok(!html.includes(texto), `${texto} no debe salir con ${permisos}`);
    assert.ok(html.indexOf('¿Tienen guitarras?') < html.indexOf('Sí, pásele') || !html.includes('Sí, pásele'));
  }
});

test('hilo: el error del servidor se muestra', async () => {
  const h = hooks();
  const api = { apiFetch: async () => ({ ok: false, json: async () => ({ error: 'Conversación no encontrada.' }) }) };
  const Hilo = cargar('CRMBandejaHilo.jsx', { react: h.react, './api': api }).default;
  h.render(Hilo, { conversacionId: 9, permisos: [] }); await h.efectos();
  assert.match(renderToStaticMarkup(h.render(Hilo, { conversacionId: 9, permisos: [] })), /Conversación no encontrada/);
});

test('herramientas: traspaso solo con permiso; mensaje de prueba solo en desarrollo', () => {
  const Herramientas = cargar('CRMBandejaHerramientas.jsx').default;
  const html = props => renderToStaticMarkup(React.createElement(Herramientas, props));
  assert.equal(html({ permisos: ['ver_bandeja'] }), '');
  assert.match(html({ permisos: ['traspasar_cartera'] }), /Traspasar cartera/);
  assert.doesNotMatch(html({ permisos: ['conectar_canales_mensajes'], desarrollo: false }), /Mensaje de prueba/);
  assert.match(html({ permisos: ['conectar_canales_mensajes'], desarrollo: true }), /Mensaje de prueba/);
});

test('ficha: historial de responsables y estados distingue automático de manual', async () => {
  const h = hooks();
  const api = { apiFetch: async () => ok({ conversaciones: [{ id: 7, canal: 'whatsapp', ultima_interaccion_en: '2026-10-18T18:00:00Z' }],
    responsables: [{ vendedor_nombre: 'Luis', motivo: 'Vero de vacaciones', asignada_en: '2026-10-18T18:00:00Z', finalizada_en: null }],
    estados: [{ id: 2, anterior: 'interesado', nuevo: 'perdido', usuario_id: null, motivo: '30 días sin respuesta ni compra',
      fecha_hora: '2026-10-18T18:00:00Z' }, { id: 1, anterior: null, nuevo: 'interesado', usuario_id: 9, motivo: 'Cambio manual',
      fecha_hora: '2026-10-01T18:00:00Z' }] }) };
  const Perfil = cargar('CRMPerfilBandeja.jsx', { react: h.react, './api': api }).default;
  h.render(Perfil, { clienteId: 11 }); await h.efectos();
  const html = renderToStaticMarkup(h.render(Perfil, { clienteId: 11 }));
  for (const texto of ['WhatsApp', 'Luis', 'Vero de vacaciones', 'Interesado → Perdido', 'Automático', 'Manual', '30 días sin respuesta ni compra']) {
    assert.ok(html.includes(texto), texto);
  }
});
