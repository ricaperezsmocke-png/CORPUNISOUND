// Cantidades en diezmilésimas. El tope solo afecta demanda, nunca movimientos físicos.
function toparDemanda(filas, diasEnCero, desde, hasta) {
  const ventana = filas.filter(f => f.dia >= desde && f.dia <= hasta);
  const originales = new Map(); let total = 0, validos = 0;
  for (const f of ventana) {
    originales.set(f.dia, (originales.get(f.dia) || 0) + f.cantidad);
    total += f.cantidad;
  }
  for (let ms = Date.parse(`${desde}T00:00:00Z`); ms <= Date.parse(`${hasta}T00:00:00Z`); ms += 86400000) {
    const dia = new Date(ms).toISOString().slice(0, 10);
    if (!diasEnCero.has(dia) || originales.get(dia) > 0) validos++;
  }
  const tope = validos ? Math.max(1, Math.ceil(total / validos * 30 / 10000)) * 10000 : Infinity;
  const ventasPorDia = new Map(); let piezasPedidoEspecial = 0;
  for (const f of ventana) {
    const cantidad = Math.min(f.cantidad, tope);
    ventasPorDia.set(f.dia, (ventasPorDia.get(f.dia) || 0) + cantidad);
    piezasPedidoEspecial += f.cantidad - cantidad;
  }
  return { ventasPorDia, piezasPedidoEspecial };
}
module.exports = { toparDemanda };
