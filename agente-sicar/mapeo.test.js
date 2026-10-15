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
