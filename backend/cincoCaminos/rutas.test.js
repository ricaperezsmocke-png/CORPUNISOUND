const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.SENTRY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'cinco-caminos-desechable';
const app = require('../server');
const { obtenerConexionSqlite } = require('../persistencia');
const { firmarToken } = require('../auth');
const { semanaDe, ultimaSemanaCompleta } = require('./semanas');
const { fechaLocal } = require('../fechas');

const sqlite = obtenerConexionSqlite();
let ven = 0;
function sembrarTienda(suc, lunes, n) {
  sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
  for (let i = 0; i < n; i++) {
    sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
      VALUES (?, ?, ?, 'vigente', 1000, 'x')`).run(suc, `m${++ven}`, `${lunes}T12:00:00`);
  }
}
sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (1)').run();
sqlite.prepare(`INSERT INTO sicar_articulos (sucursal_id, art_id, descripcion, categoria, departamento, actualizado_en)
  VALUES (1, 'a1', 'Guitarra', 'ACUSTICAS', 'GUITARRAS', 'x'), (1, 'a2', 'Cuerdas', 'CUERDAS', 'ACCESORIOS', 'x'),
  (1, 'a3', 'Otra guitarra', 'ACUSTICAS', 'GUITARRAS', 'x'), (1, 'a4', 'Sin departamento', NULL, NULL, 'x')`).run();
sembrarTienda(1, '2026-10-12', 31);
sembrarTienda(2, '2026-10-12', 45);

// Permisos vecinos del mismo módulo `pos`: sin ellos la prueba pasaría con cualquier clave.
const vecinos = ['usar_gerente_ventas', 'administrar_metas_personalizadas'];
const roles = {
  971: vecinos,
  972: [...vecinos, 'ver_cinco_caminos'],
  973: [...vecinos, 'ver_cinco_caminos', 'ver_todas_las_sucursales'],
  974: [...vecinos, 'ver_cinco_caminos', 'administrar_manual_tacticas'],
  975: [...vecinos, 'administrar_manual_tacticas'],
  976: [...vecinos, 'ver_cinco_caminos', 'marcar_junta_cinco_caminos'],
  977: [...vecinos, 'marcar_junta_cinco_caminos'],
  978: [...vecinos, 'ver_cinco_caminos', 'marcar_junta_cinco_caminos', 'ver_todas_las_sucursales'],
  979: ['usar_gerente_ventas', 'ver_cinco_caminos', 'administrar_manual_tacticas'],
};
for (const [id, permisos] of Object.entries(roles)) {
  app.DB.admin.roles.push({ id: Number(id), nombre: `Cinco ${id}`, permisos, modulos: ['pos'] });
  app.DB.admin.usuarios.push({ id: Number(id), nombre: `Prueba ${id}`, usuario: `cc${id}`, rol_id: Number(id), sucursal_id: 1, activo: true });
}
const token = id => firmarToken({ id, rol_id: id, sucursal_id: 1 });

async function conServidor(t) {
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return (ruta, id, { token: propio, ...opciones } = {}) => fetch(base + ruta, { ...opciones,
    headers: { Authorization: `Bearer ${propio || token(id)}`, 'Content-Type': 'application/json' } })
    .then(async r => ({ status: r.status, datos: await r.json().catch(() => ({})) }));
}

test('permisos nuevos en el catálogo (módulo pos) y el guard de arranque los acepta', () => {
  const { PERMISOS } = require('../permisosCatalogo');
  for (const clave of ['ver_cinco_caminos', 'administrar_manual_tacticas', 'marcar_junta_cinco_caminos']) {
    const p = PERMISOS.find(x => x.clave === clave);
    assert.ok(p, clave);
    assert.equal(p.modulo, 'pos');
    assert.equal(p.implementado, true);
  }
  assert.doesNotThrow(() => require('../validarPermisos').validarSistemaDePermisos());
});

test('la semilla trae DB.pos.cinco_caminos para que sobreviva a la restauración', () => {
  assert.deepEqual(app.DB.pos.cinco_caminos.categorias, []);
});

test('tablero: permiso propio y alcance solo del token', async t => {
  const pedir = await conServidor(t);
  assert.equal((await pedir('/api/cinco-caminos/tablero?semana=2026-10-12', 971)).status, 403);
  assert.equal((await pedir('/api/cinco-caminos/tablero?semana=2026-10-12', 975)).status, 403, 'administrar no da para ver');
  // Sin "ver todas": ?sucursal_id= de otra tienda no abre nada, devuelve la del token.
  const propia = await pedir('/api/cinco-caminos/tablero?sucursal_id=2&semana=2026-10-14', 972);
  assert.equal(propia.status, 200);
  assert.equal(propia.datos.actual.sucursal_id, 1);
  assert.equal(propia.datos.actual.lunes, '2026-10-12');
  assert.equal(propia.datos.actual.ventas, 31);
  assert.ok(propia.datos.anterior && propia.datos.mismo_2025 && propia.datos.promedio_8);
  // Con "ver todas" el filtro sí elige la tienda.
  const ajena = await pedir('/api/cinco-caminos/tablero?sucursal_id=2&semana=2026-10-12', 973);
  assert.equal(ajena.status, 200);
  assert.equal(ajena.datos.actual.sucursal_id, 2);
  assert.equal(ajena.datos.actual.ventas, 45);
  assert.equal((await pedir('/api/cinco-caminos/tablero?sucursal_id=99&semana=2026-10-12', 973)).status, 404);
  assert.equal((await pedir('/api/cinco-caminos/tablero?semana=basura', 972)).status, 400);
  // Sin semana: la última semana completa.
  const porDefecto = await pedir('/api/cinco-caminos/tablero', 972);
  assert.equal(porDefecto.status, 200);
  assert.equal(porDefecto.datos.actual.lunes, ultimaSemanaCompleta(fechaLocal()));
  assert.equal(semanaDe(porDefecto.datos.actual.lunes).lunes, porDefecto.datos.actual.lunes);
});

test('categorías: ver con ver_cinco_caminos, cambiar con administrar_manual_tacticas y validadas', async t => {
  const pedir = await conServidor(t);
  const poner = (id, body) => pedir('/api/cinco-caminos/categorias', id, { method: 'PUT', body: JSON.stringify(body) });
  assert.equal((await pedir('/api/cinco-caminos/categorias', 971)).status, 403);
  assert.equal((await pedir('/api/cinco-caminos/categorias/disponibles', 971)).status, 403);
  assert.deepEqual((await pedir('/api/cinco-caminos/categorias', 972)).datos.categorias, []);
  const validas = [{ departamento: 'GUITARRAS', categoria: null, tipo: 'instrumento' },
    { departamento: 'ACCESORIOS', categoria: 'CUERDAS', tipo: 'accesorio' }];
  assert.equal((await poner(972, { categorias: validas })).status, 403, 'ver no da para cambiar');
  assert.equal((await poner(973, { categorias: validas })).status, 403, 'ver todas tampoco');
  const malas = [
    { categorias: [{ departamento: 'GUITARRAS', categoria: null, tipo: 'otro' }] },
    { categorias: [{ departamento: 'G'.repeat(101), categoria: null, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 'GUITARRAS', categoria: 'C'.repeat(101), tipo: 'instrumento' }] },
    { categorias: [{ departamento: '', categoria: null, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 5, categoria: null, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 'GUITARRAS', categoria: 7, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 'GUITARRAS', categoria: null, tipo: 'instrumento', extra: 1 }] },
    { categorias: [validas[0], { ...validas[0], tipo: 'accesorio' }] }, // la misma regla dos veces
    { categorias: 'GUITARRAS' },
    {},
  ];
  for (const body of malas) assert.equal((await poner(974, body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.deepEqual(app.DB.pos.cinco_caminos.categorias, [], 'un rechazo no cambia nada');
  const ok = await poner(974, { categorias: validas });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.datos.categorias, validas);
  assert.deepEqual(app.DB.pos.cinco_caminos.categorias, validas);
  const historial = app.DB.pos.cinco_caminos.categorias_historial;
  assert.equal(historial.length, 1);
  assert.equal(historial[0].usuario_id, 974);
  assert.deepEqual(historial[0].categorias, validas);
  assert.deepEqual((await pedir('/api/cinco-caminos/categorias', 972)).datos.categorias, validas);
  const disponibles = await pedir('/api/cinco-caminos/categorias/disponibles', 972);
  assert.equal(disponibles.status, 200);
  assert.deepEqual(disponibles.datos.disponibles, [
    { departamento: 'ACCESORIOS', categoria: 'CUERDAS', articulos: 1 },
    { departamento: 'GUITARRAS', categoria: 'ACUSTICAS', articulos: 2 },
  ]);
});

test('un error inesperado se registra (consola y Sentry) antes de responder 500', () => {
  const { registrarRutasCincoCaminos } = require('./rutas');
  const rutas = {};
  const registrar = metodo => (ruta, ...h) => { rutas[`${metodo} ${ruta}`] = h.at(-1); };
  const capturados = [];
  registrarRutasCincoCaminos({ get: registrar('GET'), put: registrar('PUT'), post: registrar('POST') }, {
    DB: { pos: { cinco_caminos: { categorias: [] } }, radar_demanda: { registros: [] } },
    sqlite: () => ({ prepare() { throw new Error('disco roto'); } }),
    requiereLogin: () => {}, requierePermiso: () => () => {}, resolverPermisosDeRol: () => [],
    resolverAlcanceAutorizado: () => ({ verTodas: false, sucursalId: 1 }), tiendas: () => [{ id: 1 }],
    capturarError: e => capturados.push(e.message),
  });
  const res = { codigo: 200, set() {}, status(c) { this.codigo = c; return this; }, json() { return this; } };
  const original = console.error;
  const lineas = [];
  console.error = (...args) => lineas.push(args.map(String).join(' '));
  try {
    rutas['GET /api/cinco-caminos/tablero']({ query: { semana: '2026-10-12' }, usuarioToken: { id: 1, sucursal_id: 1 } }, res);
  } finally { console.error = original; }
  assert.equal(res.codigo, 500);
  assert.deepEqual(capturados, ['disco roto']);
  assert.ok(lineas.some(l => l.includes('/api/cinco-caminos/tablero') && l.includes('disco roto')), lineas.join('|'));
});

const MANUAL = '/api/cinco-caminos/manual';
const NUEVA = { nombre: 'Táctica de ruta', camino: 'prospectos', numero_que_mueve: 'clientes_nuevos', quien: ['gerente'], como_se_mide: 'evidencia' };

test('manual: permisos por rol vecino, lectura y escritura', async t => {
  const pedir = await conServidor(t);
  const enviar = (id, ruta, metodo, body) => pedir(MANUAL + ruta, id, { method: metodo, body: JSON.stringify(body) });
  assert.equal((await pedir(MANUAL, 971)).status, 403, 'otros permisos pos no leen');
  assert.equal((await pedir(MANUAL, 975)).status, 403, 'administrar sin ver no lee');
  assert.equal((await pedir(`${MANUAL}/1/historial`, 971)).status, 403);
  const lectura = await pedir(MANUAL, 972);
  assert.equal(lectura.status, 200);
  assert.equal(lectura.datos.tacticas.length, 30);
  assert.match(lectura.datos.excluidas_texto, /2x1, 4x3/);
  assert.equal(lectura.datos.tacticas[0].historial, undefined);
  assert.equal((await enviar(972, '', 'POST', NUEVA)).status, 403, 'ver no da para crear');
  assert.equal((await enviar(972, '/1', 'PUT', { nombre: 'Nombre válido nuevo' })).status, 403);
  assert.equal((await enviar(972, '/1/retirar', 'POST', { motivo: 'No aplica ya' })).status, 403);
  assert.equal((await enviar(972, '/1/reactivar', 'POST', {})).status, 403);
  assert.equal((await enviar(973, '', 'POST', NUEVA)).status, 403, 'ver todas tampoco');
  assert.equal(app.DB.pos.cinco_caminos.tacticas.length, 30);

  const creada = await enviar(974, '', 'POST', NUEVA);
  assert.equal(creada.status, 201);
  assert.equal(creada.datos.tactica.id, 31);
  const id = creada.datos.tactica.id;
  const hist = (await pedir(`${MANUAL}/${id}/historial`, 972)).datos.historial;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].usuario_id, 974, 'el usuario sale del token');
  assert.equal((await enviar(974, `/${id}`, 'PUT', { nombre: 'Nombre ruta cambiado', usuario_id: 1 })).status, 400);
  assert.equal((await enviar(974, `/${id}`, 'PUT', { nombre: 'Nombre ruta cambiado' })).datos.tactica.nombre, 'Nombre ruta cambiado');
  assert.equal((await enviar(974, `/${id}/retirar`, 'POST', {})).status, 400);
  assert.equal((await enviar(974, `/${id}/retirar`, 'POST', { motivo: 'Se creó por error' })).datos.tactica.activa, false);
  assert.equal((await enviar(974, `/${id}/retirar`, 'POST', { motivo: 'Otra vez retirada' })).status, 409);
  assert.equal((await enviar(974, `/${id}/reactivar`, 'POST', {})).datos.tactica.activa, true);
  const completo = (await pedir(`${MANUAL}/${id}/historial`, 972)).datos.historial;
  assert.deepEqual(completo.map(h => h.accion), ['alta', 'cambio', 'retiro', 'reactivacion']);
  assert.ok(completo.every(h => h.usuario_id === 974));
  assert.equal((await enviar(974, '', 'POST', { ...NUEVA, etiquetas: {} })).status, 400);
  assert.equal((await enviar(974, '', 'POST', [])).status, 400);
});

test('manual: la etiqueta no se escribe por ninguna ruta y un PUT con etiquetas no cambia nada', async t => {
  const pedir = await conServidor(t);
  const antes = JSON.stringify(app.DB.pos.cinco_caminos.tacticas[2]);
  for (const body of [{ etiquetas: { 1: { estado: 'probada' } } }, { nombre: 'Nombre válido nuevo', etiquetas: {} },
    { 'etiquetas.1': 'probada' }, { etiqueta_tienda: { estado: 'probada' } }, { historial: [] }]) {
    assert.equal((await pedir(`${MANUAL}/3`, 974, { method: 'PUT', body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(JSON.stringify(app.DB.pos.cinco_caminos.tacticas[2]), antes);
});

test('manual: ?sucursal_id= no amplia el alcance de las etiquetas; ver todas si ve todas', async t => {
  const pedir = await conServidor(t);
  const { fijarEtiqueta } = require('./manual');
  fijarEtiqueta(app.DB, 4, 1, { estado: 'probada', mes: '2026-09', resultado: 'Propia' });
  fijarEtiqueta(app.DB, 4, 2, { estado: 'probada', mes: '2026-10', resultado: 'Secreto de la tienda dos' });
  const propia = await pedir(`${MANUAL}?sucursal_id=2`, 972);
  const t4 = propia.datos.tacticas.find(x => x.id === 4);
  assert.equal(t4.etiqueta_tienda.resultado, 'Propia');
  assert.equal(t4.probada_en, 2);
  assert.equal(t4.etiquetas, undefined);
  assert.equal(JSON.stringify(propia.datos).includes('Secreto de la tienda dos'), false);
  const hist = await pedir(`${MANUAL}/4/historial?sucursal_id=2`, 972);
  assert.equal(JSON.stringify(hist.datos).includes('Secreto de la tienda dos'), false);
  assert.ok(JSON.stringify(hist.datos).includes('Propia'));
  const todas = await pedir(`${MANUAL}?sucursal_id=2`, 973);
  const v4 = todas.datos.tacticas.find(x => x.id === 4);
  assert.equal(v4.etiquetas['2'].resultado, 'Secreto de la tienda dos');
  assert.equal(v4.etiqueta_tienda.resultado, 'Propia', 'la etiqueta de la tienda sale del token, no del filtro');
  assert.ok(JSON.stringify((await pedir(`${MANUAL}/4/historial`, 973)).datos).includes('Secreto de la tienda dos'));
  // Un administrador sin ver todas tampoco recibe etiquetas ajenas en la respuesta de escribir.
  const resp = await pedir(`${MANUAL}/4`, 974, { method: 'PUT', body: JSON.stringify({ descripcion: 'Texto nuevo' }) });
  assert.equal(resp.status, 200);
  assert.equal(JSON.stringify(resp.datos).includes('Secreto de la tienda dos'), false);
});

test('manual: el id de texto funciona y los ids raros son 404', async t => {
  const pedir = await conServidor(t);
  assert.equal((await pedir(`${MANUAL}/3/historial`, 972)).status, 200);
  const cuerpo = JSON.stringify({ nombre: 'Nombre válido nuevo' });
  for (const malo of ['3abc', '1e1', '0x10', '0', '-1', '3.5', '999']) {
    assert.equal((await pedir(`${MANUAL}/${malo}/historial`, 972)).status, 404, malo);
    assert.equal((await pedir(`${MANUAL}/${malo}`, 974, { method: 'PUT', body: cuerpo })).status, 404, malo);
  }
});

test('manual: el historial trae el nombre de quien hizo cada cambio, sin guardarlo en la base', async t => {
  const pedir = await conServidor(t);
  const { fijarEtiqueta } = require('./manual');
  const tactica = app.DB.pos.cinco_caminos.tacticas.find(x => x.id === 5);
  tactica.historial.push({ fecha_hora: '2026-10-01T00:00:00.000Z', usuario_id: 9999, accion: 'cambio', antes: {}, despues: {} });
  fijarEtiqueta(app.DB, 5, 1, { estado: 'probada', mes: '2026-09', resultado: 'Hecha por el sistema' });
  await pedir(`${MANUAL}/5`, 974, { method: 'PUT', body: JSON.stringify({ descripcion: 'Con nombre de usuario' }) });
  const hist = (await pedir(`${MANUAL}/5/historial`, 972)).datos.historial;
  assert.equal(hist.find(h => h.usuario_id === 9999).usuario_nombre, 'Usuario #9999 (ya no existe)');
  assert.equal(hist.find(h => h.usuario_id === 974).usuario_nombre, 'Prueba 974');
  const sistema = hist.find(h => h.accion === 'etiqueta');
  assert.equal(sistema.usuario_id, null);
  assert.equal(sistema.usuario_nombre, null);
  assert.equal(JSON.stringify(app.DB.pos.cinco_caminos.tacticas).includes('Prueba 974'), false, 'el nombre no se guarda');
});

// ---- Junta del lunes ----
const JUNTA = '/api/cinco-caminos/junta';
const { sumarDias } = require('./semanas');
const hoyJ = fechaLocal();
const lunesJ = semanaDe(hoyJ).lunes;
const POST = datos => ({ method: 'POST', body: JSON.stringify(datos) });
const compromisoBase = (extra = {}) => ({ texto: 'Pedir el teléfono en cada venta', responsable: 'Cajera', fecha_compromiso: sumarDias(lunesJ, 1), ...extra });
const limpiarJunta = () => { app.DB.pos.cinco_caminos.compromisos = []; app.DB.pos.cinco_caminos.juntas = []; };

test('junta: los roles vecinos no escriben sin el permiso de marcar, y marcar no da para ver', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  assert.equal((await pedir(`${JUNTA}?lunes=${lunesJ}`, 972)).status, 200);
  assert.equal((await pedir(`${JUNTA}?lunes=${lunesJ}`, 971)).status, 403);
  assert.equal((await pedir(`${JUNTA}?lunes=${lunesJ}`, 977)).status, 403, 'marcar no da para ver');
  for (const id of [971, 972, 974, 975]) {
    assert.equal((await pedir(`${JUNTA}/compromisos`, id, POST(compromisoBase()))).status, 403, `crear ${id}`);
    assert.equal((await pedir(`${JUNTA}/compromisos/1/hecho`, id, POST({}))).status, 403, `hecho ${id}`);
    assert.equal((await pedir(`${JUNTA}/compromisos/1/cancelar`, id, POST({ motivo: 'Motivo' }))).status, 403, `cancelar ${id}`);
    assert.equal((await pedir(`${JUNTA}/hecha`, id, POST({ lunes: lunesJ }))).status, 403, `hecha ${id}`);
  }
  assert.equal(app.DB.pos.cinco_caminos.compromisos.length, 0);
});

test('junta: flujo completo con el usuario del token y errores 400/409', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  assert.equal((await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: lunesJ }))).status, 400, 'sin compromisos');
  const c = await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase()));
  assert.equal(c.status, 201);
  assert.equal(c.datos.compromiso.creado_por_id, 976);
  assert.equal(c.datos.compromiso.sucursal_id, 1);
  assert.equal(c.datos.compromiso.lunes, lunesJ);
  const id = c.datos.compromiso.id;
  assert.equal((await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase({ texto: 'x' })))).status, 400);
  assert.equal((await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase({ sucursal_id: 2 })))).status, 400, 'el cuerpo no elige tienda');
  assert.equal((await pedir(`${JUNTA}/compromisos/${id}/cancelar`, 976, POST({}))).status, 400, 'sin motivo');
  const otro = (await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase()))).datos.compromiso.id;
  assert.equal((await pedir(`${JUNTA}/compromisos/${otro}/cancelar`, 976, POST({ motivo: 'Ya no aplica' }))).status, 200);
  assert.equal((await pedir(`${JUNTA}/compromisos/${otro}/hecho`, 976, POST({}))).status, 409, 'cancelado no se marca hecho');
  const h = await pedir(`${JUNTA}/compromisos/${id}/hecho`, 976, POST({}));
  assert.equal(h.status, 200);
  assert.equal(h.datos.compromiso.hecho.por_id, 976);
  assert.equal(h.datos.compromiso.hecho.por_nombre, 'Prueba 976');
  assert.equal((await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: sumarDias(lunesJ, 7) }))).status, 400, 'lunes futuro');
  assert.equal((await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: sumarDias(lunesJ, 1) }))).status, 400, 'no es lunes');
  const j = await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: lunesJ }));
  assert.equal(j.status, 200);
  assert.equal(j.datos.junta.por_id, 976);
  assert.equal((await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: lunesJ }))).status, 409);
  const v = await pedir(`${JUNTA}?lunes=${lunesJ}`, 972);
  assert.equal(v.datos.compromisos.length, 2);
  assert.equal(v.datos.junta.por_id, 976);
  assert.equal(v.datos.indicador.semanas, 8);
  assert.equal(app.DB.pos.cinco_caminos.compromisos.length, 2, 'nada se borra');
});

test('junta: ?sucursal_id= no amplía el alcance; con "ver todas" solo filtra la lectura', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  app.DB.pos.cinco_caminos.compromisos.push({ id: 50, sucursal_id: 2, lunes: lunesJ, texto: 'De la tienda dos', responsable: 'Gerente',
    fecha_compromiso: sumarDias(lunesJ, 1), hecho: null, cancelado: null, creado_por_id: 1, creado_en: 'x' });
  const propia = await pedir(`${JUNTA}?sucursal_id=2&lunes=${lunesJ}`, 972);
  assert.equal(propia.datos.compromisos.length, 0);
  const ajena = await pedir(`${JUNTA}?sucursal_id=2&lunes=${lunesJ}`, 978);
  assert.equal(ajena.datos.compromisos.length, 1);
  assert.equal((await pedir(`${JUNTA}/compromisos/50/hecho?sucursal_id=2`, 976, POST({}))).status, 404);
  assert.equal((await pedir(`${JUNTA}/compromisos/50/hecho?sucursal_id=2`, 978, POST({}))).status, 404);
  const c = await pedir(`${JUNTA}/compromisos?sucursal_id=2`, 978, POST(compromisoBase()));
  assert.equal(c.datos.compromiso.sucursal_id, 1);
});

test('junta: el indicador cuenta con huecos y no hay ruta para editar el texto', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  const previa = ultimaSemanaCompleta(hoyJ);
  for (const lunes of [previa, sumarDias(previa, -14), sumarDias(previa, -28), sumarDias(previa, -70)]) {
    app.DB.pos.cinco_caminos.juntas.push({ sucursal_id: 1, lunes, por_id: 1, en: 'x' });
  }
  app.DB.pos.cinco_caminos.juntas.push({ sucursal_id: 2, lunes: sumarDias(previa, -7), por_id: 1, en: 'x' });
  const v = await pedir(`${JUNTA}?lunes=${lunesJ}`, 972);
  assert.deepEqual(v.datos.indicador, { semanas: 8, con_junta: 3, pct: 38 }, 'la de hace 10 semanas queda fuera');
  const c = (await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase()))).datos.compromiso;
  for (const metodo of ['PUT', 'PATCH', 'DELETE']) {
    const r = await pedir(`${JUNTA}/compromisos/${c.id}`, 976, { method: metodo, body: JSON.stringify({ texto: 'Otro texto distinto' }) });
    assert.equal(r.status, 404, metodo);
  }
  assert.equal(app.DB.pos.cinco_caminos.compromisos.find(x => x.id === c.id).texto, c.texto);
});

test('junta: un rol con "ver todas" pero sin permiso de marcar recibe 403 al escribir', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  assert.equal((await pedir(`${JUNTA}?lunes=${lunesJ}`, 973)).status, 200);
  assert.equal((await pedir(`${JUNTA}/compromisos`, 973, POST(compromisoBase()))).status, 403);
  assert.equal((await pedir(`${JUNTA}/compromisos/1/hecho`, 973, POST({}))).status, 403);
  assert.equal((await pedir(`${JUNTA}/compromisos/1/cancelar`, 973, POST({ motivo: 'Motivo' }))).status, 403);
  assert.equal((await pedir(`${JUNTA}/hecha`, 973, POST({ lunes: lunesJ }))).status, 403);
  assert.equal(app.DB.pos.cinco_caminos.compromisos.length, 0);
});

test('junta: lunes pasado da 400 y la lectura trae nombres', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  const pasado = sumarDias(lunesJ, -7);
  assert.equal((await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase({ lunes: pasado, fecha_compromiso: lunesJ })))).status, 400);
  assert.equal((await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: pasado }))).status, 400);
  await pedir(`${JUNTA}/compromisos`, 976, POST(compromisoBase()));
  await pedir(`${JUNTA}/hecha`, 976, POST({ lunes: lunesJ }));
  const v = await pedir(`${JUNTA}?lunes=${lunesJ}`, 972);
  assert.equal(v.datos.junta.por_nombre, 'Prueba 976');
  assert.equal(v.datos.compromisos[0].creado_por_nombre, 'Prueba 976');
  assert.equal((await pedir(`${JUNTA}?lunes=${pasado}`, 972)).status, 200, 'ver semanas pasadas sigue permitido');
});

test('junta: un token sin tienda valida recibe 403 al escribir, igual que al leer', async t => {
  limpiarJunta();
  const pedir = await conServidor(t);
  for (const sucursal_id of [null, 0, 'abc']) {
    const propio = firmarToken({ id: 976, rol_id: 976, sucursal_id });
    const con = (ruta, datos) => pedir(ruta, 976, { ...POST(datos), token: propio });
    assert.equal((await con(`${JUNTA}/compromisos`, compromisoBase())).status, 403, `crear ${sucursal_id}`);
    assert.equal((await con(`${JUNTA}/compromisos/1/hecho`, {})).status, 403, `hecho ${sucursal_id}`);
    assert.equal((await con(`${JUNTA}/compromisos/1/cancelar`, { motivo: 'Motivo' })).status, 403, `cancelar ${sucursal_id}`);
    assert.equal((await con(`${JUNTA}/hecha`, { lunes: lunesJ })).status, 403, `hecha ${sucursal_id}`);
  }
  assert.equal(app.DB.pos.cinco_caminos.compromisos.length, 0);
});

// ---- Plan del mes: proponer, validar, descartar y ver (cliente falso, nunca la API real) ----
function sembrarTiendaPlanMes(id = 91) {
  const hoy = fechaLocal();
  const lunesHoy = semanaDe(hoy).lunes;
  const dia = (lunes, n) => new Date(Date.parse(`${lunes}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  if (!app.DB.pos.sucursales.some(x => x.id === id)) app.DB.pos.sucursales.push({ id, nombre: 'Prueba plan mes' });
  sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(id);
  for (let i = 1; i <= 8; i++) {
    const lunes = dia(lunesHoy, -7 * i);
    for (let j = 0; j < 30; j++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (?, ?, ?, 'vigente', 10000, 'x')`).run(id, `pm${++ven}`, `${dia(lunes, j % 7)}T10:00:00`);
    }
    for (let j = 0; j < 40; j++) {
      const cli = `pc${++ven}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, ?, ?)').run(id, cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (?, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(id, `pv${++ven}`, cli, `${dia(lunes, j % 7)}T12:00:00`);
    }
  }
}
function iaFalsa() {
  return { messages: { create: async cuerpo => {
    const { datos } = JSON.parse(cuerpo.messages[0].content);
    const [a, b] = datos.manual.map(x => x.id);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ camino: 'prospectos', por_que_camino: 'Faltan clientes',
      tacticas: [{ id: a, por_que: 'Sencilla' }, { id: b, por_que: 'Probada' }],
      metas: [{ numero: 'ticket_promedio_centavos', valor: 110, responsable_rol: 'gerente', por_que: 'Subir el ticket' }] }) }] };
  } } };
}

test('plan del mes: permisos, proponer, validar, 409, ver y descartar', async t => {
  sembrarTiendaPlanMes();
  app.locals.clienteIA = iaFalsa();
  t.after(() => { delete app.locals.clienteIA; });
  const pedir = await conServidor(t);
  const mes = fechaLocal().slice(0, 7);
  const post = (ruta, id, cuerpo) => pedir(ruta, id, { method: 'POST', body: JSON.stringify(cuerpo) });
  const base = '/api/cinco-caminos/plan-mes';

  // Rol vecino (ver cinco caminos + administrar manual, SIN administrar metas) y rol sin ver: 403.
  assert.equal((await post(`${base}/proponer`, 979, { sucursal_id: 91, mes })).status, 403);
  assert.equal((await pedir(`${base}/borradores`, 979)).status, 403);
  assert.equal((await pedir(`${base}?mes=${mes}`, 971)).status, 403, 'administrar metas no da para ver el plan');
  assert.equal((await post(`${base}/1/validar`, 979, {})).status, 403);
  assert.equal((await post(`${base}/1/descartar`, 979, { motivo: 'x' })).status, 403);

  const nuevo = await post(`${base}/proponer`, 973, { sucursal_id: 91, mes });
  assert.equal(nuevo.status, 200, JSON.stringify(nuevo.datos));
  assert.equal(nuevo.datos.estado, 'borrador');
  const otro = await post(`${base}/proponer`, 973, { sucursal_id: 91, mes });
  const lista = await pedir(`${base}/borradores?sucursal_id=91&mes=${mes}`, 973);
  assert.equal(lista.status, 200);
  assert.equal(lista.datos.borradores.length, 2);

  const plan = nuevo.datos;
  const cuerpo = { camino: { decision: 'aceptar' }, tacticas: plan.propuesta.tacticas.map(x => ({ id: x.id, decision: 'aceptar' })),
    metas: plan.propuesta.metas.map(m => ({ numero: m.numero, decision: 'aceptar' })) };
  const fuera = await post(`${base}/${plan.id}/validar`, 973, { ...cuerpo, metas: [{ numero: 'ticket_promedio_centavos', decision: 'cambiar', valor: 500 }] });
  assert.equal(fuera.status, 400);
  const hecho = await post(`${base}/${plan.id}/validar`, 973, cuerpo);
  assert.equal(hecho.status, 200, JSON.stringify(hecho.datos));
  assert.equal((await post(`${base}/${otro.datos.id}/validar`, 973, cuerpo)).status, 409);
  assert.equal((await post(`${base}/proponer`, 973, { sucursal_id: 91, mes })).status, 409);

  // Ver: alcance por token. Sin "ver todas", la tienda del token (1) no tiene plan aunque se pida la 91.
  const propio = await pedir(`${base}?mes=${mes}&sucursal_id=91`, 972);
  assert.equal(propio.status, 200);
  assert.equal(propio.datos.plan, null);
  const ajeno = await pedir(`${base}?mes=${mes}&sucursal_id=91`, 973);
  assert.equal(ajeno.status, 200);
  assert.equal(ajeno.datos.plan.camino, 'prospectos');
  assert.equal(ajeno.datos.plan.tacticas.length, 2);
  assert.ok(ajeno.datos.plan.tacticas[0].nombre);
  assert.equal(ajeno.datos.plan.metas[0].valor_meta, 11000);
  assert.ok('porcentaje' in ajeno.datos.plan.metas[0]);
  assert.equal((await pedir(`${base}?mes=basura`, 973)).status, 400);

  const descartado = await post(`${base}/${otro.datos.id}/descartar`, 973, { motivo: 'Ya hay plan' });
  assert.equal(descartado.status, 200);
  assert.equal((await post(`${base}/${otro.datos.id}/descartar`, 973, { motivo: 'Otra vez' })).status, 400);
});

test('plan del mes: sin cliente de IA responde 503 y una falla de la IA 502', async t => {
  const pedir = await conServidor(t);
  const mes = fechaLocal().slice(0, 7);
  t.after(() => { delete app.locals.clienteIA; });
  app.locals.clienteIA = null;
  const sin = await pedir('/api/cinco-caminos/plan-mes/proponer', 973, { method: 'POST', body: JSON.stringify({ sucursal_id: 91, mes: `${mes}` }) });
  assert.equal(sin.status, 503);
  app.locals.clienteIA = { messages: { create: async () => { throw new Error('boom'); } } };
  const mala = await pedir('/api/cinco-caminos/plan-mes/proponer', 973, { method: 'POST', body: JSON.stringify({ sucursal_id: 1, mes }) });
  assert.equal(mala.status, 502);
});

test('plan del mes: sin "ver todas" solo se opera la tienda del token', async t => {
  sembrarTiendaPlanMes(1);
  app.locals.clienteIA = iaFalsa();
  t.after(() => { delete app.locals.clienteIA; });
  const pedir = await conServidor(t);
  const [a, m] = fechaLocal().slice(0, 7).split('-').map(Number);
  const siguiente = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  const post = (ruta, id, cuerpo) => pedir(ruta, id, { method: 'POST', body: JSON.stringify(cuerpo) });
  const base = '/api/cinco-caminos/plan-mes';
  // Un borrador de la tienda 91 hecho por quien ve todas las tiendas.
  const ajeno = await post(`${base}/proponer`, 973, { sucursal_id: 91, mes: siguiente });
  assert.equal(ajeno.status, 200, JSON.stringify(ajeno.datos));
  // 971 tiene administrar metas, NO ver todas las tiendas (token: tienda 1).
  assert.equal((await post(`${base}/proponer`, 971, { sucursal_id: 91, mes: siguiente })).status, 403);
  assert.equal((await post(`${base}/proponer`, 971, {})).status, 403);
  assert.equal((await post(`${base}/${ajeno.datos.id}/validar`, 971, {})).status, 403);
  assert.equal((await post(`${base}/${ajeno.datos.id}/descartar`, 971, { motivo: 'x' })).status, 403);
  const propio = await post(`${base}/proponer`, 971, { sucursal_id: 1, mes: siguiente });
  assert.equal(propio.status, 200, JSON.stringify(propio.datos));
  const lista = await pedir(`${base}/borradores?sucursal_id=91`, 971);
  assert.equal(lista.status, 200);
  assert.deepEqual(lista.datos.borradores.map(x => x.id), [propio.datos.id], 'nunca lista otra tienda');
  assert.equal((await post(`${base}/${propio.datos.id}/descartar`, 971, { motivo: 'prueba' })).status, 200);
  assert.equal((await post(`${base}/${ajeno.datos.id}/descartar`, 973, { motivo: 'prueba' })).status, 200);
});
