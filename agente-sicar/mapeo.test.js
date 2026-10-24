const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearFuente } = require('./mapeo');
const { validarSQL } = require('./seguridad');
const columnas = {
  cliente: 'cli_id nombre telefono celular mail rfc status clave',
  venta: 'ven_id fecha status total tic_id not_id rem_id',
  ticket: 'tic_id cli_id', nota: 'not_id cli_id', remision: 'rem_id cli_id',
  detallev: 'linea_id ven_id art_id clave descripcion cantidad precioCon precioSin importeCon descTotal',
  historial: 'his_id tabla movimiento referencia_real',
};
function preparar({ falta, config = {} } = {}) {
  const consultas = [];
  const leer = async (sql, parametros) => {
    validarSQL(sql);
    consultas.push({ sql, parametros });
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      return Object.entries(columnas).flatMap(([TABLE_NAME, campos]) => campos.split(' ')
        .filter(c => `${TABLE_NAME}.${c}` !== falta).map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME })));
    }
    if (sql.startsWith('SHOW INDEX')) return [{ Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'linea_id' }];
    if (sql.includes('MAX(')) return [{ tope: '700' }];
    if (sql.includes('FROM `historial`')) return [{ his_id: '80', tabla: 'Venta', movimiento: 2, referencia: '9' }];
    if (sql.includes('FROM `venta`')) return [{ ven_id: '9', cli_id: '42', fecha: '2015-01-01 10:00:00', status: -1, total: '10' }];
    if (sql.includes('FROM `cliente`')) return [{ cli_id: '42', nombre: 'José' }];
    if (sql.includes('FROM `detallev`')) return [{ ven_id: '9', art_id: '8', descripcion: 'Primero' },
      { ven_id: '9', art_id: '8', descripcion: 'Segundo' }];
    return [];
  };
  const fuente = crearFuente({ pagina: fn => fn(leer), tamano: 100 }, config);
  return { fuente, consultas };
}
test('falta de columna para detalle detiene indicando cuál', async () => {
  await assert.rejects(preparar({ falta: 'detallev.precioSin' }).fuente.validar(), /detallev.precioSin/);
});
test('referencia de historial inexistente detiene; sin configurar historial no se consulta', async () => {
  await assert.rejects(preparar({ config: { historial: { columna_referencia: 'inventada' } } }).fuente.validar(), /historial.inventada/);
  const { fuente, consultas } = preparar();
  await fuente.validar();
  assert.deepEqual(await fuente.historial('0', 100), []);
  assert.equal(consultas.some(q => q.sql.includes('FROM `historial`')), false);
});
test('referencia configurada recupera cancelación vieja por his_id sin filtrar fecha', async () => {
  const { fuente, consultas } = preparar({ config: { historial: { columna_referencia: 'referencia_real' } } });
  await fuente.validar();
  assert.deepEqual(await fuente.historial('79', 100), [{ his_id: '80', tabla: 'Venta', movimiento: 2, referencia: '9' }]);
  const q = consultas.at(-1);
  assert.match(q.sql, /`his_id` > \?/);
  assert.deepEqual(q.parametros, ['79', 100]);
  assert.match(q.sql, /`referencia_real` AS referencia/);
});
test('lee páginas por PK, documentos por COALESCE y detalles por su PK descubierta', async () => {
  const { fuente, consultas } = preparar();
  await fuente.validar();
  assert.equal(await fuente.tope(), '700');
  await fuente.clientes('5', 100);
  const pagina = await fuente.ventas('8', '700', 100);
  assert.deepEqual(pagina.detalles.map(d => d.descripcion), ['Primero', 'Segundo']);
  assert.equal(pagina.clientes[0].cli_id, '42');
  assert.match(consultas.findLast(q => q.sql.includes('FROM `venta`')).sql, /COALESCE/);
  assert.match(consultas.findLast(q => q.sql.includes('FROM `detallev`')).sql, /ORDER BY `linea_id`/);
  await fuente.porIds(['9']);
  assert.match(consultas.findLast(q => q.sql.includes('FROM `venta`')).sql, /`ven_id` IN \(\?\)/);
  for (const q of consultas) assert.doesNotMatch(q.sql, /\b(huella|muestra|foto|OFFSET)\b|WHERE.*fecha/i);
});

const columnasArticulos = { articulo: 'art_id clave descripcion cat_id precio', categoria: 'cat_id nombre dep_id', departamento: 'dep_id nombre' };
function prepararArticulos(sinColumna) {
  const consultas = [];
  const leer = async (sql, parametros) => {
    validarSQL(sql);
    consultas.push({ sql, parametros });
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      return Object.entries({ ...columnas, ...columnasArticulos }).flatMap(([TABLE_NAME, campos]) => campos.split(' ')
        .filter(c => `${TABLE_NAME}.${c}` !== sinColumna).map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME })));
    }
    if (sql.startsWith('SHOW INDEX')) return [{ Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'linea_id' }];
    if (sql.includes('COUNT(*)')) return [{ total: '2' }];
    if (sql.includes('FROM `articulo`')) return [{ art_id: '8', clave: 'JLX', descripcion: 'Bafle', categoria: 'Bafles', departamento: 'Audio' }];
    return [];
  };
  return { fuente: crearFuente({ pagina: fn => fn(leer), tamano: 100 }, {}), consultas };
}
test('articulos: lee departamento y categoria por art_id con consulta que pasa la guardia', async () => {
  const { fuente, consultas } = prepararArticulos();
  await fuente.validar();
  assert.equal(fuente.articulosDisponibles, true);
  assert.deepEqual(await fuente.articulos('5', 100), [{ art_id: '8', clave: 'JLX', descripcion: 'Bafle', categoria: 'Bafles', departamento: 'Audio' }]);
  const q = consultas.at(-1);
  assert.match(q.sql, /LEFT JOIN `categoria`.*LEFT JOIN `departamento`/);
  assert.match(q.sql, /`art_id` > \? ORDER BY a\.`art_id` LIMIT \?/);
  assert.deepEqual(q.parametros, ['5', 100]);
  const info = await fuente.verificar();
  assert.equal(info.articulos.total, '2');
  assert.ok(info.articulos.columnas.includes('categoria.dep_id'));
});
test('articulos: columna faltante no detiene la validacion y deja los articulos apagados', async () => {
  const { fuente, consultas } = prepararArticulos('categoria.dep_id');
  await fuente.validar();
  assert.equal(fuente.articulosDisponibles, false);
  await assert.rejects(fuente.articulos('0', 100), /ARTICULOS_NO_DISPONIBLES/);
  assert.equal(consultas.some(q => q.sql.includes('FROM `articulo`')), false);
  const info = await fuente.verificar();
  assert.deepEqual(info.articulos.faltantes, ['categoria.dep_id']);
  assert.equal(info.articulos.total, null);
});
test('articulos: sin tablas de articulos tambien sigue y no los consulta', async () => {
  const { fuente } = preparar();
  await fuente.validar();
  assert.equal(fuente.articulosDisponibles, false);
});

const indicePrimario = [{ Non_unique: 0, Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'pro_id' }];
function prepararProveedores(sinColumna, indicesProveedor = indicePrimario) {
  const consultas = [];
  const leer = async (sql, parametros) => {
    validarSQL(sql);
    consultas.push({ sql, parametros });
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      return Object.entries({ ...columnas, proveedor: 'pro_id nombre status rfc' }).flatMap(([TABLE_NAME, campos]) => campos.split(' ')
        .filter(c => `${TABLE_NAME}.${c}` !== sinColumna).map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME })));
    }
    if (sql === 'SHOW INDEX FROM `proveedor`') {
      if (indicesProveedor instanceof Error) throw indicesProveedor;
      return indicesProveedor;
    }
    if (sql.startsWith('SHOW INDEX')) return [{ Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'linea_id' }];
    if (sql.includes('COUNT(*)')) return [{ total: '3' }];
    if (sql.includes('FROM `proveedor`')) return [{ prv_id: '7', nombre: 'Casa Veerkamp' }];
    return [];
  };
  return { fuente: crearFuente({ pagina: fn => fn(leer), tamano: 100 }, {}), consultas };
}
test('proveedores: lee id y nombre por pro_id, sin los borrados, con consulta que pasa la guardia', async () => {
  const { fuente, consultas } = prepararProveedores();
  await fuente.validar();
  assert.equal(fuente.proveedoresDisponibles, true);
  assert.deepEqual(await fuente.proveedores('5', 500), [{ prv_id: '7', nombre: 'Casa Veerkamp' }]);
  const q = consultas.at(-1);
  assert.match(q.sql, /FROM `proveedor`/);
  assert.match(q.sql, /^SELECT p\.`pro_id` AS prv_id, p\.`nombre` AS nombre FROM `proveedor` p /);
  // status -1 es proveedor borrado en SICAR (69 de 157 en Ocosingo): no se ofrece al vendedor.
  assert.match(q.sql, /WHERE p\.`pro_id` > \? AND p\.`status` <> -1 ORDER BY p\.`pro_id` LIMIT \?$/);
  assert.deepEqual(q.parametros, ['5', 500]);
  const info = await fuente.verificar();
  assert.equal(info.proveedores.total, '3');
  assert.deepEqual(info.proveedores.columnas, ['proveedor.pro_id', 'proveedor.nombre', 'proveedor.status', 'proveedor.rfc']);
  assert.match(consultas.find(c => c.sql.includes('COUNT(*)')).sql, /FROM `proveedor` WHERE `status` <> -1$/);
  assert.deepEqual(info.proveedores.faltantes, []);
});
test('proveedores: columna faltante no detiene la validacion y deja los proveedores apagados', async () => {
  const { fuente, consultas } = prepararProveedores('proveedor.nombre');
  await fuente.validar();
  assert.equal(fuente.proveedoresDisponibles, false);
  await assert.rejects(fuente.proveedores('0', 500), /PROVEEDORES_NO_DISPONIBLES/);
  assert.equal(consultas.some(q => q.sql.includes('FROM `proveedor`')), false);
  const info = await fuente.verificar();
  assert.deepEqual(info.proveedores.faltantes, ['proveedor.nombre']);
  assert.equal(info.proveedores.total, null);
});
test('proveedores: sin la columna status se apagan (no se podrian separar los borrados)', async () => {
  const { fuente } = prepararProveedores('proveedor.status');
  await fuente.validar();
  assert.equal(fuente.proveedoresDisponibles, false);
  assert.deepEqual((await fuente.verificar()).proveedores.faltantes, ['proveedor.status']);
});
test('proveedores: sin la tabla tambien sigue y no la consulta', async () => {
  const { fuente } = preparar();
  await fuente.validar();
  assert.equal(fuente.proveedoresDisponibles, false);
});
test('proveedores: sin la tabla no se consulta su indice', async () => {
  const { fuente, consultas } = preparar();
  await fuente.validar();
  assert.equal(consultas.some(q => q.sql.includes('`proveedor`')), false);
});
test('proveedores: pro_id con indice UNIQUE de una sola columna tambien los habilita', async () => {
  const { fuente } = prepararProveedores(undefined, [{ Non_unique: 1, Key_name: 'otro', Seq_in_index: 1, Column_name: 'nombre' },
    { Non_unique: '0', Key_name: 'prv_unico', Seq_in_index: 1, Column_name: 'pro_id' }]);
  await fuente.validar();
  assert.equal(fuente.proveedoresDisponibles, true);
});
// Si pro_id se puede repetir, el servidor rechaza el lote entero (ID_DUPLICADO, 422) y el agente se detendria con todo y
// clientes y ventas. La lista es opcional: sin unicidad garantizada se apaga, igual que cuando falta una columna.
const indicesSinUnicidad = {
  'sin indices': [],
  'indice no unico': [{ Non_unique: 1, Key_name: 'por_prv', Seq_in_index: 1, Column_name: 'pro_id' }],
  'PRIMARY compuesta': [{ Non_unique: 0, Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'pro_id' },
    { Non_unique: 0, Key_name: 'PRIMARY', Seq_in_index: 2, Column_name: 'suc_id' }],
  'UNIQUE compuesto': [{ Non_unique: 0, Key_name: 'u', Seq_in_index: 1, Column_name: 'pro_id' },
    { Non_unique: 0, Key_name: 'u', Seq_in_index: 2, Column_name: 'nombre' }],
  'UNIQUE de prefijo': [{ Non_unique: 0, Key_name: 'u', Seq_in_index: 1, Column_name: 'pro_id', Sub_part: 3 }],
  'PRIMARY en otra columna': [{ Non_unique: 0, Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'rfc' }],
  'SHOW INDEX falla': new Error('ER_TABLEACCESS_DENIED_ERROR'),
};
for (const [caso, indices] of Object.entries(indicesSinUnicidad)) {
  test(`proveedores: ${caso} no detiene la validacion y deja los proveedores apagados`, async () => {
    const { fuente, consultas } = prepararProveedores(undefined, indices);
    await fuente.validar();
    assert.equal(fuente.proveedoresDisponibles, false);
    await assert.rejects(fuente.proveedores('0', 500), /PROVEEDORES_NO_DISPONIBLES/);
    assert.equal(consultas.some(q => q.sql.includes('FROM `proveedor` p')), false);
    const info = await fuente.verificar();
    assert.equal(info.proveedores.total, null);
    assert.ok(info.proveedores.faltantes.length > 0);
  });
}

const consultaExistencias = 'SELECT a.`art_id`, a.`existencia` FROM `articulo` a WHERE a.`art_id` > ? AND a.`status` = 1 AND '
  + 'a.`servicio` = 0 ORDER BY a.`art_id` LIMIT ?';
function prepararExistencias(sinColumna, filas = [{ art_id: '8', existencia: '3.0000' }]) {
  const consultas = [];
  const leer = async (sql, parametros) => {
    validarSQL(sql);
    consultas.push({ sql, parametros });
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      return Object.entries({ ...columnas, articulo: 'art_id clave existencia status servicio' }).flatMap(([TABLE_NAME, campos]) => campos
        .split(' ').filter(c => `${TABLE_NAME}.${c}` !== sinColumna).map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME })));
    }
    if (sql.startsWith('SHOW INDEX')) return [{ Key_name: 'PRIMARY', Seq_in_index: 1, Column_name: 'linea_id' }];
    if (sql.includes('COUNT(*)') && sql.includes('`servicio`')) return [{ total: String(filas.length) }];
    if (sql.includes('COUNT(*)')) return [{ total: '0' }];
    if (sql === consultaExistencias) return filas.filter(f => BigInt(f.art_id) > BigInt(parametros[0])).slice(0, parametros[1]);
    return [];
  };
  return { fuente: crearFuente({ pagina: fn => fn(leer), tamano: 100 }, {}), consultas };
}
test('existencias: lee art_id y existencia de los vigentes que no son servicio, con consulta que pasa la guardia', async () => {
  const { fuente, consultas } = prepararExistencias();
  await fuente.validar();
  assert.equal(fuente.existenciasDisponibles, true);
  assert.deepEqual(await fuente.existencias('5', 500), [{ art_id: '8', existencia: '3.0000' }]);
  const q = consultas.at(-1);
  assert.equal(q.sql, consultaExistencias);
  assert.deepEqual(q.parametros, ['5', 500]);
  await fuente.existencias('0', 9000);
  assert.deepEqual(consultas.at(-1).parametros, ['0', 500], 'no mas de cinco paginas normales');
});
test('existencias: verificar trae columnas, total con el mismo WHERE y cuanto tarda la lectura completa', async () => {
  const filas = Array.from({ length: 1200 }, (_, i) => ({ art_id: String(i + 1), existencia: '1.0000' }));
  const { fuente, consultas } = prepararExistencias(undefined, filas);
  await fuente.validar();
  const info = await fuente.verificar();
  assert.equal(info.existencias.total, '1200');
  assert.deepEqual(info.existencias.faltantes, []);
  assert.deepEqual(info.existencias.columnas, ['articulo.art_id', 'articulo.existencia', 'articulo.status', 'articulo.servicio']);
  assert.equal(typeof info.existencias.ms, 'number');
  assert.ok(info.existencias.ms >= 0);
  const conteo = consultas.find(c => c.sql.includes('COUNT(*)') && c.sql.includes('`servicio`')).sql;
  assert.equal(conteo, 'SELECT COUNT(*) AS total FROM `articulo` a WHERE a.`status` = 1 AND a.`servicio` = 0');
  assert.equal(consultas.filter(c => c.sql === consultaExistencias).length, 4, 'lee las 1200 en paginas de 500 hasta la vacia');
});
test('existencias: sin articulo.servicio quedan apagadas, no detiene la validacion y no consulta la tabla', async () => {
  const { fuente, consultas } = prepararExistencias('articulo.servicio');
  await fuente.validar();
  assert.equal(fuente.existenciasDisponibles, false);
  await assert.rejects(fuente.existencias('0', 500), /EXISTENCIAS_NO_DISPONIBLES/);
  const info = await fuente.verificar();
  assert.deepEqual(info.existencias.faltantes, ['articulo.servicio']);
  assert.equal(info.existencias.total, null);
  assert.equal(info.existencias.ms, null);
  assert.equal(consultas.some(q => q.sql.includes('`existencia`') || q.sql.includes('`servicio`')), false);
});
test('existencias: sin la tabla articulo tambien siguen apagadas', async () => {
  const { fuente } = preparar();
  await fuente.validar();
  assert.equal(fuente.existenciasDisponibles, false);
});
