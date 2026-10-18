const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('../node_modules/react');
const { renderToStaticMarkup } = require('../node_modules/react-dom/server');
process.env.ESBUILD_WORKER_THREADS = '0';
const { transformSync } = require('../node_modules/esbuild');

function cargar(archivo, extras = {}) {
  const ruta = path.join(__dirname, '../src', archivo);
  assert.ok(fs.existsSync(ruta), `Falta ${archivo}`);
  const codigo = transformSync(fs.readFileSync(ruta, 'utf8'), { loader: 'jsx', format: 'cjs' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', codigo)(mod, mod.exports, nombre => {
    if (nombre in extras) return extras[nombre];
    if (nombre === 'react') return React;
    if (nombre === './crmEstados') return cargar('crmEstados.js');
    throw new Error(`Importación inesperada: ${nombre}`);
  });
  return mod.exports;
}

test('WhatsApp normaliza solo numeros mexicanos admitidos', () => {
  const { numeroWhatsApp } = cargar('crmEstados.js');
  assert.equal(numeroWhatsApp('(919) 123-4567'), '529191234567');
  assert.equal(numeroWhatsApp('+52 919 123 4567'), '529191234567');
  for (const valor of ['', null, '123', '5219191234567', '119191234567']) assert.equal(numeroWhatsApp(valor), null);
});

test('seguimiento muestra cuatro estados sin permiso deshabilitados e insignia Compro', () => {
  const { default: Seguimiento } = cargar('CRMSeguimiento.jsx');
  const html = renderToStaticMarkup(React.createElement(Seguimiento, {
    ficha: { estado: 'compro', ya_compro: true, telefono: '9191234567' }, puedeCambiar: false,
  }));
  assert.equal((html.match(/disabled=""/g) || []).length, 4);
  assert.match(html, /Compró/);
  assert.match(html, /href="https:\/\/wa.me\/529191234567"/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /<button[^>]*>Compró<\/button>/);
  for (const etiqueta of ['Contactado', 'Interesado', 'En tienda', 'Perdido']) assert.match(html, new RegExp(etiqueta));
});

test('telefono invalido deshabilita WhatsApp y sin telefono no lo muestra', () => {
  const { default: Seguimiento } = cargar('CRMSeguimiento.jsx');
  const render = telefono => renderToStaticMarkup(React.createElement(Seguimiento, {
    ficha: { telefono }, puedeCambiar: true,
  }));
  assert.match(render('123'), /Teléfono no válido/);
  assert.doesNotMatch(render('123'), /href=/);
  assert.doesNotMatch(render(null), /WhatsApp/);
});

test('botones con permiso llaman al estado manual y guardando bloquea nuevos cambios', () => {
  const { default: Seguimiento } = cargar('CRMSeguimiento.jsx');
  let elegido;
  const arbol = Seguimiento({ ficha: {}, puedeCambiar: true, onCambiar: estado => { elegido = estado; } });
  const nodos = [];
  function recorrer(nodo) {
    if (!nodo || typeof nodo !== 'object') return;
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    nodos.push(nodo);
    recorrer(nodo.props?.children);
  }
  recorrer(arbol);
  const botones = nodos.filter(n => n.type === 'button');
  assert.equal(botones.length, 4);
  assert.ok(botones.every(n => !n.props.disabled));
  botones[1].props.onClick();
  assert.equal(elegido, 'interesado');
  const html = renderToStaticMarkup(React.createElement(Seguimiento, { ficha: {}, puedeCambiar: true, guardando: true }));
  assert.equal((html.match(/disabled=""/g) || []).length, 4);
});

function nodos(arbol, tipo) {
  const resultado = [];
  function visitar(nodo) {
    if (!nodo || typeof nodo !== 'object') return;
    if (Array.isArray(nodo)) return nodo.forEach(visitar);
    if (nodo.type === tipo) resultado.push(nodo);
    visitar(nodo.props?.children);
  }
  visitar(arbol);
  return resultado;
}

function hooks() {
  const slots = [];
  let indice = 0;
  const pendientes = [];
  const react = { ...React,
    useState(inicial) {
      const i = indice++;
      if (!(i in slots)) slots[i] = typeof inicial === 'function' ? inicial() : inicial;
      return [slots[i], valor => { slots[i] = typeof valor === 'function' ? valor(slots[i]) : valor; }];
    },
    useRef(inicial) {
      const i = indice++;
      slots[i] ??= { current: inicial };
      return slots[i];
    },
    useCallback(fn, deps) {
      const i = indice++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = indice++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) {
        slots[i]?.limpiar?.();
        slots[i] = { deps };
        pendientes.push(() => { slots[i].limpiar = fn(); });
      }
    },
  };
  return { react, render(fn, props) { indice = 0; return fn(props); },
    async efectos() { pendientes.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); },
    desmontar() { slots.forEach(s => s?.limpiar?.()); },
  };
}

test('lista transmite filtros, cambia pagina y vuelve al inicio al filtrar', async () => {
  const h = hooks(), rutas = [];
  const api = { async apiFetch(ruta) {
    rutas.push(ruta);
    const datos = ruta.startsWith('/crm/v2/clientes?') ? { items: [
      { ref: 'sicar:1:123', nombre: 'Ana', estado: 'interesado', ultima_compra: '2026-10-15', numero_compras: 1 },
    ], siguiente: 50, totales: null }
      : ruta === '/auth/yo' ? { permisos: ['cambiar_estado_cliente'] } : { sucursales: [] };
    return { ok: true, json: async () => datos };
  } };
  const { default: Lista } = cargar('CRMListaClientes.jsx', { react: h.react, './api': api,
    './CRMComprasSicar': { __esModule: true, default: () => null, importe: String, fecha: String },
    './CRMSeguimiento': cargar('CRMSeguimiento.jsx'), './CRMFichaCliente': { __esModule: true, default: () => null } });
  const props = { nombreSucursal: String, onAbrirNativo() {} };
  h.render(Lista, props); await h.efectos();
  let arbol = h.render(Lista, props);
  const html = renderToStaticMarkup(arbol);
  assert.match(html, /2026-10-15/);
  assert.match(html, /Interesado/);
  nodos(arbol, 'button').find(n => n.props.children === 'Siguiente').props.onClick();
  h.render(Lista, props); await h.efectos();
  assert.ok(rutas.some(r => r.includes('cursor=50')));
  arbol = h.render(Lista, props);
  const orden = nodos(arbol, 'select').find(n => n.props['aria-label'] === 'Orden');
  assert.ok(orden, 'Falta selector de orden');
  orden.props.onChange({ target: { value: 'monto' } });
  h.render(Lista, props); await h.efectos();
  for (const [tipo, etiqueta, valor] of [['input', 'Desde', '2026-10-01'], ['input', 'Hasta', '2026-10-15'],
    ['select', 'Estado', 'interesado']]) {
    arbol = h.render(Lista, props);
    nodos(arbol, tipo).find(n => n.props['aria-label'] === etiqueta).props.onChange({ target: { value: valor } });
    h.render(Lista, props); await h.efectos();
  }
  const ultima = rutas.filter(r => r.startsWith('/crm/v2/clientes?')).at(-1);
  for (const texto of ['cursor=0', 'orden=monto', 'desde=2026-10-01', 'hasta=2026-10-15', 'estado=interesado']) {
    assert.ok(ultima.includes(texto), ultima);
  }
});

test('ficha guarda estado, actualiza lista y descarta respuesta al desmontar', async () => {
  const h = hooks();
  let resolver, actualizaciones = 0;
  const ficha = { ref: 'sicar:1:123', nombre: 'Ana', telefono: '9191234567', fuente: 'sicar', estado: null };
  const api = { async apiFetch(ruta, opciones) {
    if (opciones?.method === 'PUT') {
      assert.equal(ruta, '/crm/v2/clientes/sicar%3A1%3A123/estado');
      assert.deepEqual(JSON.parse(opciones.body), { estado: 'interesado' });
      return new Promise(resolve => { resolver = resolve; });
    }
    return { ok: true, json: async () => ficha };
  } };
  const Seguimiento = cargar('CRMSeguimiento.jsx').default;
  const { default: Ficha } = cargar('CRMFichaCliente.jsx', { react: h.react, './api': api,
    './CRMPerfilCompras': { __esModule: true, default: () => null },
    './CRMPerfilInterna': { __esModule: true, default: () => null },
    './CRMSeguimiento': { __esModule: true, default: Seguimiento },
    './CRMComprasSicar': { __esModule: true, default: () => null, importe: String, fecha: String } });
  const props = { clienteRef: ficha.ref, nombreSucursal: String, puedeCambiar: true, onActualizado() { actualizaciones++; } };
  h.render(Ficha, props); await h.efectos();
  let arbol = h.render(Ficha, props);
  let control = nodos(arbol, Seguimiento)[0];
  assert.ok(control, 'Falta seguimiento en ficha');
  const guardar = control.props.onCambiar('interesado');
  resolver({ ok: true, json: async () => ({ ...ficha, estado: 'interesado' }) });
  await guardar;
  arbol = h.render(Ficha, props);
  control = nodos(arbol, Seguimiento)[0];
  assert.equal(control.props.ficha.estado, 'interesado');
  assert.equal(actualizaciones, 1);
  const tardio = control.props.onCambiar('interesado');
  h.desmontar();
  resolver({ ok: true, json: async () => ({ ...ficha, estado: 'interesado' }) });
  await tardio;
  assert.equal(actualizaciones, 1);
});
