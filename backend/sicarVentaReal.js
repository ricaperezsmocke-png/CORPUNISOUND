// Definición compartida de venta SICAR real: cliente no interno + mostrador, ambos vigentes.
// Los importes permanecen en centavos; las internas solo se informan por separado.
function NO_INTERNA(alias) {
  if (typeof alias !== 'string' || alias.match(/^[a-z_][a-z0-9_]*$/i)?.[0] !== alias) {
    throw new Error('El alias SQL debe ser un identificador válido.');
  }
  // SQLite compara alias sin distinguir mayúsculas: evitar también una colisión con el alias reservado.
  const interna = alias.toLowerCase() === '_si' ? '_si2' : '_si';
  return `NOT EXISTS (SELECT 1 FROM sicar_internas ${interna} WHERE
    ${interna}.sucursal_id = ${alias}.sucursal_id AND ${interna}.cli_id = ${alias}.cli_id)`;
}

const VIGENTES_CLIENTE = `FROM sicar_ventas WHERE sucursal_id = @suc AND estado = 'vigente'
  AND fecha_local >= @desde AND fecha_local < @hasta`;
const VIGENTES_MOSTRADOR = `FROM sicar_ventas_mostrador WHERE sucursal_id = @suc AND estado = 'vigente'
  AND fecha_local >= @desde AND fecha_local < @hasta`;
const CLIENTE_REAL = `${VIGENTES_CLIENTE} AND ${NO_INTERNA('sicar_ventas')}`;

const SQL_TOTALES = `SELECT
  (SELECT COUNT(*) ${CLIENTE_REAL}) AS ventas_cliente,
  (SELECT COALESCE(SUM(total_centavos), 0) ${CLIENTE_REAL}) AS cliente_centavos,
  (SELECT COUNT(*) ${VIGENTES_MOSTRADOR}) AS ventas_mostrador,
  (SELECT COALESCE(SUM(total_centavos), 0) ${VIGENTES_MOSTRADOR}) AS mostrador_centavos,
  (SELECT COALESCE(SUM(total_centavos), 0) ${VIGENTES_CLIENTE}
    AND NOT (${NO_INTERNA('sicar_ventas')})) AS internas_centavos,
  EXISTS (SELECT 1 FROM sicar_tiendas WHERE sucursal_id = @suc) AS con_agente`;

function ventaSicarTienda(sqlite, { sucursal_id, desde, hasta }) {
  if (sqlite == null) {
    return {
      venta_centavos: 0, ventas: 0, cliente_centavos: 0,
      mostrador_centavos: 0, internas_centavos: 0, sin_dato: true, motivo: 'sin_integracion',
    };
  }
  const t = sqlite.prepare(SQL_TOTALES).get({ suc: sucursal_id, desde, hasta });
  let motivo = null;
  if (!t.con_agente) motivo = 'sin_agente';
  else if (t.ventas_mostrador === 0) motivo = 'sin_mostrador';
  return {
    venta_centavos: t.cliente_centavos + t.mostrador_centavos,
    ventas: t.ventas_cliente + t.ventas_mostrador,
    cliente_centavos: t.cliente_centavos,
    mostrador_centavos: t.mostrador_centavos,
    internas_centavos: t.internas_centavos,
    sin_dato: motivo !== null,
    motivo,
  };
}

// Límites locales para comparar fecha_local como texto, sin conversión de zona horaria.
function rangoDelMes(mes) {
  if (typeof mes !== 'string' || mes.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Error('El mes debe tener formato AAAA-MM válido.');
  }
  const anio = Number(mes.slice(0, 4));
  const numeroMes = Number(mes.slice(5));
  const siguienteAnio = String(numeroMes === 12 ? anio + 1 : anio).padStart(4, '0');
  const siguienteMes = String(numeroMes === 12 ? 1 : numeroMes + 1).padStart(2, '0');
  return { desde: `${mes}-01`, hasta: `${siguienteAnio}-${siguienteMes}-01` };
}

module.exports = { NO_INTERNA, ventaSicarTienda, rangoDelMes };
