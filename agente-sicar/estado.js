const fs = require('node:fs/promises');
const { DATOS_RAROS } = require('./formato');
const { randomUUID } = require('node:crypto');
function inicial() {
  return { version: 1, siguiente_secuencia: '1', fase: 'clientes', cli_id: '0', ven_id: '0', his_id: '0',
    tope: null, enviadas: {}, ventana: {}, pendiente: null, detenido: null, ultimo_envio: null,
    articulos_cursor: '0', articulos_dia: null, proveedores_cursor: '0', proveedores_dia: null,
    existencias: {}, existencias_dia: null };
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
  // Un estado.json de antes de los artículos arranca su lista desde cero.
  // Igual la de proveedores.
  for (const lista of ['articulos', 'proveedores']) {
    estado[`${lista}_cursor`] ??= '0';
    estado[`${lista}_dia`] ??= null;
    if (typeof estado[`${lista}_cursor`] !== 'string' || !/^\d+$/.test(estado[`${lista}_cursor`])) throw new Error('ESTADO_INVALIDO');
    const dia = estado[`${lista}_dia`];
    if (dia !== null && (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia))) throw new Error('ESTADO_INVALIDO');
  }
  // Existencias: lo último que el servidor CONFIRMÓ por artículo. Un estado.json de antes arranca con el mapa vacío (la
  // primera corrida manda todas). Un mapa raro detiene: compararía contra basura y dejaría de mandar cambios.
  estado.existencias ??= {};
  estado.existencias_dia ??= null;
  const mapa = estado.existencias;
  if (typeof mapa !== 'object' || Array.isArray(mapa)
    || Object.entries(mapa).some(([k, x]) => !/^[1-9]\d*$/.test(k) || typeof x !== 'string' || !/^-?\d{1,16}\.\d{4}$/.test(x))) {
    throw new Error('ESTADO_INVALIDO');
  }
  const diaExistencias = estado.existencias_dia;
  if (diaExistencias !== null && (typeof diaExistencias !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(diaExistencias))) {
    throw new Error('ESTADO_INVALIDO');
  }
  return estado;
}
const CANDADO_ABANDONADO_MS = 6 * 3600000;
function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// Un apagón o un reinicio deja el candado puesto: si su proceso ya no existe o lleva más de 6 horas, se recupera.
async function abandonado(candado) {
  let datos;
  try { datos = JSON.parse(await fs.readFile(candado, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return false;
    // Vacío o a medias puede ser otra corrida que lo acaba de crear: solo es basura si ya tiene minutos.
    try { return Date.now() - (await fs.stat(candado)).mtimeMs > 5 * 60000; } catch { return false; }
  }
  const inicio = Date.parse(datos?.inicio);
  if (!Number.isSafeInteger(datos?.pid) || !Number.isFinite(inicio)) return true;
  return !vivo(datos.pid) || Date.now() - inicio > CANDADO_ABANDONADO_MS;
}
async function bloquear(archivo) {
  const candado = `${archivo}.lock`;
  let handle;
  for (let intento = 0; !handle; intento++) {
    try { handle = await fs.open(candado, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST' || intento > 0 || !await abandonado(candado)) { if (e.code === 'EEXIST') return null; throw e; }
      await fs.rm(candado, { force: true });
    }
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, inicio: new Date().toISOString() }));
  return async () => { await handle.close(); await fs.unlink(`${archivo}.lock`); };
}
const EVENTOS = new Set([
  'RED_NO_DISPONIBLE', 'CONSULTAS_LENTAS_PAGINA_REDUCIDA', 'ERROR_NO_CLASIFICADO', 'LOTE_CONFIRMADO',
  'HTTP_400', 'HTTP_401', 'HTTP_409', 'HTTP_413', 'HTTP_422', 'HTTP_429', 'HTTP_503', 'HTTP_INESPERADO',
  'HISTORIAL_SIN_CONFIGURAR', 'FUERA_DE_HORARIO', 'OTRA_CORRIDA_ACTIVA', 'PRIVILEGIOS_AMPLIOS',
  'ESTADO_INVALIDO', 'CONFIGURACION_INVALIDA', 'MYSQL_NO_DISPONIBLE', 'ESQUEMA_INVALIDO', 'CAMPO_OMITIDO', 'TOPE_DE_CORRIDA',
  'SECUENCIA_RETROCEDIO', 'HTTP_5XX', 'VENTA_OMITIDA', 'CLIENTE_OMITIDO', 'HISTORICO_AUTORIZADO_DE_DIA',
  'ARTICULO_OMITIDO', 'ARTICULOS_NO_DISPONIBLES', 'ARTICULOS_AUTORIZADOS_DE_DIA',
  'PROVEEDOR_OMITIDO', 'PROVEEDORES_NO_DISPONIBLES', 'PROVEEDORES_AUTORIZADOS_DE_DIA',
  'EXISTENCIA_OMITIDA', 'EXISTENCIAS_NO_DISPONIBLES', 'EXISTENCIAS_AUTORIZADAS_DE_DIA', 'EXISTENCIAS_DESCARTADAS',
]);
// Solo ids numéricos, nombres de campo y columnas: nunca valores capturados ni mensajes crudos.
const DETALLES = { cli_id: /^\d{1,20}$/, ven_id: /^\d{1,20}$/, his_id: /^\d{1,20}$/, art_id: /^\d{1,20}$/,
  prv_id: /^\d{1,20}$/,
  campo: /^(telefono|celular|email|rfc)$/, codigo: { test: x => DATOS_RAROS.has(x) }, columna: /^[a-zA-Z_][a-zA-Z_0-9]*\.[a-zA-Z_][a-zA-Z_0-9]*$/ };
function detalle(datos) {
  if (!datos || typeof datos !== 'object' || datos instanceof Error) return '';
  return Object.entries(DETALLES).filter(([k, patron]) => typeof datos[k] === 'string' && patron.test(datos[k]))
    .map(([k]) => ` ${k}=${datos[k]}`).join('');
}
function registrar(escribir = console.log) {
  return (evento, datos) => escribir(evento === 'HISTORIAL_SIN_CONFIGURAR'
    ? 'cancelaciones antiguas sin vigilar: falta configurar historial'
    : EVENTOS.has(evento) ? evento + detalle(datos) : 'ERROR_NO_CLASIFICADO');
}
const FALLOS = new Set([...EVENTOS, 'ID_INVALIDO', 'DECIMAL_INVALIDO', 'PRECISION_NO_PACTADA', 'IMPORTE_EXCESIVO',
  'TEXTO_INVALIDO', 'TEXTO_VACIO', 'ESTADO_VENTA_DESCONOCIDO', 'FECHA_INVALIDA', 'DETALLE_FUERA_DE_LIMITE',
  'ENTIDAD_EXCEDE_LOTE', 'COLUMNA_NO_PERMITIDA', 'ESQUEMA_NO_VALIDADO', 'DETALLE_SIN_PK', 'PK_DETALLE_INVALIDA',
  'PAGINA_EXCESIVA', 'SQL_NO_PERMITIDO', 'ARTICULOS_NO_DISPONIBLES', 'PROVEEDORES_NO_DISPONIBLES',
  'EXISTENCIAS_NO_DISPONIBLES', 'MYSQL_HOST_NO_LOCAL', 'PAGINA_SIMULTANEA', 'CONFIGURACION_DENTRO_DEL_REPO']);
const MYSQL = { ER_ACCESS_DENIED_ERROR: 'MYSQL_ACCESO_DENEGADO', ER_DBACCESS_DENIED_ERROR: 'MYSQL_ACCESO_DENEGADO',
  ER_BAD_DB_ERROR: 'MYSQL_BASE_INEXISTENTE', ECONNREFUSED: 'MYSQL_NO_DISPONIBLE', ETIMEDOUT: 'MYSQL_NO_DISPONIBLE',
  PROTOCOL_CONNECTION_LOST: 'MYSQL_NO_DISPONIBLE', ER_TABLEACCESS_DENIED_ERROR: 'MYSQL_ACCESO_DENEGADO' };
function describirFallo(error) {
  if (error?.columna) return 'FALLO ESQUEMA_INVALIDO' + detalle({ columna: error.columna });
  if (MYSQL[error?.code]) return 'FALLO ' + MYSQL[error.code];
  if (!FALLOS.has(error?.message)) return 'FALLO ERROR_NO_CLASIFICADO';
  return `FALLO ${error.message}${detalle({ ven_id: error.ven_id, cli_id: error.cli_id })}`;
}
const LIMITE_REGISTRO = 5 * 1024 * 1024;
// En serie y sin rechazar nunca: un disco lleno no debe tumbar la corrida por culpa del registro.
function crearEscritor(ruta, reloj = Date.now, eco = console.log) {
  let cola = Promise.resolve();
  const escribir = linea => {
    eco(linea);
    const marca = new Date(reloj()).toISOString();
    cola = cola.then(async () => {
      try { if ((await fs.stat(ruta)).size > LIMITE_REGISTRO) await fs.rename(ruta, `${ruta}.1`); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      await fs.appendFile(ruta, `${marca} ${linea}
`, { encoding: 'utf8', mode: 0o600 });
    }).catch(() => eco('REGISTRO_NO_DISPONIBLE'));
    return cola;
  };
  escribir.terminar = () => cola;
  return escribir;
}
module.exports = { inicial, guardar, cargar, bloquear, registrar, describirFallo, crearEscritor };
