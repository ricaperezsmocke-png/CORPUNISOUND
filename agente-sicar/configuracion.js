const fs = require('node:fs/promises');
const path = require('node:path');
const { opcionesConexion } = require('./seguridad');
async function fueraDelRepo(archivo, existe) {
  if (typeof archivo !== 'string' || !path.isAbsolute(archivo)) throw new Error('CONFIGURACION_INVALIDA');
  const real = existe ? await fs.realpath(archivo) : path.join(await fs.realpath(path.dirname(archivo)), path.basename(archivo));
  for (let dir = path.resolve(__dirname);;) {
    let repo = false;
    try { await fs.stat(path.join(dir, '.git')); repo = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (repo) {
      const relativo = path.relative(await fs.realpath(dir), real);
      if (!relativo || (!relativo.startsWith('..' + path.sep) && relativo !== '..' && !path.isAbsolute(relativo))) {
        throw new Error('CONFIGURACION_DENTRO_DEL_REPO');
      }
    }
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return real;
}
async function leerConfiguracion(archivo) {
  const ruta = await fueraDelRepo(archivo, true);
  let config;
  try { config = JSON.parse(await fs.readFile(ruta, 'utf8')); } catch { throw new Error('CONFIGURACION_INVALIDA'); }
  if (!config.mysql || typeof config.mysql.password !== 'string' || !config.mysql.password
    || typeof config.mysql.database !== 'string' || !config.mysql.database
    || typeof config.llave !== 'string' || !config.llave.trim()) throw new Error('CONFIGURACION_INVALIDA');
  opcionesConexion(config.mysql);
  let existe = true;
  try { await fs.lstat(config.estado); } catch (e) { if (e.code === 'ENOENT') existe = false; else throw e; }
  config.estado = await fueraDelRepo(config.estado, existe);
  if (config.estado === ruta) throw new Error('CONFIGURACION_INVALIDA');
  const referencia = config.historial?.columna_referencia;
  if (referencia !== undefined && (typeof referencia !== 'string' || !/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(referencia))) {
    throw new Error('CONFIGURACION_INVALIDA');
  }
  // Interruptor de la lista de artículos: solo true la prende, y se prende después de --verificar (spec 2026-10-18).
  if (config.articulos !== undefined && typeof config.articulos !== 'boolean') throw new Error('CONFIGURACION_INVALIDA');
  // Igual la de proveedores (Radar de Demanda): apagada hasta que el servidor nuevo esté en producción.
  if (config.proveedores !== undefined && typeof config.proveedores !== 'boolean') throw new Error('CONFIGURACION_INVALIDA');
  // Y la de existencias (spec 2026-10-23): solo true la prende; un servidor viejo rechazaría la colección.
  if (config.existencias !== undefined && typeof config.existencias !== 'boolean') throw new Error('CONFIGURACION_INVALIDA');
  // Y la de cortes de caja (plan E2): igual, solo true la prende.
  if (config.cortes !== undefined && typeof config.cortes !== 'boolean') throw new Error('CONFIGURACION_INVALIDA');
  return config;
}
module.exports = { leerConfiguracion };
