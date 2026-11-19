const { NO_INTERNA } = require('../sicarVentaReal');
const { TIENDAS, MARCAS } = require('./config');
const DE_MARCA = "UPPER(TRIM(a.departamento)) IN ('JR','SOLCOR') AND a.clave IS NOT NULL AND TRIM(a.clave) <> ''";

function clavesDeMarca(sqlite, sucursal_id) {
  const resultado = new Map(); resultado.omitidas = 0;
  if (!TIENDAS.includes(Number(sucursal_id))) return resultado;
  const filas = sqlite.prepare(`SELECT art_id, clave, descripcion, UPPER(TRIM(departamento)) marca FROM sicar_articulos
    WHERE sucursal_id=? AND UPPER(TRIM(departamento)) IN ('JR','SOLCOR') ORDER BY art_id`).all(sucursal_id);
  const vigentes = existenciaActual(sqlite, sucursal_id).porClave;
  for (const fila of filas) {
    if (!fila.clave?.trim()) { resultado.omitidas++; continue; }
    if (!vigentes.has(fila.clave)) continue;
    if (!resultado.has(fila.clave)) resultado.set(fila.clave, { marca: fila.marca, descripcion: fila.descripcion, art_ids: [] });
    resultado.get(fila.clave).art_ids.push(fila.art_id);
  }
  return resultado;
}

function filasVentas(sqlite, sucursal_id, desde, longitud = 10, incluirInternas = false) {
  return [false, true].flatMap(mostrador => {
    const ventas = mostrador ? 'sicar_ventas_mostrador' : 'sicar_ventas';
    const detalles = mostrador ? 'sicar_detalles_mostrador' : 'sicar_detalles';
    return sqlite.prepare(`SELECT a.clave, UPPER(TRIM(a.departamento)) marca, SUBSTR(v.fecha_local,1,${longitud}) dia,
      SUM(CAST(ROUND(CAST(d.cantidad AS REAL)*10000) AS INTEGER)) cantidad
      FROM ${ventas} v JOIN ${detalles} d ON d.sucursal_id=v.sucursal_id AND d.ven_id=v.ven_id
      JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
      WHERE v.sucursal_id=? AND v.estado='vigente' AND v.fecha_local>=? AND ${DE_MARCA}
      ${mostrador || incluirInternas ? '' : `AND ${NO_INTERNA('v')}`} GROUP BY a.clave, marca, dia`).all(sucursal_id, desde);
  });
}

function agregar(resultado, fila) {
  if (!resultado.has(fila.clave)) resultado.set(fila.clave, new Map());
  const dias = resultado.get(fila.clave);
  dias.set(fila.dia, (dias.get(fila.dia) || 0) + fila.cantidad);
}

function ventasPorTicket(sqlite, sucursal_id, desde, hasta) {
  const resultado = new Map();
  if (!TIENDAS.includes(Number(sucursal_id))) return resultado;
  for (const mostrador of [false, true]) {
    const ventas = mostrador ? 'sicar_ventas_mostrador' : 'sicar_ventas';
    const detalles = mostrador ? 'sicar_detalles_mostrador' : 'sicar_detalles';
    const filas = sqlite.prepare(`SELECT a.clave, SUBSTR(v.fecha_local,1,10) dia,
      SUM(CAST(ROUND(CAST(d.cantidad AS REAL)*10000) AS INTEGER)) cantidad
      FROM ${ventas} v JOIN ${detalles} d ON d.sucursal_id=v.sucursal_id AND d.ven_id=v.ven_id
      JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
      WHERE v.sucursal_id=? AND v.estado='vigente' AND SUBSTR(v.fecha_local,1,10) BETWEEN ? AND ? AND ${DE_MARCA}
      ${mostrador ? '' : `AND ${NO_INTERNA('v')}`} GROUP BY v.ven_id,d.art_id`).all(sucursal_id, desde, hasta);
    for (const fila of filas) {
      if (!resultado.has(fila.clave)) resultado.set(fila.clave, []);
      resultado.get(fila.clave).push({ dia: fila.dia, cantidad: fila.cantidad });
    }
  }
  return resultado;
}

function ventasDiarias(sqlite, sucursal_id, desde, incluirInternas = false) {
  const resultado = new Map();
  if (TIENDAS.includes(Number(sucursal_id))) {
    for (const fila of filasVentas(sqlite, sucursal_id, desde, 10, incluirInternas)) agregar(resultado, fila);
  }
  return resultado;
}

function existenciaActual(sqlite, sucursal_id) {
  if (!TIENDAS.includes(Number(sucursal_id))) return { porClave: new Map(), actualizado: null };
  const filas = sqlite.prepare(`SELECT a.clave, COALESCE(SUM(e.existencia_diezmilesimas),0) piezas
    FROM sicar_articulos a JOIN sicar_existencias e ON e.sucursal_id=a.sucursal_id AND e.art_id=a.art_id
    WHERE a.sucursal_id=? AND ${DE_MARCA} GROUP BY a.clave`).all(sucursal_id);
  const { actualizado } = sqlite.prepare('SELECT MAX(actualizado_en) actualizado FROM sicar_existencias WHERE sucursal_id=?').get(sucursal_id);
  return { porClave: new Map(filas.map(f => [f.clave, f.piezas])), actualizado };
}

// La Task 2 consume meses POR CLAVE: conservar esa dimensión para dar igual peso a cada producto.
function ventasMensualesMarca(sqlite, marca, tiendas = TIENDAS) {
  const resultado = new Map();
  if (!MARCAS.includes(marca)) return resultado;
  for (const tienda of new Set(tiendas.map(Number).filter(id => TIENDAS.includes(id)))) {
    // Desde 2025 están disponibles tanto las ventas con cliente como las de mostrador.
    for (const fila of filasVentas(sqlite, tienda, '2025-01-01', 7)) if (fila.marca === marca) agregar(resultado, fila);
  }
  return resultado;
}
module.exports = { clavesDeMarca, ventasDiarias, ventasPorTicket, existenciaActual, ventasMensualesMarca };
