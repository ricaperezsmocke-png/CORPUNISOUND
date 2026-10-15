function validarSQL(sql) {
  // Las sentencias del agente no usan comillas ni comentarios (los valores van como ?): si aparecen no se intenta
  // entenderlos, se rechaza. Quitar comentarios con expresiones regulares se brinca con una comilla o con 1--1.
  if (typeof sql !== 'string' || /['"#\\]|--|\/\*/.test(sql)) throw new Error('SQL_NO_PERMITIDO');
  const cuerpo = sql.trim().replace(/;$/, '');
  const prohibido = /\b(INTO|OUTFILE|DUMPFILE|LOAD_FILE|UPDATE|LOCK|SHARE|huella|muestra|foto)\b|;|@|:=/i;
  if (!/^(SELECT|SHOW)\b/i.test(cuerpo) || prohibido.test(cuerpo)) throw new Error('SQL_NO_PERMITIDO');
  if (/\*/.test(cuerpo.replace(/COUNT\(\*\)/gi, ''))) throw new Error('SQL_NO_PERMITIDO');
  const funciones = cuerpo.matchAll(/\b([a-z_][a-z_0-9]*)\s*\(/gi);
  for (const [, nombre] of funciones) {
    if (!['COUNT', 'MAX', 'COALESCE', 'TRIM', 'DATABASE', 'CURRENT_USER', 'IN'].includes(nombre.toUpperCase())) {
      throw new Error('SQL_NO_PERMITIDO');
    }
  }
  return sql;
}

function opcionesConexion(config) {
  if (!['localhost', '127.0.0.1'].includes(config.host)) throw new Error('MYSQL_HOST_NO_LOCAL');
  return {
    host: config.host, port: config.port || 3306, user: 'consultas', password: config.password,
    database: config.database, charset: 'utf8mb4', multipleStatements: false,
    decimalNumbers: false, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true,
    connectTimeout: 10000,
  };
}

async function crearLector(conexion, { reloj = Date.now, avisar = () => {} } = {}) {
  // Estas sentencias constantes son el único canal de control de transacción.
  await conexion.query('SET SESSION TRANSACTION READ ONLY');
  await conexion.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  let lentas = 0;
  let tamano = 100;
  let ocupada = false;
  async function leer(sql, parametros = []) {
    validarSQL(sql);
    const inicio = reloj();
    const [filas] = await conexion.query({ sql, timeout: 10000 }, parametros);
    if (reloj() - inicio > 1000) {
      if (++lentas >= 2) {
        tamano = Math.max(1, Math.floor(tamano / 2));
        avisar('CONSULTAS_LENTAS_PAGINA_REDUCIDA');
        lentas = 0;
      }
    } else lentas = 0;
    return filas;
  }
  return {
    get tamano() { return tamano; },
    async pagina(fn) {
      if (ocupada) throw new Error('PAGINA_SIMULTANEA');
      ocupada = true;
      try {
        await conexion.query('START TRANSACTION READ ONLY');
        const resultado = await fn(leer);
        await conexion.query('COMMIT');
        return resultado;
      } catch (error) {
        await conexion.query('ROLLBACK');
        throw error;
      } finally { ocupada = false; }
    },
  };
}

module.exports = { validarSQL, opcionesConexion, crearLector };
