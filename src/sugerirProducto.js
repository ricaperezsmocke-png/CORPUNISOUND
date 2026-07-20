const LARGO_MINIMO_PALABRA = 3;

export function normalizarTexto(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim()
    .toLowerCase();
}

function palabrasSignificativas(texto) {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter((palabra) => palabra.length >= LARGO_MINIMO_PALABRA);
}

export function sugerirProducto({ codigo, descripcion }, productos, { incluirClaveSat = false } = {}) {
  if (codigo) {
    const codigoNorm = normalizarTexto(codigo);
    const porCodigo = productos.find((p) =>
      (p.sku && normalizarTexto(p.sku) === codigoNorm) ||
      (p.codigo && normalizarTexto(p.codigo) === codigoNorm) ||
      (incluirClaveSat && p.clave_sat && normalizarTexto(p.clave_sat) === codigoNorm)
    );
    if (porCodigo) return { producto_id: porCodigo.id, porSugerencia: "codigo" };
  }

  const palabrasDescripcion = palabrasSignificativas(descripcion);
  if (palabrasDescripcion.length === 0) return null;

  let mejorProducto = null;
  let mejorPuntaje = 0;
  for (const p of productos) {
    const palabrasNombre = palabrasSignificativas(p.nombre);
    if (palabrasNombre.length === 0) continue;
    const comunes = palabrasDescripcion.filter((palabra) => palabrasNombre.includes(palabra)).length;
    if (comunes === 0) continue;
    const puntaje = comunes / palabrasDescripcion.length;
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorProducto = p;
    }
  }
  return mejorProducto ? { producto_id: mejorProducto.id, porSugerencia: "descripcion" } : null;
}
