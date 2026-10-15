const { setTimeout: pausa } = require('node:timers/promises');
const { leerConfiguracion } = require('./configuracion');
const path = require('node:path');
const { registrar, bloquear, describirFallo, crearEscritor } = require('./estado');
const { conectar } = require('./conexion');
const { crearLector } = require('./seguridad');
const { crearFuente } = require('./mapeo');
const { ejecutar } = require('./corrida');
const { clienteSeguro, ventaSegura } = require('./formato');
async function verificar(fuente, imprimir, esperar, log) {
  await fuente.validar();
  const info = await fuente.verificar();
  if (/\b(FILE|GRANT OPTION)\b/i.test(JSON.stringify(info.grants))) log('PRIVILEGIOS_AMPLIOS');
  imprimir('Columnas de historial (solo pantalla local): ' + JSON.stringify(info.columnas));
  imprimir('Tres cancelaciones recientes (solo pantalla local): ' + JSON.stringify(info.ventas));
  imprimir('Tres movimientos de cliente (solo pantalla local): ' + JSON.stringify(info.clientes));
  let cursor = '0', clientes = 0, ventas = 0;
  const clientesRaros = [];
  while (true) {
    const filas = await fuente.clientes(cursor, fuente.tamano);
    if (!filas.length) break;
    for (const c of filas) {
      const { cliente, omitido } = clienteSeguro(c);
      if (cliente) clientes++;
      if (omitido) clientesRaros.push(omitido);
    }
    cursor = String(filas.at(-1).cli_id);
    await esperar(1000);
  }
  cursor = '0';
  const tope = await fuente.tope();
  const raras = [];
  while (true) {
    const pagina = await fuente.ventas(cursor, tope, fuente.tamano);
    if (!pagina.filas.length) break;
    const personas = new Set(pagina.clientes.filter(c => clienteSeguro(c).cliente).map(c => String(c.cli_id)));
    const conNombre = pagina.filas.filter(v => personas.has(String(v.cli_id)));
    ventas += conNombre.length;
    const clientes = new Map(pagina.clientes.map(c => [String(c.cli_id), c]));
    for (const v of conNombre) {
      const detalles = pagina.detalles.filter(d => String(d.ven_id) === String(v.ven_id));
      const { omitida } = ventaSegura(v, clientes.get(String(v.cli_id)), detalles, false);
      if (omitida) raras.push(omitida);
    }
    cursor = String(pagina.filas.at(-1).ven_id);
    await esperar(1000);
  }
  imprimir(`Clientes con nombre: ${clientes}`);
  imprimir(`Clientes que se saltarían por datos raros: ${clientesRaros.length}`);
  for (const r of clientesRaros.slice(0, 20)) imprimir(`  cli_id=${r.cli_id} codigo=${r.codigo}`);
  imprimir(`Ventas con nombre: ${ventas}`);
  imprimir(`Ventas que se saltarían por datos raros: ${raras.length}`);
  for (const r of raras.slice(0, 20)) imprimir(`  ven_id=${r.ven_id} codigo=${r.codigo}`);
}
function rutaRegistro(configPath) {
  return typeof configPath === 'string' && path.isAbsolute(configPath) ? path.join(path.dirname(configPath), 'agente-sicar.log') : null;
}
async function main(args = process.argv.slice(2), deps = {}) {
  const configPath = deps.configPath || process.env.SICAR_CONFIG;
  const ruta = rutaRegistro(configPath);
  const escribir = ruta ? crearEscritor(ruta, Date.now, deps.eco || console.log) : (deps.eco || console.log);
  const log = deps.log || registrar(escribir);
  const imprimir = deps.imprimir || console.log;
  const esperar = deps.esperar || pausa;
  let liberar = null, conexion;
  try {
    const conocidos = ['--verificar', '--historico-ahora'];
    if (args.some(a => !conocidos.includes(a)) || args.length > 1) throw new Error('CONFIGURACION_INVALIDA');
    // Carga histórica fuera de 20:00-07:00: solo a mano y solo esta corrida (Victor, 2026-10-15). La tarea programada no la usa.
    const historicoAhora = args.includes('--historico-ahora');
    if (historicoAhora) log('HISTORICO_AUTORIZADO_DE_DIA');
    const config = await leerConfiguracion(configPath);
    liberar = await bloquear(config.estado);
    if (!liberar) { log('OTRA_CORRIDA_ACTIVA'); return; }
    conexion = await (deps.conectar || conectar)(config.mysql);
    const fuente = deps.crearFuente ? await deps.crearFuente(conexion, config)
      : crearFuente(await crearLector(conexion, { avisar: log }), config);
    if (args.includes('--verificar')) {
      if (!config.historial?.columna_referencia) log('HISTORIAL_SIN_CONFIGURAR');
      await verificar(fuente, imprimir, esperar, log);
    } else await ejecutar(config.estado, config, { ...deps, fuente, esperar, log, bloqueado: true, historicoAhora });
  } catch (e) {
    // Solo códigos conocidos, ids y nombres de columna: nunca el mensaje de MySQL (puede traer usuario o datos).
    escribir(describirFallo(e));
    throw e;
  } finally {
    try { if (conexion) await conexion.end(); }
    finally {
      if (liberar) await liberar();
      if (escribir.terminar) await escribir.terminar();
    }
  }
}
if (require.main === module) {
  main().catch(() => { process.exitCode = 1; });
}
module.exports = { main };
