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

test('lista etiqueta VIP e interna; Solo VIP envía 1 y reinicia paginación; propaga permiso', async () => {
  const h = hooks(), rutas = [];
  const Ficha = () => null;
  const api = { apiFetch: async ruta => {
    rutas.push(ruta);
    return ok(ruta === '/auth/yo' ? { permisos: ['marcar_cuenta_interna'] } : ruta.includes('/clientes?')
      ? { items: [{ ref: 'crm:10', nombre: 'Ana', vip: true }, { ref: 'crm:20', nombre: 'Tienda', cuenta_interna: {} }], siguiente: 50 }
      : { sucursales: [] });
  } };
  const Lista = cargar('CRMListaClientes.jsx', { react: h.react, './api': api, './CRMFichaCliente': { __esModule: true, default: Ficha } }).default;
  const props = { nombreSucursal: String };
  h.render(Lista, props); await h.efectos();
  let arbol = h.render(Lista, props);
  const html = renderToStaticMarkup(arbol);
  assert.match(html, /VIP/);
  assert.match(html, /Cuenta interna/);
  nodos(arbol, 'button').find(n => n.props.children === 'Siguiente').props.onClick();
  h.render(Lista, props); await h.efectos();
  arbol = h.render(Lista, props);
  const filtro = nodos(arbol, 'input').find(n => n.props['aria-label'] === 'Solo VIP');
  assert.ok(filtro);
  filtro.props.onChange({ target: { checked: true } });
  h.render(Lista, props); await h.efectos();
  assert.match(rutas.filter(r => r.includes('/clientes?')).at(-1), /cursor=0.*vip=1/);
  arbol = h.render(Lista, props);
  nodos(arbol, 'button').find(n => n.key === 'crm:10').props.onClick();
  assert.equal(nodos(h.render(Lista, props), Ficha)[0].props.puedeMarcarInterna, true);
});
test('qué compra muestra departamentos con sus categorías, piezas, artículos y ajuste solo distinto de cero', async () => {
  const h = hooks();
  const datos = { departamentos: [{ nombre: 'Instrumentos', monto_centavos: 10000, piezas: 2,
    categorias: [{ nombre: 'Cuerdas', monto_centavos: 7000, piezas: 1 }, { nombre: 'Sin categoría', monto_centavos: 3000, piezas: 1 }] }],
    articulos: [{ clave: 'G-1', descripcion: 'Guitarra', monto_centavos: 10000, piezas: 2, ultima_fecha: '2026-10-15' }],
    ajustes_centavos: -1000, total_centavos: 9000 };
  const rutas = [];
  const Componente = cargar('CRMPerfilCompras.jsx', { react: h.react,
    './api': { apiFetch: async ruta => { rutas.push(ruta); return ok(datos); } } }).default;
  h.render(Componente, { clienteRef: 'crm:10' }); await h.efectos();
  let html = renderToStaticMarkup(h.render(Componente, { clienteRef: 'crm:10' }));
  for (const texto of ['Departamentos', 'Instrumentos', 'Cuerdas', 'Sin categoría', '$70', '$30', 'Guitarra', '2',
    'Ajustes y descuentos de la venta', '$-10', '$90']) assert.ok(html.includes(texto), texto);
  assert.ok(html.indexOf('Instrumentos') < html.indexOf('Cuerdas'), 'categoría debajo de su departamento');
  assert.deepEqual(rutas, ['/crm/v2/clientes/crm%3A10/que-compra']);
  datos.ajustes_centavos = 0;
  html = renderToStaticMarkup(h.render(Componente, { clienteRef: 'crm:10' }));
  assert.doesNotMatch(html, /Ajustes y descuentos de la venta/);
});
test('qué compra descarta respuesta anterior al cambiar persona y muestra errores', async () => {
  const h = hooks();
  let tardia;
  const Componente = cargar('CRMPerfilCompras.jsx', { react: h.react, './api': { apiFetch: ruta => ruta.includes('10')
    ? new Promise(resolve => { tardia = resolve; }) : Promise.resolve({ ok: false, json: async () => ({ error: 'Sin acceso' }) }) } }).default;
  h.render(Componente, { clienteRef: 'crm:10' }); await h.efectos();
  h.render(Componente, { clienteRef: 'crm:20' }); await h.efectos();
  tardia(ok({ departamentos: [], articulos: [], total_centavos: 999 }));
  await h.efectos();
  const html = renderToStaticMarkup(h.render(Componente, { clienteRef: 'crm:20' }));
  assert.match(html, /Sin acceso/);
  assert.doesNotMatch(html, /999/);
});
test('control de cuenta interna oculta acción sin permiso y muestra historial', () => {
  const Componente = cargar('CRMPerfilInterna.jsx').default;
  const ficha = { cuenta_interna: { motivo: 'Tienda', usuario_nombre: 'Victor' },
    historial_interna: [{ id: 1, anterior: false, nuevo: true, motivo: 'Tienda', usuario_nombre: 'Victor', fecha_hora: '2026-10-15T12:00:00Z' }] };
  const html = renderToStaticMarkup(React.createElement(Componente, { ficha, puedeMarcar: false }));
  assert.match(html, /Cuenta interna/);
  assert.match(html, /Victor/);
  assert.match(html, /Tienda/);
  assert.doesNotMatch(html, /<button/);
});
test('formulario pide motivo, bloquea envío y conserva motivo si falla', async () => {
  const h = hooks(), enviados = [];
  const Componente = cargar('CRMPerfilInterna.jsx', { react: h.react }).default;
  const props = { ficha: { cuenta_interna: null }, puedeMarcar: true, guardando: false,
    onCambiar: async (...args) => { enviados.push(args); return false; } };
  let arbol = h.render(Componente, props);
  nodos(arbol, 'button').find(n => n.props.children === 'Es cuenta interna').props.onClick();
  arbol = h.render(Componente, props);
  const campo = nodos(arbol, 'textarea')[0];
  assert.ok(campo.props.required);
  assert.equal(campo.props.maxLength, 200);
  campo.props.onChange({ target: { value: '  Tienda  ' } });
  arbol = h.render(Componente, props);
  await nodos(arbol, 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(enviados, [[true, 'Tienda']]);
  assert.equal(nodos(h.render(Componente, props), 'textarea')[0].props.value.trim(), 'Tienda');
  arbol = h.render(Componente, { ...props, guardando: true });
  assert.ok(nodos(arbol, 'button').every(n => n.props.disabled));
});
test('ficha muestra VIP y monto, guarda marca, actualiza lista y rechaza respuesta tardía', async () => {
  const h = hooks();
  let resolver, actualizaciones = 0;
  const Interna = () => null, Compras = () => null;
  const ficha = { ref: 'crm:10', fuente: 'crm', cliente_id: 10, nombre: 'Ana', vip: true, monto_12m_centavos: 2000000 };
  const api = { apiFetch: async (ruta, opciones) => {
    if (!opciones) return ok(ficha);
    assert.equal(ruta, '/crm/v2/clientes/crm%3A10/cuenta-interna');
    assert.deepEqual(JSON.parse(opciones.body), { interna: true, motivo: 'Tienda' });
    return new Promise(resolve => { resolver = resolve; });
  } };
  const Componente = cargar('CRMFichaCliente.jsx', { react: h.react, './api': api,
    './CRMPerfilInterna': { __esModule: true, default: Interna }, './CRMPerfilCompras': { __esModule: true, default: Compras } }).default;
  const props = { clienteRef: 'crm:10', nombreSucursal: String, puedeMarcarInterna: true, onActualizado() { actualizaciones++; } };
  h.render(Componente, props); await h.efectos();
  let arbol = h.render(Componente, props);
  assert.match(renderToStaticMarkup(arbol), /VIP.*\$20000 en 12 meses/);
  assert.equal(nodos(arbol, Compras)[0].props.clienteRef, 'crm:10');
  let control = nodos(arbol, Interna)[0];
  assert.equal(control.props.puedeMarcar, true);
  const guardado = control.props.onCambiar(true, 'Tienda');
  resolver(ok({ ...ficha, vip: false, cuenta_interna: { motivo: 'Tienda' }, historial_interna: [{ id: 1 }] }));
  assert.equal(await guardado, true);
  arbol = h.render(Componente, props);
  assert.doesNotMatch(renderToStaticMarkup(arbol), /VIP/);
  assert.equal(actualizaciones, 1);
  control = nodos(arbol, Interna)[0];
  assert.equal(control.props.ficha.historial_interna.length, 1);
  const tardio = control.props.onCambiar(true, 'Tienda');
  h.desmontar();
  resolver(ok(ficha));
  await tardio;
  assert.equal(actualizaciones, 1);
});
