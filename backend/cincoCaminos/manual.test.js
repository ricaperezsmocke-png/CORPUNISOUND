const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  sembrarManual, validarTactica, crearTactica, cambiarTactica, retirarTactica, reactivarTactica, fijarEtiqueta, vistaManual, NUMEROS,
} = require('./manual');
const { TACTICAS_V1 } = require('./manualSemilla');

function prepararDB() {
  return { pos: { cinco_caminos: { categorias: [], categorias_historial: [] } } };
}
function sembrada() {
  const DB = prepararDB();
  sembrarManual(DB);
  return DB;
}
const BASE = {
  nombre: 'Táctica de prueba', camino: 'prospectos', numero_que_mueve: 'clientes_nuevos', quien: ['gerente'], como_se_mide: 'evidencia',
};
const status = (codigo) => (e) => e.status === codigo;

test('la siembra crea exactamente las 30 tacticas del manual v1, con ids y numero_v1 1..30', () => {
  const DB = prepararDB();
  assert.equal(sembrarManual(DB), 30);
  const lista = DB.pos.cinco_caminos.tacticas;
  assert.equal(lista.length, 30);
  lista.forEach((t, i) => {
    assert.equal(t.id, i + 1);
    assert.equal(t.numero_v1, i + 1);
    assert.equal(t.activa, true);
    assert.deepEqual(t.etiquetas, {});
    assert.equal(t.historial.length, 1);
    assert.equal(t.historial[0].accion, 'alta');
    assert.equal(t.historial[0].usuario_id, null);
    assert.equal(t.historial[0].origen, 'semilla_v1');
  });
  assert.equal(lista[0].nombre, 'Teléfono y nombre del cliente en toda venta de más de $500');
  assert.equal(lista[3].nombre, 'Preguntar "¿quién te mandó?" y anotarlo');
  assert.equal(lista[15].nombre, 'Recordatorio de cambio de cuerdas a los 60–90 días');
  assert.equal(lista[18].nombre, 'Calendario y presupuesto de iglesias y escuelas anotados en el CRM');
  assert.equal(lista[29].nombre, 'Empujar accesorios y marcas de mayor margen');
});

test('los nombres de la siembra coinciden con el manual v1 y no traen mojibake', () => {
  const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'superpowers', 'specs', '2026-10-24-manual-tacticas-v1.md'), 'utf8');
  const filas = manual.split('\n').filter(l => /^\| \d+ \|/.test(l)).map(l => l.split('|').map(c => c.trim()));
  assert.equal(filas.length, 30);
  for (const f of filas) {
    const t = TACTICAS_V1[Number(f[1]) - 1];
    const sinPdf = f[2].replace(/\s*\(PDF [^)]*\)/, '');
    assert.equal(t.nombre, sinPdf, `táctica ${f[1]}`);
    const pdf = /\((PDF [^)]*)\)/.exec(f[2]);
    assert.equal(t.referencia_pdf, pdf ? pdf[1] : '', `referencia ${f[1]}`);
  }
  for (const t of TACTICAS_V1) {
    assert.doesNotMatch(`${t.nombre}${t.descripcion}`, /[�ÃÂ]/);
  }
});

test('la siembra cumple el modelo: caminos, numeros y candados validos', () => {
  const DB = sembrada();
  for (const t of DB.pos.cinco_caminos.tacticas) {
    assert.ok(NUMEROS.includes(t.numero_que_mueve), t.nombre);
    assert.ok(t.candado === null || NUMEROS.includes(t.candado), t.nombre);
    assert.notEqual(t.candado, t.numero_que_mueve);
    assert.ok(t.quien.length > 0);
  }
  const por = (n) => DB.pos.cinco_caminos.tacticas[n - 1];
  assert.equal(por(3).candado, 'pct_con_cliente');
  assert.equal(por(10).candado, 'registros_por_10_tickets');
  assert.equal(por(24).candado, 'articulos_por_ticket');
  assert.equal(por(22).candado, 'ticket_promedio_centavos');
  assert.equal(por(21).candado, null);
  assert.equal(por(9).numero_que_mueve, 'registros_por_10_tickets');
  assert.equal(por(26).numero_que_mueve, 'descuento_promedio');
  assert.equal(por(1).como_se_mide, 'sistema');
  assert.equal(por(3).como_se_mide, 'sistema_y_evidencia');
  assert.equal(por(10).como_se_mide, 'sistema_y_evidencia');
  assert.equal(por(30).como_se_mide, 'fase_3');
});

test('correr la siembra dos veces no duplica nada', () => {
  const DB = sembrada();
  assert.equal(sembrarManual(DB), 0);
  assert.equal(DB.pos.cinco_caminos.tacticas.length, 30);
});

test('una lista vacia o corregida no se vuelve a sembrar', () => {
  const DB = prepararDB();
  DB.pos.cinco_caminos.tacticas = [];
  assert.equal(sembrarManual(DB), 0);
  assert.equal(DB.pos.cinco_caminos.tacticas.length, 0);
  const DB2 = sembrada();
  cambiarTactica(DB2, 1, { nombre: 'Nombre corregido por el gerente' }, 7);
  sembrarManual(DB2);
  assert.equal(DB2.pos.cinco_caminos.tacticas[0].nombre, 'Nombre corregido por el gerente');
});

test('la siembra funciona aunque la base no traiga cinco_caminos', () => {
  const DB = { pos: {} };
  assert.equal(sembrarManual(DB), 30);
  assert.ok(Array.isArray(DB.pos.cinco_caminos.tacticas));
});

test('validacion: campo desconocido, catalogo, quien vacio, nombre corto y etiquetas se rechazan', () => {
  assert.ok(validarTactica(BASE, { parcial: false }));
  assert.equal(validarTactica({ ...BASE, extra: 1 }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, camino: 'otro' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, numero_que_mueve: 'inventado' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, candado: 'inventado' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, candado: 'clientes_nuevos' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, quien: [] }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, quien: ['gerente', 'intruso'] }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, quien: ['gerente', 'gerente'] }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, quien: 'gerente' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, nombre: 'ab' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, nombre: 'x'.repeat(121) }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, nombre: 5 }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, descripcion: 'x'.repeat(601) }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, referencia_pdf: 'x'.repeat(61) }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, como_se_mide: 'a_ojo' }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, etiquetas: {} }, { parcial: false }), null);
  assert.equal(validarTactica({ ...BASE, etiquetas: { 1: { estado: 'probada' } } }, { parcial: false }), null);
  for (const prohibido of ['id', 'numero_v1', 'activa', 'historial', 'motivo_retiro', 'creada_en']) {
    assert.equal(validarTactica({ ...BASE, [prohibido]: 1 }, { parcial: false }), null, prohibido);
  }
  assert.equal(validarTactica(null, { parcial: false }), null);
  assert.equal(validarTactica([], { parcial: false }), null);
  // Alta completa exige los obligatorios; el cambio parcial no.
  assert.equal(validarTactica({ nombre: 'Solo nombre' }, { parcial: false }), null);
  assert.deepEqual(validarTactica({ nombre: 'Solo nombre' }, { parcial: true }), { nombre: 'Solo nombre' });
  assert.equal(validarTactica({}, { parcial: true }), null);
});

test('crearTactica: id consecutivo, defaults, historial de alta con el usuario y etiquetas vacias', () => {
  const DB = sembrada();
  const t = crearTactica(DB, BASE, 42);
  assert.equal(t.id, 31);
  assert.equal(t.numero_v1, null);
  assert.equal(t.activa, true);
  assert.equal(t.candado, null);
  assert.equal(t.descripcion, '');
  assert.deepEqual(t.etiquetas, {});
  assert.equal(t.historial.length, 1);
  assert.equal(t.historial[0].accion, 'alta');
  assert.equal(t.historial[0].usuario_id, 42);
  assert.match(t.historial[0].fecha_hora, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(DB.pos.cinco_caminos.tacticas.length, 31);
  assert.throws(() => crearTactica(DB, { ...BASE, etiquetas: {} }, 42), status(400));
  assert.equal(DB.pos.cinco_caminos.tacticas.length, 31);
});

test('cambio parcial: el historial guarda solo lo que cambio, y quien', () => {
  const DB = sembrada();
  const antes = JSON.parse(JSON.stringify(DB.pos.cinco_caminos.tacticas[4]));
  const t = cambiarTactica(DB, 5, { nombre: 'Clínica mensual con asistentes', quien: ['encargado'], descripcion: antes.descripcion }, '9');
  assert.equal(t.nombre, 'Clínica mensual con asistentes');
  assert.equal(t.historial.length, 2);
  const h = t.historial[1];
  assert.equal(h.accion, 'cambio');
  assert.equal(h.usuario_id, 9);
  assert.deepEqual(h.antes, { nombre: antes.nombre });
  assert.deepEqual(h.despues, { nombre: 'Clínica mensual con asistentes' });
  assert.deepEqual(t.etiquetas, antes.etiquetas);
});

test('cambio sin diferencias no agrega historial; id inexistente es 404; validacion es 400', () => {
  const DB = sembrada();
  const t = cambiarTactica(DB, 2, { camino: 'calidad_dato' }, 1);
  assert.equal(t.historial.length, 1);
  assert.throws(() => cambiarTactica(DB, 999, { nombre: 'Nombre válido' }, 1), status(404));
  assert.throws(() => cambiarTactica(DB, '3abc', { nombre: 'Nombre válido' }, 1), status(404));
  assert.throws(() => cambiarTactica(DB, 2, { etiquetas: { 1: { estado: 'probada' } } }, 1), status(400));
  assert.throws(() => cambiarTactica(DB, 2, { activa: false }, 1), status(400));
  assert.throws(() => cambiarTactica(DB, 2, { candado: 'pct_con_cliente' }, 1), status(400));
  assert.deepEqual(DB.pos.cinco_caminos.tacticas[1].etiquetas, {});
  assert.equal(DB.pos.cinco_caminos.tacticas[1].historial.length, 1);
});

test('el id de texto numerico funciona', () => {
  const DB = sembrada();
  assert.equal(cambiarTactica(DB, '3', { nombre: 'Nombre válido nuevo' }, 1).id, 3);
});

test('retiro: sin motivo es 400, ya retirada es 409, queda en historial con motivo', () => {
  const DB = sembrada();
  assert.throws(() => retirarTactica(DB, 1, '', 5), status(400));
  assert.throws(() => retirarTactica(DB, 1, 'ab', 5), status(400));
  assert.throws(() => retirarTactica(DB, 1, 'x'.repeat(201), 5), status(400));
  assert.throws(() => retirarTactica(DB, 1, 7, 5), status(400));
  assert.throws(() => retirarTactica(DB, 99, 'no aplica ya', 5), status(404));
  const t = retirarTactica(DB, 1, 'No aplica en la tienda', 5);
  assert.equal(t.activa, false);
  assert.equal(t.motivo_retiro, 'No aplica en la tienda');
  assert.equal(t.historial[1].accion, 'retiro');
  assert.equal(t.historial[1].usuario_id, 5);
  assert.equal(DB.pos.cinco_caminos.tacticas.length, 30);
  assert.throws(() => retirarTactica(DB, 1, 'Otra vez retirada', 5), status(409));
});

test('retirada no se edita; reactivar: 409 si esta activa, limpia el motivo y deja historial', () => {
  const DB = sembrada();
  assert.throws(() => reactivarTactica(DB, 1, 5), status(409));
  retirarTactica(DB, 1, 'No aplica en la tienda', 5);
  assert.throws(() => cambiarTactica(DB, 1, { nombre: 'Nombre válido nuevo' }, 5), status(409));
  const t = reactivarTactica(DB, 1, 6);
  assert.equal(t.activa, true);
  assert.equal(t.motivo_retiro, null);
  assert.equal(t.historial.length, 3);
  assert.equal(t.historial[2].accion, 'reactivacion');
  assert.equal(t.historial[2].usuario_id, 6);
});

test('los ids nunca se reusan despues de un retiro', () => {
  const DB = sembrada();
  const a = crearTactica(DB, BASE, 1);
  retirarTactica(DB, a.id, 'Se creó por error', 1);
  const b = crearTactica(DB, BASE, 1);
  assert.equal(a.id, 31);
  assert.equal(b.id, 32);
  assert.equal(new Set(DB.pos.cinco_caminos.tacticas.map(t => t.id)).size, 32);
});

test('fijarEtiqueta: valida estado, mes y resultado; deja historial etiqueta', () => {
  const DB = sembrada();
  assert.throws(() => fijarEtiqueta(DB, 1, 1, { estado: 'rara', mes: '2026-10', resultado: null }), status(400));
  assert.throws(() => fijarEtiqueta(DB, 1, 1, { estado: 'probada', mes: '2026-13', resultado: null }), status(400));
  assert.throws(() => fijarEtiqueta(DB, 1, 1, { estado: 'probada', mes: 'octubre', resultado: null }), status(400));
  assert.throws(() => fijarEtiqueta(DB, 1, 'x', { estado: 'probada', mes: '2026-10', resultado: null }), status(400));
  assert.throws(() => fijarEtiqueta(DB, 99, 1, { estado: 'probada', mes: '2026-10', resultado: null }), status(404));
  assert.throws(() => fijarEtiqueta(DB, 1, 1, { estado: 'probada', mes: '2026-10', resultado: 5 }), status(400));
  assert.deepEqual(DB.pos.cinco_caminos.tacticas[0].etiquetas, {});
  const t = fijarEtiqueta(DB, 1, 2, { estado: 'probada', mes: '2026-10', resultado: 'Subió 4 puntos' });
  assert.deepEqual(t.etiquetas['2'], { estado: 'probada', mes: '2026-10', resultado: 'Subió 4 puntos' });
  const h = t.historial[1];
  assert.equal(h.accion, 'etiqueta');
  assert.equal(h.usuario_id, null);
  assert.equal(h.despues.sucursal_id, 2);
});

test('vistaManual: sin ver todas solo ve su etiqueta y el conteo; con ver todas ve todas', () => {
  const DB = sembrada();
  fijarEtiqueta(DB, 1, 1, { estado: 'probada', mes: '2026-09', resultado: 'Funcionó' });
  fijarEtiqueta(DB, 1, 2, { estado: 'probada', mes: '2026-10', resultado: 'Funcionó también' });
  fijarEtiqueta(DB, 1, 3, { estado: 'no_funciono', mes: '2026-10', resultado: null });
  fijarEtiqueta(DB, 2, 3, { estado: 'sin_dato', mes: null, resultado: null });

  const propia = vistaManual(DB, { verTodas: false, sucursalId: 1 });
  assert.equal(propia.length, 30);
  assert.deepEqual(propia[0].etiqueta_tienda, { estado: 'probada', mes: '2026-09', resultado: 'Funcionó' });
  assert.equal(propia[0].probada_en, 2);
  assert.equal(propia[0].etiquetas, undefined);
  assert.equal(propia[0].historial, undefined);
  assert.equal(JSON.stringify(propia[0]).includes('Funcionó también'), false);
  assert.deepEqual(propia[1].etiqueta_tienda, { estado: 'por_probar', mes: null, resultado: null });
  assert.equal(propia[1].probada_en, 0);

  const otra = vistaManual(DB, { verTodas: false, sucursalId: 3 });
  assert.equal(otra[0].etiqueta_tienda.estado, 'no_funciono');
  assert.equal(otra[0].probada_en, 2);

  const todas = vistaManual(DB, { verTodas: true, sucursalId: 1 });
  assert.equal(Object.keys(todas[0].etiquetas).length, 3);
  assert.equal(todas[0].etiquetas['2'].resultado, 'Funcionó también');
  assert.equal(todas[0].historial, undefined);
});

test('vistaManual no deja que el llamador modifique la base, y trae las retiradas', () => {
  const DB = sembrada();
  retirarTactica(DB, 2, 'No aplica en la tienda', 1);
  const vista = vistaManual(DB, { verTodas: true, sucursalId: 1 });
  assert.equal(vista[1].activa, false);
  vista[0].quien.push('intruso');
  vista[0].nombre = 'Cambiado afuera';
  assert.notEqual(DB.pos.cinco_caminos.tacticas[0].nombre, 'Cambiado afuera');
  assert.deepEqual(DB.pos.cinco_caminos.tacticas[0].quien, ['cajera', 'vendedor']);
});

test('sembrarManual: tacticas que existe pero no es arreglo no se pisa; undefined si siembra', () => {
  const originalWarn = console.warn;
  let avisos = 0;
  console.warn = () => { avisos++; };
  try {
    for (const raro of [{}, null, 'texto', 5]) {
      const DB = prepararDB();
      DB.pos.cinco_caminos.tacticas = raro;
      assert.equal(sembrarManual(DB), 0);
      assert.equal(DB.pos.cinco_caminos.tacticas, raro);
    }
  } finally { console.warn = originalWarn; }
  assert.equal(avisos, 4);
  const DB = prepararDB();
  DB.pos.cinco_caminos.tacticas = undefined;
  assert.equal(sembrarManual(DB), 30);
});

test('crearTactica ignora elementos que no son objeto al calcular el id', () => {
  const DB = prepararDB();
  DB.pos.cinco_caminos.tacticas = [null, 'x', 7, { id: 4, activa: true, historial: [], etiquetas: {} }];
  assert.equal(crearTactica(DB, BASE, 1).id, 5);
  assert.equal(vistaManual(DB, { verTodas: true }).length, 2);
});

test('el historial no comparte referencias con la tactica', () => {
  const DB = sembrada();
  const t = cambiarTactica(DB, 5, { quien: ['encargado', 'gerente'] }, 1);
  const real = DB.pos.cinco_caminos.tacticas[4];
  assert.notEqual(real.historial[1].despues.quien, real.quien);
  assert.deepEqual(real.historial[1].despues.quien, ['encargado', 'gerente']);
  assert.equal(t.historial[1].usuario_id, 1);
});

test('las operaciones humanas exigen usuario entero positivo (500 Operacion sin usuario)', () => {
  const DB = sembrada();
  const sinUsuario = e => e.status === 500 && e.message === 'Operación sin usuario';
  for (const malo of [null, undefined, 0, -1, 1.5, '', 'abc', '1e1', true, {}]) {
    assert.throws(() => crearTactica(DB, BASE, malo), sinUsuario);
    assert.throws(() => cambiarTactica(DB, 2, { nombre: 'Nombre válido nuevo' }, malo), sinUsuario);
    assert.throws(() => retirarTactica(DB, 2, 'No aplica ya', malo), sinUsuario);
    assert.throws(() => reactivarTactica(DB, 2, malo), sinUsuario);
  }
  assert.equal(DB.pos.cinco_caminos.tacticas.length, 30);
  assert.equal(DB.pos.cinco_caminos.tacticas[1].historial.length, 1);
});

test('el id solo acepta digitos o entero positivo', () => {
  const DB = sembrada();
  for (const malo of ['1e1', '0x10', true, '', ' 3', '-3', '3.0', 0, 1.5]) {
    assert.throws(() => cambiarTactica(DB, malo, { nombre: 'Nombre válido nuevo' }, 1), status(404), String(malo));
  }
  assert.equal(cambiarTactica(DB, 3, { nombre: 'Nombre válido nuevo' }, 1).id, 3);
});

test('vistaManual: una etiqueta null no revienta el conteo probada_en', () => {
  const DB = sembrada();
  fijarEtiqueta(DB, 1, 1, { estado: 'probada', mes: '2026-09', resultado: 'Funcionó' });
  DB.pos.cinco_caminos.tacticas[0].etiquetas['2'] = null;
  const vista = vistaManual(DB, { verTodas: false, sucursalId: 1 });
  assert.equal(vista[0].probada_en, 1);
});
