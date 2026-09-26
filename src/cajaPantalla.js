export function puedeCambiarCaja(marca) {
  return marca !== "1";
}

export function nombreCajaActiva(cajas, cajaId) {
  return cajas.find((caja) => String(caja.id) === String(cajaId))?.nombre || "Sin caja";
}

export function formatoImporteCaja(importe) {
  const numero = Number(importe || 0);
  const cifra = Math.abs(numero).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${numero < 0 ? "-" : ""}$ ${cifra}`;
}
