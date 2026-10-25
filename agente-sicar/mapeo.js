const { PUBLICOS } = require('./formato');
// Único diccionario del esquema SICAR. Los nombres no confirmados se verifican al arrancar.
const COLUMNAS = {
  cliente: ['cli_id', 'nombre', 'telefono', 'celular', 'mail', 'rfc', 'status', 'clave'],
  venta: ['ven_id', 'fecha', 'status', 'total', 'tic_id', 'not_id', 'rem_id'],
  ticket: ['tic_id', 'cli_id'], nota: ['not_id', 'cli_id'], remision: ['rem_id', 'cli_id'],
  detallev: ['ven_id', 'art_id', 'clave', 'descripcion', 'cantidad', 'precioCon', 'precioSin', 'importeCon', 'descTotal'],
  historial: ['his_id', 'tabla', 'movimiento'],
};
// Departamento y categoría de cada artículo. Esquema supuesto (spec 2026-10-18): se confirma con --verificar.
// Son opcionales: si falta alguna columna, el agente sigue con clientes y ventas y no manda artículos.
const COLUMNAS_ARTICULOS = {
  articulo: ['art_id', 'clave', 'descripcion', 'cat_id'], categoria: ['cat_id', 'nombre', 'dep_id'], departamento: ['dep_id', 'nombre'],
};
// Proveedores con los que la tienda consigue la mercancía (Radar de Demanda, 2026-10-23). Esquema confirmado con
// --verificar en Ocosingo el 2026-10-23: el id es pro_id (PRIMARY) y status -1 es proveedor borrado. Opcionales igual
// que los artículos: si falta una columna, se sigue con todo lo demás y no se mandan. Orden: [id, nombre, status].
const COLUMNAS_PROVEEDORES = { proveedor: ['pro_id', 'nombre', 'status'] };
// Existencias de los artículos vigentes (spec 2026-10-23). Confirmado en Ocosingo: status 1 vigente / -1 borrado,
// servicio 1 = servicio (no lleva existencia). Opcionales: si falta una columna, se sigue con todo lo demás.
const COLUMNAS_EXISTENCIAS = { articulo: ['art_id', 'existencia', 'status', 'servicio'] };
const DESDE_EXISTENCIAS = 'FROM `articulo` a WHERE a.`status` = 1 AND a.`servicio` = 0';
const LEER_EXISTENCIAS = 'SELECT a.`art_id`, a.`existencia` FROM `articulo` a WHERE a.`art_id` > ? AND a.`status` = 1 AND '
  + 'a.`servicio` = 0 ORDER BY a.`art_id` LIMIT ?';
// Cortes de caja (plan E2, 2026-10-23). Confirmado en Ocosingo: un solo renglón de historial (tabla CorteCaja,
// movimiento 0, id = cor_id) por corte, con el usu_id de quien lo cerró; venta.rcc_id → resumencortecaja.cor_id. Nunca se
// lee la tabla usuario: solo usu_id. Opcionales: si falta una columna, se sigue con todo lo demás y no se mandan.
const COLUMNAS_CORTES = { cortecaja: ['cor_id', 'fecha', 'contado', 'calculado', 'diferencia', 'retiro', 'caj_id'],
  cortetipopago: ['cor_id', 'tpa_id', 'contado', 'calculado', 'diferencia', 'retiro'], resumencortecaja: ['rcc_id', 'cor_id'],
  historial: ['tabla', 'movimiento', 'id', 'usu_id'], venta: ['ven_id', 'rcc_id', 'total', 'status'] };
const LEER_CORTES = 'SELECT c.`cor_id`, c.`fecha`, c.`contado`, c.`calculado`, c.`diferencia`, c.`retiro`, c.`caj_id` FROM `cortecaja` c '
  + 'WHERE c.`cor_id` > ? ORDER BY c.`cor_id` LIMIT ?';
const MAXIMO_CORTES = 100;
// Ventas de un grupo de cortes con quién dio de alta cada una. La usan la corrida y la medición de --verificar.
const ventasDeCortes = (leer, ids) => leer('SELECT r.`cor_id`, v.`ven_id`, v.`total`, v.`status`, h.`usu_id` FROM `resumencortecaja` r '
  + 'JOIN `venta` v ON v.`rcc_id` = r.`rcc_id` LEFT JOIN `historial` h ON h.`id` = v.`ven_id` AND h.`tabla` = ? '
  + `AND h.\`movimiento\` = 0 WHERE r.\`cor_id\` IN (${ids.map(() => '?').join(', ')})`, ['Venta', ...ids]);
// Ventas de mostrador (público en general) desde 2025 (Cinco Caminos P1). La guardia no admite MIN(): la primera venta
// de 2025 se toma por ven_id con ORDER BY ... LIMIT 1, que da lo mismo.
const INICIO_MOSTRADOR = '2025-01-01 00:00:00';
const PRIMERA_VENTA_DESDE = 'SELECT v.`ven_id` AS desde FROM `venta` v WHERE v.`fecha` >= ? ORDER BY v.`ven_id` LIMIT 1';
function identificador(nombre) {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(nombre) || /^(huella|muestra|foto)$/i.test(nombre)) throw new Error('COLUMNA_NO_PERMITIDA');
  return '`' + nombre + '`';
}
const lista = campos => campos.map(identificador).join(', ');
const huecos = ids => ids.map(() => '?').join(', ');
function crearFuente(lector, config = {}) {
  const referencia = config.historial?.columna_referencia;
  if (referencia) identificador(referencia);
  let pkDetalle = [];
  let columnasHistorial = [];
  let validado = false;
  let articulosFaltantes = null;
  let columnasArticulos = [];
  let proveedoresFaltantes = null;
  let columnasProveedores = [];
  let existenciasFaltantes = null;
  let columnasExistencias = [];
  let cortesFaltantes = null;
  let columnasCortes = [];
  // Filas chicas: cinco veces la página normal (100 → 500, lo que cabe en un lote); baja si SICAR se pone lento.
  const paginaExistencias = limite => Math.min(limite, lector.tamano * 5);
  const [tablaProveedor] = Object.keys(COLUMNAS_PROVEEDORES);
  const [idProveedor, nombreProveedor, estadoProveedor] = COLUMNAS_PROVEEDORES[tablaProveedor].map(identificador);
  // Los borrados en SICAR (status -1) no se ofrecen al vendedor.
  const proveedorVigente = `${estadoProveedor} <> -1`;
  const desdeVenta = 'FROM `venta` v LEFT JOIN `ticket` t ON t.`tic_id` = v.`tic_id` '
    + 'LEFT JOIN `nota` n ON n.`not_id` = v.`not_id` LEFT JOIN `remision` r ON r.`rem_id` = v.`rem_id`';
  const seleccionarVenta = 'SELECT ' + COLUMNAS.venta.map(c => 'v.' + identificador(c)).join(', ')
    + ', COALESCE(t.`cli_id`, n.`cli_id`, r.`cli_id`) AS cli_id ' + desdeVenta;
  function comprobar() { if (!validado) throw new Error('ESQUEMA_NO_VALIDADO'); }
  const primeraVentaDesde = async (leer, fecha) => {
    const [fila] = await leer(PRIMERA_VENTA_DESDE, [fecha]);
    return fila?.desde == null ? null : String(fila.desde);
  };
  // Para --verificar: las de público por número de cliente (o sin cliente, que cuenta como 0) en SQL; el nombre se revisa
  // en JS (index.js). Sin paréntesis tras WHERE/AND: la guardia los toma por función.
  const contarPublico = leer => leer(`SELECT COUNT(*) AS total ${desdeVenta} WHERE v.\`fecha\` >= ? `
    + `AND COALESCE(t.\`cli_id\`, n.\`cli_id\`, r.\`cli_id\`, 0) IN (0, ${huecos([...PUBLICOS])})`, [INICIO_MOSTRADOR, ...PUBLICOS]);
  // Con un id que se puede repetir, el servidor rechaza el lote (ID_DUPLICADO) y el agente se detendría con todo y
  // clientes y ventas. Solo se habilitan si el id es PRIMARY o UNIQUE de una sola columna completa; si no, o si el
  // índice no se puede leer, la lista queda apagada (falla cerrando) sin tumbar la validación.
  async function idProveedorUnico(leer) {
    let indices;
    try { indices = await leer(`SHOW INDEX FROM ${identificador(tablaProveedor)}`); } catch { return false; }
    const columnaId = COLUMNAS_PROVEEDORES[tablaProveedor][0];
    const porIndice = new Map();
    for (const i of indices) porIndice.set(i.Key_name, [...(porIndice.get(i.Key_name) || []), i]);
    return [...porIndice.values()].some(partes => partes.length === 1 && String(partes[0].Non_unique) === '0'
      && partes[0].Column_name === columnaId && partes[0].Sub_part == null);
  }
  // Para --verificar: cuántas vigentes hay y cuánto tarda leerlas todas, página por página, como en cada corrida.
  async function medirExistencias(leer) {
    const total = String((await leer(`SELECT COUNT(*) AS total ${DESDE_EXISTENCIAS}`))[0].total);
    const inicio = performance.now();
    for (let cursor = '0'; ;) {
      const filas = await leer(LEER_EXISTENCIAS, [cursor, paginaExistencias(500)]);
      if (!filas.length) break;
      cursor = String(filas.at(-1).art_id);
    }
    return { total, ms: Math.round(performance.now() - inicio) };
  }
  // Para --verificar: cuánto tarda la consulta de ventas (la misma de cada corrida) con los últimos 100 cortes.
  async function medirCortes(leer) {
    const total = String((await leer('SELECT COUNT(*) AS total FROM `cortecaja`'))[0].total);
    const inicio = performance.now();
    const ids = (await leer('SELECT c.`cor_id` FROM `cortecaja` c ORDER BY c.`cor_id` DESC LIMIT ?', [MAXIMO_CORTES])).map(c => String(c.cor_id));
    if (ids.length) await ventasDeCortes(leer, ids);
    return { total, ms: Math.round(performance.now() - inicio) };
  }
  async function clientesIds(leer, ids) {
    if (!ids.length) return [];
    return leer(`SELECT ${lista(COLUMNAS.cliente)} FROM \`cliente\` WHERE \`cli_id\` IN (${huecos(ids)})`, ids);
  }
  async function completar(leer, filas) {
    const ids = filas.map(v => String(v.ven_id));
    const clientes = await clientesIds(leer, [...new Set(filas.filter(v => v.cli_id != null).map(v => String(v.cli_id)))]);
    const detalles = ids.length ? await leer(`SELECT ${lista(COLUMNAS.detallev)} FROM \`detallev\` `
      + `WHERE \`ven_id\` IN (${huecos(ids)}) ORDER BY ${lista(pkDetalle)}`, ids) : [];
    return { filas, clientes, detalles };
  }
  return {
    get tamano() { return lector.tamano; },
    get articulosDisponibles() { return Array.isArray(articulosFaltantes) && !articulosFaltantes.length; },
    async articulos(cursor, limite) {
      comprobar();
      if (articulosFaltantes.length) throw new Error('ARTICULOS_NO_DISPONIBLES');
      return lector.pagina(leer => leer('SELECT a.`art_id`, a.`clave`, a.`descripcion`, c.`nombre` AS categoria, d.`nombre` AS departamento '
        + 'FROM `articulo` a LEFT JOIN `categoria` c ON c.`cat_id` = a.`cat_id` LEFT JOIN `departamento` d ON d.`dep_id` = c.`dep_id` '
        // Filas chicas: cinco veces la página normal (100 → 500, lo que cabe en un lote); baja si SICAR se pone lento.
        + 'WHERE a.`art_id` > ? ORDER BY a.`art_id` LIMIT ?', [cursor, Math.min(limite, lector.tamano * 5)]));
    },
    get proveedoresDisponibles() { return Array.isArray(proveedoresFaltantes) && !proveedoresFaltantes.length; },
    async proveedores(cursor, limite) {
      comprobar();
      if (proveedoresFaltantes.length) throw new Error('PROVEEDORES_NO_DISPONIBLES');
      // Se renombran a prv_id y nombre: el contrato no cambia aunque SICAR use otros nombres de columna.
      return lector.pagina(leer => leer(`SELECT p.${idProveedor} AS prv_id, p.${nombreProveedor} AS nombre `
        + `FROM ${identificador(tablaProveedor)} p WHERE p.${idProveedor} > ? AND p.${proveedorVigente} ORDER BY p.${idProveedor} LIMIT ?`,
      [cursor, Math.min(limite, lector.tamano * 5)]));
    },
    get existenciasDisponibles() { return Array.isArray(existenciasFaltantes) && !existenciasFaltantes.length; },
    async existencias(cursor, limite) {
      comprobar();
      if (existenciasFaltantes.length) throw new Error('EXISTENCIAS_NO_DISPONIBLES');
      return lector.pagina(leer => leer(LEER_EXISTENCIAS, [cursor, paginaExistencias(limite)]));
    },
    get cortesDisponibles() { return Array.isArray(cortesFaltantes) && !cortesFaltantes.length; },
    // Una sola página (misma transacción): los cortes y, para esos cor_id, sus formas de pago, quién lo cerró y las ventas
    // del turno con quién las dio de alta. Los textos CorteCaja y Venta van como parámetro: la guardia no admite comillas.
    async cortes(cursor, limite) {
      comprobar();
      if (cortesFaltantes.length) throw new Error('CORTES_NO_DISPONIBLES');
      return lector.pagina(async leer => {
        const cortes = await leer(LEER_CORTES, [cursor, Math.min(limite, MAXIMO_CORTES)]);
        if (!cortes.length) return { cortes, pagos: [], cajeros: [], resumenes: [], ventas: [] };
        const ids = cortes.map(c => String(c.cor_id));
        const pagos = await leer('SELECT p.`cor_id`, p.`tpa_id`, p.`contado`, p.`calculado`, p.`diferencia`, p.`retiro` '
          + `FROM \`cortetipopago\` p WHERE p.\`cor_id\` IN (${huecos(ids)})`, ids);
        const cajeros = await leer('SELECT h.`id`, h.`usu_id` FROM `historial` h WHERE h.`tabla` = ? AND h.`movimiento` = 0 '
          + `AND h.\`id\` IN (${huecos(ids)})`, ['CorteCaja', ...ids]);
        // El resumen se crea al cerrar, un instante después del renglón de historial: sin él, el corte puede estar a medias.
        const resumenes = await leer(`SELECT r.\`cor_id\`, r.\`rcc_id\` FROM \`resumencortecaja\` r WHERE r.\`cor_id\` IN (${huecos(ids)})`, ids);
        const ventas = await ventasDeCortes(leer, ids);
        return { cortes, pagos, cajeros, resumenes, ventas };
      });
    },
    async validar() {
      await lector.pagina(async leer => {
        const columnas = await leer('SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
        const presentes = new Set(columnas.map(c => `${c.TABLE_NAME}.${c.COLUMN_NAME}`));
        const requeridas = { ...COLUMNAS, historial: [...COLUMNAS.historial, ...(referencia ? [referencia] : [])] };
        for (const [tabla, campos] of Object.entries(requeridas)) {
          for (const campo of campos) {
            if (!presentes.has(`${tabla}.${campo}`)) {
              const error = new Error(`Falta columna ${tabla}.${campo}`);
              error.columna = `${tabla}.${campo}`;
              throw error;
            }
          }
        }
        columnasHistorial = columnas.filter(c => c.TABLE_NAME === 'historial').map(c => c.COLUMN_NAME)
          .filter(c => !/^(huella|muestra|foto)$/i.test(c));
        const indices = await leer('SHOW INDEX FROM `detallev`');
        pkDetalle = indices.filter(i => i.Key_name === 'PRIMARY').sort((a, b) => a.Seq_in_index - b.Seq_in_index).map(i => i.Column_name);
        if (!pkDetalle.length) throw new Error('DETALLE_SIN_PK');
        for (const campo of pkDetalle) {
          identificador(campo);
          if (!presentes.has(`detallev.${campo}`)) throw new Error('PK_DETALLE_INVALIDA');
        }
        columnasArticulos = columnas.map(c => `${c.TABLE_NAME}.${c.COLUMN_NAME}`)
          .filter(c => Object.keys(COLUMNAS_ARTICULOS).includes(c.split('.')[0]) && !/\.(huella|muestra|foto)$/i.test(c));
        articulosFaltantes = Object.entries(COLUMNAS_ARTICULOS).flatMap(([tabla, campos]) => campos.map(c => `${tabla}.${c}`))
          .filter(c => !presentes.has(c));
        columnasProveedores = columnas.map(c => `${c.TABLE_NAME}.${c.COLUMN_NAME}`)
          .filter(c => c.split('.')[0] === tablaProveedor && !/\.(huella|muestra|foto)$/i.test(c));
        proveedoresFaltantes = Object.entries(COLUMNAS_PROVEEDORES).flatMap(([tabla, campos]) => campos.map(c => `${tabla}.${c}`))
          .filter(c => !presentes.has(c));
        if (!proveedoresFaltantes.length && !await idProveedorUnico(leer)) {
          proveedoresFaltantes = [`${tablaProveedor}.${COLUMNAS_PROVEEDORES[tablaProveedor][0]} (sin índice único)`];
        }
        const [tablaExistencias] = Object.keys(COLUMNAS_EXISTENCIAS);
        columnasExistencias = columnas.map(c => `${c.TABLE_NAME}.${c.COLUMN_NAME}`)
          .filter(c => COLUMNAS_EXISTENCIAS[tablaExistencias].map(x => `${tablaExistencias}.${x}`).includes(c));
        existenciasFaltantes = COLUMNAS_EXISTENCIAS[tablaExistencias].map(c => `${tablaExistencias}.${c}`).filter(c => !presentes.has(c));
        const requeridasCortes = Object.entries(COLUMNAS_CORTES).flatMap(([tabla, campos]) => campos.map(c => `${tabla}.${c}`));
        columnasCortes = requeridasCortes.filter(c => presentes.has(c));
        cortesFaltantes = requeridasCortes.filter(c => !presentes.has(c));
        validado = true;
      });
    },
    async mostradorDesde(fecha) {
      comprobar();
      return lector.pagina(leer => primeraVentaDesde(leer, fecha));
    },
    async tope() {
      comprobar();
      return lector.pagina(async leer => String((await leer('SELECT MAX(`ven_id`) AS tope FROM `venta`'))[0].tope || '0'));
    },
    async clientes(cursor, limite) {
      comprobar();
      return lector.pagina(leer => leer(`SELECT ${lista(COLUMNAS.cliente)} FROM \`cliente\` WHERE \`cli_id\` > ? ORDER BY \`cli_id\` LIMIT ?`,
        [cursor, Math.min(limite, lector.tamano)]));
    },
    async ventas(cursor, tope, limite) {
      comprobar();
      return lector.pagina(async leer => completar(leer,
        await leer(seleccionarVenta + ' WHERE v.`ven_id` > ? AND v.`ven_id` <= ? ORDER BY v.`ven_id` LIMIT ?',
          [cursor, tope, Math.min(limite, lector.tamano)])));
    },
    async porIds(ids) {
      comprobar();
      if (!ids.length) return { filas: [], clientes: [], detalles: [] };
      if (ids.length > lector.tamano) throw new Error('PAGINA_EXCESIVA');
      return lector.pagina(async leer => completar(leer,
        await leer(seleccionarVenta + ` WHERE v.\`ven_id\` IN (${huecos(ids)}) ORDER BY v.\`ven_id\``, ids)));
    },
    async clientesIds(ids) {
      comprobar();
      return lector.pagina(leer => clientesIds(leer, ids));
    },
    async historial(cursor, limite) {
      comprobar();
      if (!referencia) return [];
      return lector.pagina(leer => leer(`SELECT ${lista(COLUMNAS.historial)}, ${identificador(referencia)} AS referencia FROM \`historial\` `
        + 'WHERE `his_id` > ? ORDER BY `his_id` LIMIT ?', [cursor, Math.min(limite, lector.tamano)]));
    },
    async verificar() {
      comprobar();
      return lector.pagina(async leer => ({
        grants: await leer('SHOW GRANTS'),
        columnas: await leer('SHOW FULL COLUMNS FROM historial'),
        ventas: await leer(`SELECT ${lista(columnasHistorial)} FROM \`historial\` `
          + 'WHERE `tabla` = ? AND `movimiento` = ? ORDER BY `his_id` DESC LIMIT 3', ['Venta', 2]),
        clientes: await leer(`SELECT ${lista(columnasHistorial)} FROM \`historial\` `
          + 'WHERE `tabla` = ? ORDER BY `his_id` DESC LIMIT 3', ['Cliente']),
        articulos: { columnas: columnasArticulos, faltantes: articulosFaltantes,
          total: articulosFaltantes.length ? null : String((await leer('SELECT COUNT(*) AS total FROM `articulo`'))[0].total) },
        proveedores: { columnas: columnasProveedores, faltantes: proveedoresFaltantes, total: proveedoresFaltantes.length ? null
          : String((await leer(`SELECT COUNT(*) AS total FROM ${identificador(tablaProveedor)} WHERE ${proveedorVigente}`))[0].total) },
        existencias: existenciasFaltantes.length ? { columnas: columnasExistencias, faltantes: existenciasFaltantes, total: null, ms: null }
          : { columnas: columnasExistencias, faltantes: [], ...await medirExistencias(leer) },
        cortes: cortesFaltantes.length ? { columnas: columnasCortes, faltantes: cortesFaltantes, total: null, ms: null }
          : { columnas: columnasCortes, faltantes: [], ...await medirCortes(leer) },
        mostrador: { desde_ven_id: await primeraVentaDesde(leer, INICIO_MOSTRADOR),
          total_publico_desde_2025: String((await contarPublico(leer))[0].total) },
      }));
    },
  };
}
module.exports = { crearFuente };
