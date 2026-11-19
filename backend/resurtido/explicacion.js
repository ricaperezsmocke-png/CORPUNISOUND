const { fechaLocal } = require('../fechas');
const { TIENDAS, INDICES_SICAR, leerConfig } = require('./config');
const { existenciaActual, ventasDiarias, ventasPorTicket, ventasMensualesMarca } = require('./lector');
const { diasEnCero } = require('./existenciaDiaria');
const { toparDemanda } = require('./demanda');
const { completarMeses } = require('./servicio');
const { indicesTemporada, factorPara } = require('./temporada');
const { movimientos, deltaInverso } = require('./movimientos');
const DIA = 86400000;
const decimal = n => Math.round(n * 10) / 10;
const piezas = n => n == null ? null : decimal(n / 10000);
const fecha = ms => new Date(ms).toISOString().slice(0, 10);
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function serieMensual(sqlite, suc, clave, hasta, existencia, actualizado) {
  const fin = new Date(`${hasta}T00:00:00Z`);
  const meses = Array.from({ length: 12 }, (_, i) => {
    const inicio = Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - 11 + i, 1);
    const cierre = Math.min(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - 10 + i, 1) - DIA, fin.getTime());
    return { mes: fecha(inicio).slice(0, 7), hasta: fecha(cierre), piezas_vendidas: 0,
      entradas_traspaso: 0, entradas_compra: 0, salidas_traspaso: 0, existencia_cierre: null };
  });
  const desde = `${meses[0].mes}-01`, ancla = actualizado ? fechaLocal(actualizado) : hasta;
  const cambios = movimientos(sqlite, suc, desde, ancla).get(clave) || new Map();
  const ventas = ventasDiarias(sqlite, suc, desde).get(clave) || new Map();
  const cierres = new Map(meses.map(m => [m.hasta, m]));
  let valor = existencia;
  for (let ms = Date.parse(`${ancla}T00:00:00Z`); ms >= Date.parse(`${desde}T00:00:00Z`); ms -= DIA) {
    const dia = fecha(ms);
    // Al cierre aún no se deshacen los movimientos de ese día. Las fotos son mínimos intradía, no cierres.
    if (cierres.has(dia) && valor != null) cierres.get(dia).existencia_cierre = piezas(Math.max(0, valor));
    if (valor != null) valor += deltaInverso(cambios.get(dia));
  }
  for (const m of meses) {
    for (const [dia, cantidad] of ventas) if (dia.startsWith(m.mes) && dia <= m.hasta) m.piezas_vendidas += cantidad;
    for (const [dia, cambio] of cambios) if (dia.startsWith(m.mes) && dia <= m.hasta) {
      for (const campo of ['entradas_traspaso', 'entradas_compra', 'salidas_traspaso']) m[campo] += cambio[campo];
    }
    for (const campo of ['piezas_vendidas', 'entradas_traspaso', 'entradas_compra', 'salidas_traspaso']) m[campo] = piezas(m[campo]);
  }
  return meses;
}

function explicar(sqlite, sucursal_id, clave, ahora = new Date().toISOString()) {
  const suc = Number(sucursal_id);
  if (!TIENDAS.includes(suc)) throw error(400, 'Elige una tienda válida.');
  if (typeof clave !== 'string' || !clave.trim()) throw error(400, 'Indica la clave del producto.');
  const articulo = sqlite.prepare(`SELECT MIN(descripcion) descripcion,
    MAX(CASE WHEN UPPER(TRIM(departamento)) IN ('JR','SOLCOR') THEN UPPER(TRIM(departamento)) END) marca
    FROM sicar_articulos WHERE sucursal_id=? AND clave=?`).get(suc, clave);
  const ajuste = sqlite.prepare('SELECT * FROM resurtido_ajustes WHERE sucursal_id=? AND clave=?').get(suc, clave);
  const calculado = sqlite.prepare('SELECT * FROM resurtido_minmax WHERE sucursal_id=? AND clave=?').get(suc, clave);
  const actual = existenciaActual(sqlite, suc), existencia = actual.porClave.get(clave);
  if ((!articulo.marca || existencia === undefined) && !ajuste) throw error(404, 'Clave no encontrada en el resurtido de esta tienda.');
  const config = leerConfig(sqlite), hoy = fechaLocal(calculado?.calculado_en || ahora);
  const fin = Date.parse(`${hoy}T00:00:00Z`) - DIA;
  const hasta = fecha(fin), desde = fecha(fin - (config.dias_historia - 1) * DIA);
  const ventas = ventasDiarias(sqlite, suc, desde).get(clave) || new Map();
  const total = [...ventas].reduce((suma, [dia, cantidad]) => suma + (dia <= hasta ? cantidad : 0), 0);
  const demanda = toparDemanda(ventasPorTicket(sqlite, suc, desde, hasta).get(clave) || [],
    diasEnCero(sqlite, suc, clave, desde, hasta), desde, hasta);
  const ceros = sqlite.prepare(`SELECT COUNT(*) dias,COALESCE(SUM(piezas_diezmilesimas<=0 AND origen='foto'),0) observados,
    COALESCE(SUM(piezas_diezmilesimas<=0 AND origen='reconstruida'),0) reconstruidos
    FROM resurtido_existencia_diaria WHERE sucursal_id=? AND clave=? AND dia BETWEEN ? AND ?`).get(suc, clave, desde, hasta);
  const marca = articulo.marca || calculado?.marca;
  const temporada = indicesTemporada(completarMeses(ventasMensualesMarca(sqlite, marca), hoy.slice(0, 7)),
    hoy.slice(0, 7));
  const usarSicar = temporada.motivo !== null && !!INDICES_SICAR[marca];
  const indices = usarSicar ? INDICES_SICAR[marca] : temporada.indices;
  const mes = Number(hoy.slice(5, 7));
  return { sucursal_id: suc, clave, descripcion: articulo.descripcion || clave, existencia: piezas(existencia),
    ya_no_la_maneja: existencia === undefined, desde, hasta, dias_historia: config.dias_historia,
    piezas_vendidas: piezas(total), venta_mensual_simple: piezas(total / config.dias_historia * 30),
    piezas_pedido_especial: piezas(demanda.piezasPedidoEspecial),
    dias_en_cero: ceros.observados + ceros.reconstruidos, ceros_observados: ceros.observados,
    ceros_reconstruidos: ceros.reconstruidos, dias_sin_dato: config.dias_historia - ceros.dias,
    indices: indices.map(decimal), factor: decimal(factorPara(indices, mes)), mes_calculo: mes,
    temporada_origen: usarSicar ? 'sicar' : 'calculada',
    temporada_motivo: temporada.motivo, venta_diaria: piezas(calculado?.venta_diaria_diezmilesimas),
    minimo: piezas(ajuste?.minimo ?? calculado?.minimo), maximo: piezas(ajuste?.maximo ?? calculado?.maximo),
    corregido: !!ajuste, calculado_en: calculado?.calculado_en || null,
    serie_mensual: serieMensual(sqlite, suc, clave, hasta, existencia, actual.actualizado) };
}
module.exports = { explicar };
