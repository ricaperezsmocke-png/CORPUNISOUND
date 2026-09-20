// Debe conservar el mismo redondeo y orden de operaciones que backend/ventas.js.
function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function calcularTotalesVenta(carrito, descuentoPago = 0) {
  const lineas = carrito.map((f) => {
    const bruto = redondear(f.cantidad * f.precioUnitario);
    const descuentoPct = Number(f.descuentoPct) || 0;
    return { bruto, importe: redondear(bruto * (1 - descuentoPct / 100)) };
  });
  const subtotal = redondear(lineas.reduce((s, l) => s + l.bruto, 0));
  const total = redondear(lineas.reduce((s, l) => s + l.importe, 0));
  const descuentoTotal = redondear(subtotal - total);
  const totalConCondicion = redondear(total * (1 - (Number(descuentoPago) || 0) / 100));
  const importes = lineas.map((l) => l.importe);
  return { subtotal, descuentoTotal, total, totalConCondicion, importes };
}
