// Flujo de punta a punta: los datos entran por aplicarLote (la misma puerta del agente SICAR), no a mano.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const respaldo = require('../sicarRespaldo');
const { fechaLocal } = require('../fechas');
const { incorporar } = require('./incorporar');
const servicio = require('./servicio');

const DIA = 86400000;
const LLAVE = Buffer.alloc(32, 9);
const TABLAS = ['seguimiento_tiendas', 'seguimiento_foto', 'seguimiento_foto_problemas', 'seguimiento_pendientes',
  'seguimiento_resultado', 'seguimiento_avisos', 'seguimiento_avisos_historial', 'seguimiento_config'];

function prepararDB(t) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'seguimiento-integra-'));
  const sqlite = new Database(path.join(carpeta, 'prueba.sqlite'));
  sqlite.pragma('journal_mode = WAL');
  const repo = crearRepositorioSicar(sqlite);
  respaldo.configurarContexto(repo, { DB: {}, llave: LLAVE });
  t.after(() => {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  for (const suc of [1, 6]) sqlite.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(String(suc), suc);
  return { sqlite, repo };
}

function driveEnMemoria() {
  const archivos = new Map();
  return {
    asegurarCarpetaRespaldos: async () => 'carpeta',
    async subirArchivoADrive(_DB, { contenidoBuffer }) { const id = String(archivos.size + 1); archivos.set(id, contenidoBuffer); return { id }; },
    async descargarArchivoDeDriveLimitado(_DB, id) { return archivos.get(id); },
    async eliminarArchivoDeDrive(_DB, id) { archivos.delete(id); },
  };
}

const secuencias = {};
function lote(repo, sucursalId, datos) {
  secuencias[sucursalId] = (secuencias[sucursalId] ?? 0) + 1;
  const sequence = String(secuencias[sucursalId]);
  return repo.aplicarLote({ sucursalId, hash: `h-${sucursalId}-${sequence}`,
    lote: { schema_version: 1, mapping_version: 'prueba', batch_id: `b-${sucursalId}-${sequence}`, sequence, clientes: [], ventas: [], ...datos } });
}

const AHORA = Date.now();
const dia = n => fechaLocal(AHORA + n * DIA);

function traspaso(tra_id, estado, cantidad, aplicado) {
  return { tra_id, folio: 'T-1', suc_origen: '6', suc_destino: '1', fecha: dia(2), estado, fecha_aplicado: aplicado,
    fecha_cancelado: null, total: '0.00', detalle: [{ art_id: estado === 'enviado' ? '101' : '201', cantidad, precio_sin: '0.00', precio_con: '0.00' }] };
}
const venta = (ven_id, cantidad) => ({ ven_id, fecha_local: `${dia(4)}T12:00:00`, estado: 'vigente', total: '10.00',
  detalle: [{ art_id: '201', cantidad, importe_con: '10.00', descuento_total: '0.00' }] });

function escenario(t) {
  for (const k of Object.keys(secuencias)) delete secuencias[k];
  const f = prepararDB(t);
  // Catálogo y existencias en cero (art_id distinto en cada tienda, misma clave).
  for (const [suc, art] of [[6, '101'], [1, '201']]) {
    lote(f.repo, suc, { articulos: [{ art_id: art, clave: 'PUA36', descripcion: 'Púas bolsa' }], existencias: [{ art_id: art, existencia: '0.0000' }] });
  }
  for (const suc of [6, 1]) incorporar(f.sqlite, { sucursal_id: suc, actor: '1', ahora: new Date(AHORA).toISOString() });
  // Compra con empaque: 1 bolsa de 36 púas a $100.00 sin IVA.
  lote(f.repo, 6, { compras: [{ com_id: '5001', fecha: `${dia(1)}T10:00:00`, pro_id: '10', folio: 'A-1', comentario: 'COMPRA OCOSINGO',
    estado: 'vigente', cancelada_en: null, total_con: '116.00',
    detalle: [{ art_id: '101', cantidad: '1.0000', factor: '36', precio_sin: '100.00', precio_con: '116.00', importe_con: '116.00' }] }] });
  assert.deepEqual(f.sqlite.prepare('SELECT clave FROM seguimiento_pendientes').all().map(r => r.clave), ['PUA36']);
  // Traspaso: CEDIS manda 20, Ocosingo recibe 18 (cada SICAR manda su punta).
  lote(f.repo, 6, { traspasos: [traspaso('7001', 'enviado', '20.0000', null)] });
  lote(f.repo, 1, { traspasos: [traspaso('8001', 'recibido', '18.0000', `${dia(3)}T12:00:00`)] });
  // Ventas en Ocosingo: 4 y 3 piezas; la de 3 se cancela después.
  lote(f.repo, 1, { mostrador: [venta('9001', '4.0000'), venta('9002', '3.0000')] });
  lote(f.repo, 1, { mostrador: [{ ven_id: '9002', estado: 'cancelada' }] });
  return f;
}

const resultado = sqlite => sqlite.prepare('SELECT com_id, renglon, clave, datos_json FROM seguimiento_resultado ORDER BY com_id, renglon').all();
const contenido = (sqlite, tabla) => sqlite.prepare(`SELECT * FROM ${tabla} ORDER BY rowid`).all();

test('flujo completo: empaque, recepción parcial, venta cancelada, recálculo, respaldo y restauración', async t => {
  const f = escenario(t);
  const ahora = new Date(AHORA + 50 * DIA).toISOString(); // 49 días después de la compra: etapa traslado
  assert.deepEqual(servicio.procesarPendientes(f.sqlite, { limite: 50, ahora }), { procesadas: 1, errores: [] });
  const [fila] = resultado(f.sqlite);
  const d = JSON.parse(fila.datos_json);
  assert.equal(fila.com_id, '5001');
  // Piezas (en diezmilésimas): 36 = 4 vendidas + 16 en CEDIS + 14 en Ocosingo + 2 por aclarar.
  assert.equal(d.comprado, '360000');
  assert.equal(d.vendido, '40000', 'la venta cancelada no cuenta');
  assert.deepEqual(d.por_sucursal, { 1: { queda: '140000', vendido: '40000' }, 6: { queda: '160000', vendido: '0' } });
  assert.equal(d.transito, '0');
  assert.equal(d.por_aclarar, '20000', 'las 2 que no llegaron quedan por aclarar, no como faltante de Ocosingo');
  assert.ok(d.motivos.includes('recepcion_menor'));
  // Dinero al centavo: $100.00 = 11.12 + 83.33 + 5.55.
  assert.deepEqual(d.dinero, { vendido: '1112', queda: '8333', transito: '0', gris: '0', por_aclarar: '555' });
  assert.equal(Object.values(d.dinero).reduce((a, v) => a + Number(v), 0), 10000);
  assert.deepEqual(d.incierto, ['recepcion_menor']);
  assert.deepEqual({ ...f.sqlite.prepare('SELECT com_id, etapa, estado FROM seguimiento_avisos').get() },
    { com_id: '5001', etapa: 'traslado', estado: 'nuevo' });

  // Respaldo y restauración en otra base: las tablas del seguimiento llegan idénticas y el recálculo da lo mismo.
  const drive = driveEnMemoria();
  const manifiesto = await respaldo.crearSnapshotSicar(f.repo, drive, { DB: {}, llave: LLAVE });
  const g = prepararDB(t);
  const p = await respaldo.prepararRestauracionSicar(g.repo, drive, manifiesto);
  p.aplicar();
  p.liberar();
  for (const tabla of TABLAS) assert.deepEqual(contenido(g.sqlite, tabla), contenido(f.sqlite, tabla), tabla);
  servicio.vueltaCompleta(g.sqlite, ahora);
  assert.deepEqual(servicio.procesarPendientes(g.sqlite, { limite: 50, ahora }), { procesadas: 1, errores: [] });
  assert.deepEqual(resultado(g.sqlite), resultado(f.sqlite));
  assert.equal(g.sqlite.prepare('SELECT count(*) n FROM seguimiento_avisos').get().n, 1, 'recalcular no duplica avisos');
});

test('rendimiento: 30,000 ventas de una tienda se procesan en menos de 1 s por bloque', t => {
  const f = escenario(t);
  const insertarV = f.sqlite.prepare('INSERT INTO sicar_ventas_mostrador VALUES (1, ?, ?, ?, 100, ?)');
  const insertarD = f.sqlite.prepare('INSERT INTO sicar_detalles_mostrador VALUES (1, ?, 0, ?, ?, 100, 0)');
  const al = new Date().toISOString();
  f.sqlite.transaction(() => {
    for (let i = 0; i < 30000; i++) {
      const id = String(100000 + i);
      insertarV.run(id, `${dia(5 + (i % 40))}T${String(8 + (i % 12)).padStart(2, '0')}:00:00`, 'vigente', al);
      insertarD.run(id, '201', '1.0000');
    }
  })();
  const ahora = new Date(AHORA + 50 * DIA).toISOString();
  const inicio = process.hrtime.bigint();
  const r = servicio.procesarPendientes(f.sqlite, { limite: 50, ahora });
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  t.diagnostic(`procesarPendientes con 30,000 ventas: ${ms.toFixed(0)} ms`);
  assert.deepEqual(r, { procesadas: 1, errores: [] });
  const d = JSON.parse(resultado(f.sqlite)[0].datos_json);
  // Ocosingo recibió 18: 4 de la venta original + las 14 que quedaban. Lo demás no tiene factura que lo respalde.
  assert.equal(d.vendido, '180000');
  assert.deepEqual(d.por_sucursal[1], { queda: '0', vendido: '180000' });
  assert.deepEqual(d.por_sucursal[6], { queda: '160000', vendido: '0' }, 'lo de CEDIS no se toca por ventas de Ocosingo');
  assert.ok(d.incierto.includes('venta_sin_existencia'));
  assert.ok(ms < 1000, `tardó ${ms.toFixed(0)} ms`);
});
