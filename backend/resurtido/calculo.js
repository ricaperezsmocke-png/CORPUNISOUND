const { factorPara } = require('./temporada');
const ceilPieza = valor => Math.ceil(valor / 10000) * 10000;

function calcularMinMax({ ventasPorDia, diasEnCero, desde, hasta, indices, mesCalculo, config }) {
  const validos = []; let total = 0, ceros = 0, dias = 0, ventaValida = 0, sumaIndices = 0;
  for (let ms = Date.parse(`${desde}T00:00:00Z`); ms <= Date.parse(`${hasta}T00:00:00Z`); ms += 86400000) {
    const dia = new Date(ms).toISOString().slice(0, 10), venta = ventasPorDia.get(dia) || 0;
    dias++; total += venta;
    if (diasEnCero.has(dia)) ceros++;
    if (!diasEnCero.has(dia) || venta > 0) {
      const indice = indices[Number(dia.slice(5, 7)) - 1];
      validos.push(venta / indice);
      ventaValida += venta; sumaIndices += indice;
    }
  }
  const base = { venta_diaria: 0, dias_validos: validos.length, dias_en_cero: ceros };
  const sinHistoria = () => ({ ...base, minimo: 10000, maximo: 20000, lista: 'sin_historia' });
  if (total === 0) return { ...base, minimo: 0, maximo: 0,
    lista: ceros / dias * 100 >= config.proporcion_cero_sin_historia ? 'sin_movimiento' : 'no_se_mueve' };
  if (validos.length < config.dias_validos_minimos) return sinHistoria();
  const mu = ventaValida / sumaIndices;
  const varianza = validos.length > 1 ? validos.reduce((suma, v) => suma + (v - mu) ** 2, 0) / (validos.length - 1) : 0;
  const factor = factorPara(indices, mesCalculo), diaria = mu * factor;
  const minimo = ceilPieza(diaria * config.plazo_dias
    + config.z_servicio_centesimas / 100 * Math.sqrt(varianza) * factor * Math.sqrt(config.plazo_dias));
  const maximo = Math.max(minimo + 10000, ceilPieza(minimo + diaria * config.ciclo_dias));
  return { ...base, minimo, maximo, venta_diaria: Math.round(diaria), lista: 'calculado' };
}
module.exports = { calcularMinMax };
