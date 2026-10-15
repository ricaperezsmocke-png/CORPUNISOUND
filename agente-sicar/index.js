const { setTimeout: pausa } = require('node:timers/promises');
const { leerConfiguracion } = require('./configuracion');
const { registrar, bloquear } = require('./estado');
const { conectar } = require('./conexion');
const { crearLector } = require('./seguridad');
const { crearFuente } = require('./mapeo');
const { ejecutar } = require('./corrida');
const { cliente } = require('./formato');
async function verificar(fuente, imprimir, esperar, log) {
  await fuente.validar();
  const info = await fuente.verificar();
  if (/\b(FILE|GRANT OPTION)\b/i.test(JSON.stringify(info.grants))) log('PRIVILEGIOS_AMPLIOS');
  imprimir('Columnas de historial (solo pantalla local): ' + JSON.stringify(info.columnas));
  imprimir('Tres cancelaciones recientes (solo pantalla local): ' + JSON.stringify(info.ventas));
  imprimir('Tres movimientos de cliente (solo pantalla local): ' + JSON.stringify(info.clientes));
  let cursor = '0', clientes = 0, ventas = 0;
  while (true) {
    const filas = await fuente.clientes(cursor, fuente.tamano);
    if (!filas.length) break;
    clientes += filas.filter(c => cliente(c)).length;
    cursor = String(filas.at(-1).cli_id);
    await esperar(1000);
  }
  cursor = '0';
  const tope = await fuente.tope();
  while (true) {
    const pagina = await fuente.ventas(cursor, tope, fuente.tamano);
    if (!pagina.filas.length) break;
    const personas = new Set(pagina.clientes.filter(c => cliente(c)).map(c => String(c.cli_id)));
    ventas += pagina.filas.filter(v => personas.has(String(v.cli_id))).length;
    cursor = String(pagina.filas.at(-1).ven_id);
    await esperar(1000);
  }
  imprimir(`Clientes con nombre: ${clientes}`);
  imprimir(`Ventas con nombre: ${ventas}`);
}
async function main(args = process.argv.slice(2), deps = {}) {
  const log = deps.log || registrar();
  const imprimir = deps.imprimir || console.log;
  const esperar = deps.esperar || pausa;
  if (args.some(a => a !== '--verificar')) throw new Error('CONFIGURACION_INVALIDA');
  const config = await leerConfiguracion(deps.configPath || process.env.SICAR_CONFIG);
  const liberar = await bloquear(config.estado);
  if (!liberar) { log('OTRA_CORRIDA_ACTIVA'); return; }
  let conexion;
  try {
    conexion = await (deps.conectar || conectar)(config.mysql);
    const fuente = deps.crearFuente ? await deps.crearFuente(conexion, config)
      : crearFuente(await crearLector(conexion, { avisar: log }), config);
    if (args.includes('--verificar')) {
      if (!config.historial?.columna_referencia) log('HISTORIAL_SIN_CONFIGURAR');
      await verificar(fuente, imprimir, esperar, log);
    } else await ejecutar(config.estado, config, { ...deps, fuente, esperar, log, bloqueado: true });
  } catch (e) {
    // Solo se muestra la columna, nunca el error MySQL (puede incluir credenciales o datos).
    if (e.columna) imprimir('Falta columna: ' + e.columna);
    throw e;
  } finally {
    try { if (conexion) await conexion.end(); }
    finally { await liberar(); }
  }
}
if (require.main === module) {
  main().catch(() => { registrar()('ERROR_NO_CLASIFICADO'); process.exitCode = 1; });
}
module.exports = { main };
