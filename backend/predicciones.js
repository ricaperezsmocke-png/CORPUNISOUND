/**
 * predicciones.js — Modelo estadístico de estacionalidad y demanda.
 *
 * No es un LLM ni se "entrena" como una IA de lenguaje: es descomposición
 * clásica de series de tiempo (tendencia + índice estacional por mes),
 * calculado directamente sobre tu historial real de ventas.
 *
 * Cuantos más meses de historial real tengas cargados, más confiable
 * es la predicción — con pocos meses, el resultado es solo orientativo.
 */

function obtenerVentasMensuales(DB, { producto_id, categoria_id } = {}) {
  const ventas = DB.pos.ventas;
  const detalle = DB.pos.venta_detalle;
  const productos = DB["catalogo-productos"].productos;
  const historial = DB.pos.historial_ventas_mensual || [];

  const fechaPorVenta = {};
  ventas.forEach((v) => { fechaPorVenta[v.id] = v.fecha; });

  const infoPorProducto = {};
  productos.forEach((p) => { infoPorProducto[p.id] = p; });

  const porMes = {};
  detalle.forEach((d) => {
    const fecha = fechaPorVenta[d.venta_id];
    const prod = infoPorProducto[d.producto_id];
    if (!fecha || !prod) return;
    if (producto_id && prod.id !== Number(producto_id)) return;
    if (categoria_id && prod.categoria_id !== Number(categoria_id)) return;
    const mes = fecha.slice(0, 7); // "YYYY-MM"
    porMes[mes] = (porMes[mes] || 0) + Number(d.cantidad);
  });

  // Historial importado de SICAR (backend/historialVentas.js) - ya viene
  // agregado por mes, se suma directamente sin pasar por venta_detalle.
  // Nunca toca DB.pos.ventas/venta_detalle - ver spec 2026-07-15.
  historial.forEach((h) => {
    const prod = infoPorProducto[h.producto_id];
    if (!prod) return;
    if (producto_id && prod.id !== Number(producto_id)) return;
    if (categoria_id && prod.categoria_id !== Number(categoria_id)) return;
    porMes[h.periodo] = (porMes[h.periodo] || 0) + Number(h.cantidad);
  });

  return porMes;
}

function regresionLineal(puntos) {
  const n = puntos.length;
  const sumX = puntos.reduce((a, [x]) => a + x, 0);
  const sumY = puntos.reduce((a, [, y]) => a + y, 0);
  const sumXY = puntos.reduce((a, [x, y]) => a + x * y, 0);
  const sumXX = puntos.reduce((a, [x]) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX || 1;
  const pendiente = (n * sumXY - sumX * sumY) / denom;
  const intercepto = (sumY - pendiente * sumX) / n;
  return { pendiente, intercepto };
}

function predecirDemanda(DB, { producto_id, categoria_id, meses_adelante = 3 } = {}) {
  const porMes = obtenerVentasMensuales(DB, { producto_id, categoria_id });
  const mesesOrdenados = Object.keys(porMes).sort();

  if (mesesOrdenados.length === 0) {
    return { error: "No hay historial de ventas para ese producto/categoría" };
  }

  const promedioGeneral = mesesOrdenados.reduce((a, m) => a + porMes[m], 0) / mesesOrdenados.length;

  // Índice estacional: qué tan por encima/debajo del promedio vende cada mes calendario (1-12)
  const sumaPorMesCal = {};
  const conteoPorMesCal = {};
  mesesOrdenados.forEach((m) => {
    const mesCal = Number(m.slice(5, 7));
    sumaPorMesCal[mesCal] = (sumaPorMesCal[mesCal] || 0) + porMes[m];
    conteoPorMesCal[mesCal] = (conteoPorMesCal[mesCal] || 0) + 1;
  });
  const indiceEstacional = {};
  Object.keys(sumaPorMesCal).forEach((mesCal) => {
    const promedioMes = sumaPorMesCal[mesCal] / conteoPorMesCal[mesCal];
    indiceEstacional[mesCal] = promedioGeneral > 0 ? promedioMes / promedioGeneral : 1;
  });

  // Tendencia lineal sobre la serie mensual
  const puntos = mesesOrdenados.map((m, i) => [i, porMes[m]]);
  const { pendiente, intercepto } = regresionLineal(puntos);

  const prediccion = [];
  const ultimaFecha = new Date(`${mesesOrdenados[mesesOrdenados.length - 1]}-01T00:00:00`);
  for (let i = 1; i <= meses_adelante; i++) {
    const idx = puntos.length - 1 + i;
    const fecha = new Date(ultimaFecha);
    fecha.setMonth(fecha.getMonth() + i);
    const mesCal = fecha.getMonth() + 1;
    const periodo = `${fecha.getFullYear()}-${String(mesCal).padStart(2, "0")}`;
    const base = Math.max(0, pendiente * idx + intercepto);
    const factor = indiceEstacional[mesCal] || 1;
    prediccion.push({ periodo, cantidad_estimada: Math.round(base * factor * 10) / 10 });
  }

  const mesesDeHistorial = mesesOrdenados.length;
  const confianza = mesesDeHistorial >= 12 ? "alta" : mesesDeHistorial >= 6 ? "media" : "baja";

  return {
    historico: mesesOrdenados.map((m) => ({ periodo: m, cantidad: porMes[m] })),
    prediccion,
    confianza,
    meses_de_historial: mesesDeHistorial,
    nota:
      mesesDeHistorial < 6
        ? `Solo hay ${mesesDeHistorial} mes(es) de historial real cargado. Se recomiendan al menos 12 meses para una predicción de estacionalidad confiable — por ahora esto es una proyección preliminar.`
        : undefined,
  };
}

module.exports = { predecirDemanda };
