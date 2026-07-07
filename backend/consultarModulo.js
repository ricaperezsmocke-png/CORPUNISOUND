/**
 * consultarModulo.js — Herramienta de consulta que usa el Asistente de IA.
 * Aplica el alcance por sucursal: un usuario amarrado nunca obtiene datos de
 * otra tienda, aunque los pida en los filtros.
 */

const CAMPO_SUMA = { ventas: "total", venta_detalle: "subtotal", existencias: "cantidad_actual" };

// Tablas que tienen sucursal_id propio y por tanto se filtran directo.
const TABLAS_CON_SUCURSAL = ["ventas", "existencias", "vendedores", "cortes_caja", "clientes"];

function aplicarFiltros(datos, filtros) {
  let resultado = [...datos];
  Object.keys(filtros || {}).forEach((clave) => {
    const valor = filtros[clave];
    if (clave === "fecha_inicio") resultado = resultado.filter((d) => d.fecha && d.fecha >= valor);
    else if (clave === "fecha_fin") resultado = resultado.filter((d) => d.fecha && d.fecha <= valor);
    else if (resultado.length && resultado[0][clave] !== undefined) resultado = resultado.filter((d) => String(d[clave]) === String(valor));
  });
  return resultado;
}

function agruparYSumar(datos, campoAgrupar, campoSumar) {
  const grupos = {};
  datos.forEach((d) => {
    let clave = d[campoAgrupar];
    if (campoAgrupar === "mes" && d.fecha) clave = d.fecha.slice(0, 7);
    if (clave === undefined) return;
    grupos[clave] = (grupos[clave] || 0) + (Number(d[campoSumar]) || 0);
  });
  return Object.entries(grupos).map(([clave, total]) => ({ [campoAgrupar]: clave, [campoSumar]: total }));
}

function consultarModulo({ modulo, tabla, filtros, agrupar_por }, alcance, DB) {
  if (!DB[modulo]) throw new Error(`Módulo "${modulo}" no existe. Disponibles: ${Object.keys(DB).join(", ")}`);
  if (!DB[modulo][tabla]) throw new Error(`Tabla "${tabla}" no existe en "${modulo}". Disponibles: ${Object.keys(DB[modulo]).join(", ")}`);

  const filtrosEfectivos = { ...(filtros || {}) };
  const amarrado = alcance && !alcance.verTodas;

  // Amarrado: se fuerza su sucursal en tablas que la tengan, ignorando lo que pida.
  if (amarrado && TABLAS_CON_SUCURSAL.includes(tabla)) {
    filtrosEfectivos.sucursal_id = alcance.sucursalId;
  }

  let resultado = aplicarFiltros(DB[modulo][tabla], filtrosEfectivos);

  // venta_detalle no tiene sucursal_id: se cruza contra las ventas visibles.
  if (amarrado && tabla === "venta_detalle") {
    const ventasVisibles = new Set(
      DB.pos.ventas.filter((v) => Number(v.sucursal_id) === alcance.sucursalId).map((v) => v.id)
    );
    resultado = resultado.filter((d) => ventasVisibles.has(d.venta_id));
  }

  if (agrupar_por) resultado = agruparYSumar(resultado, agrupar_por, CAMPO_SUMA[tabla] || "total");
  return resultado;
}

module.exports = { consultarModulo };
