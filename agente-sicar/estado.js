const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
function inicial() {
  return { version: 1, siguiente_secuencia: '1', fase: 'clientes', cli_id: '0', ven_id: '0', his_id: '0',
    tope: null, enviadas: {}, ventana: {}, pendiente: null, detenido: null, ultimo_envio: null };
}
async function guardar(archivo, estado) {
  const temporal = `${archivo}.${randomUUID()}.tmp`;
  const h = await fs.open(temporal, 'wx', 0o600);
  try { await h.writeFile(JSON.stringify(estado), 'utf8'); await h.sync(); }
  finally { await h.close(); }
  await fs.rename(temporal, archivo);
}
async function cargar(archivo) {
  let datos;
  try { datos = await fs.readFile(archivo, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return inicial(); throw e; }
  const estado = JSON.parse(datos);
  if (estado.version !== 1 || !/^[1-9]\d*$/.test(estado.siguiente_secuencia)) throw new Error('ESTADO_INVALIDO');
  for (const campo of ['cli_id', 'ven_id', 'his_id']) {
    if (typeof estado[campo] !== 'string' || !/^\d+$/.test(estado[campo])) throw new Error('ESTADO_INVALIDO');
  }
  if (!['clientes', 'ventas', 'incremental'].includes(estado.fase)) throw new Error('ESTADO_INVALIDO');
  if (!estado.enviadas || !estado.ventana) throw new Error('ESTADO_INVALIDO');
  return estado;
}
async function bloquear(archivo) {
  let handle;
  try { handle = await fs.open(`${archivo}.lock`, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') return null; throw e; }
  await handle.writeFile(JSON.stringify({ pid: process.pid, inicio: new Date().toISOString() }));
  return async () => { await handle.close(); await fs.unlink(`${archivo}.lock`); };
}
const EVENTOS = new Set([
  'RED_NO_DISPONIBLE', 'CONSULTAS_LENTAS_PAGINA_REDUCIDA', 'ERROR_NO_CLASIFICADO', 'LOTE_CONFIRMADO',
  'HTTP_400', 'HTTP_401', 'HTTP_409', 'HTTP_413', 'HTTP_422', 'HTTP_429', 'HTTP_503', 'HTTP_INESPERADO',
  'HISTORIAL_SIN_CONFIGURAR', 'FUERA_DE_HORARIO', 'OTRA_CORRIDA_ACTIVA', 'PRIVILEGIOS_AMPLIOS',
  'ESTADO_INVALIDO', 'CONFIGURACION_INVALIDA', 'MYSQL_NO_DISPONIBLE', 'ESQUEMA_INVALIDO',
]);
function registrar(escribir = console.log) {
  return evento => escribir(evento === 'HISTORIAL_SIN_CONFIGURAR'
    ? 'cancelaciones antiguas sin vigilar: falta configurar historial'
    : EVENTOS.has(evento) ? evento : 'ERROR_NO_CLASIFICADO');
}
module.exports = { inicial, guardar, cargar, bloquear, registrar };
