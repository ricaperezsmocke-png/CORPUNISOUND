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
// Proveedores con los que la tienda consigue la mercancía (Radar de Demanda, 2026-10-23). Esquema supuesto: se confirma
// con --verificar. Opcionales igual que los artículos: si falta una columna, se sigue con todo lo demás y no se mandan.
// Si SICAR los nombra distinto, se cambian aquí los dos nombres: [id, nombre].
const COLUMNAS_PROVEEDORES = { proveedor: ['prv_id', 'nombre'] };
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
  const [tablaProveedor] = Object.keys(COLUMNAS_PROVEEDORES);
  const [idProveedor, nombreProveedor] = COLUMNAS_PROVEEDORES[tablaProveedor].map(identificador);
  const desdeVenta = 'FROM `venta` v LEFT JOIN `ticket` t ON t.`tic_id` = v.`tic_id` '
    + 'LEFT JOIN `nota` n ON n.`not_id` = v.`not_id` LEFT JOIN `remision` r ON r.`rem_id` = v.`rem_id`';
  const seleccionarVenta = 'SELECT ' + COLUMNAS.venta.map(c => 'v.' + identificador(c)).join(', ')
    + ', COALESCE(t.`cli_id`, n.`cli_id`, r.`cli_id`) AS cli_id ' + desdeVenta;
  function comprobar() { if (!validado) throw new Error('ESQUEMA_NO_VALIDADO'); }
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
        + `FROM ${identificador(tablaProveedor)} p WHERE p.${idProveedor} > ? ORDER BY p.${idProveedor} LIMIT ?`,
      [cursor, Math.min(limite, lector.tamano * 5)]));
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
        validado = true;
      });
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
          : String((await leer(`SELECT COUNT(*) AS total FROM ${identificador(tablaProveedor)}`))[0].total) },
      }));
    },
  };
}
module.exports = { crearFuente };
