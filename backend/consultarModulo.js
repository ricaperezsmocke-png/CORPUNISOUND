/**
 * consultarModulo.js — Herramienta de consulta que usa el Asistente de IA.
 * Aplica el alcance por sucursal: un usuario amarrado nunca obtiene datos de
 * otra tienda, aunque los pida en los filtros.
 */

const CAMPO_SUMA = { ventas: "total", venta_detalle: "subtotal", existencias: "cantidad_actual" };

/**
 * ¿Las filas de esta tabla cargan su propio campo sucursal_id? Antes había
 * una lista fija a mano (TABLAS_CON_SUCURSAL) que se quedaba corta cada vez
 * que se agregaba una tabla nueva con este campo (p. ej. se olvidó incluir
 * inventario.movimientos_inventario) — un usuario amarrado podía pedirle
 * esa tabla al asistente de IA y ver el historial de TODAS las sucursales.
 * En vez de mantener esa lista, se inspecciona el dato real.
 *
 * Tabla vacía → no hay fila que inspeccionar. Por seguridad (nunca menos
 * restrictivo para un usuario amarrado), se asume que sí tiene sucursal_id:
 * intentar filtrar por sucursal_id sobre un arreglo vacío es inofensivo,
 * así que el valor "fail-safe" es forzar el intento de filtro.
 */
function tablaTieneSucursal(datos) {
  if (!Array.isArray(datos) || datos.length === 0) return true;
  return Object.prototype.hasOwnProperty.call(datos[0], "sucursal_id");
}

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

/**
 * Campos que NUNCA salen por esta herramienta, pase quien pase.
 *
 * El Asistente de IA acepta cualquier nombre de tabla y devuelve las filas
 * CRUDAS al navegador (server.js las incluye en `consultas`), así que es una
 * puerta lateral a cualquier dato del DB. La meta mensual de una vendedora es
 * información de desempeño: se cerró su salida por `GET /api/vendedores`, y
 * dejarla salir por aquí sería el mismo dato para la misma audiencia — el rol
 * Cajero tiene `usar_asistente_ia`, así que bastaba con pedirle al asistente
 * "dame la tabla vendedores" para leer las metas de las compañeras.
 *
 * Se recorta SIEMPRE, no según permisos: el asistente responde sobre ventas,
 * inventario y clientes, y nunca ha necesitado las metas. Falla cerrado. Si
 * algún día hiciera falta, se abre a propósito y con su propio guard.
 */
const CAMPOS_OCULTOS_POR_TABLA = {
  vendedores: ["meta_mensual"],
};

/**
 * Tablas que esta herramienta no puede leer porque no son arreglos de filas.
 * `tareas_venta` es `{tareas, ultimo_id}`: al iterarla reventaba con
 * "datos is not iterable". El try/catch de la ruta lo contenía, pero la tabla
 * aparecía en la lista de "Disponibles" de cada mensaje de error, así que el
 * modelo la intentaba una y otra vez.
 */
const TABLAS_NO_CONSULTABLES = new Set(["tareas_venta"]);

function ocultarCamposSensibles(filas, tabla) {
  const ocultos = CAMPOS_OCULTOS_POR_TABLA[tabla];
  if (!ocultos || !Array.isArray(filas)) return filas;
  return filas.map((fila) => {
    if (!fila || typeof fila !== "object") return fila;
    const copia = { ...fila };
    for (const campo of ocultos) delete copia[campo];
    return copia;
  });
}

function consultarModulo({ modulo, tabla, filtros, agrupar_por }, alcance, DB) {
  if (!DB[modulo]) throw new Error(`Módulo "${modulo}" no existe. Disponibles: ${Object.keys(DB).join(", ")}`);
  const tablasVisibles = Object.keys(DB[modulo]).filter((t) => !TABLAS_NO_CONSULTABLES.has(t));
  if (TABLAS_NO_CONSULTABLES.has(tabla) || !DB[modulo][tabla]) {
    throw new Error(`Tabla "${tabla}" no existe en "${modulo}". Disponibles: ${tablasVisibles.join(", ")}`);
  }

  const filtrosEfectivos = { ...(filtros || {}) };
  const amarrado = alcance && !alcance.verTodas;

  // Amarrado: se fuerza su sucursal en cualquier tabla cuyas filas la tengan,
  // ignorando lo que pida. venta_detalle no tiene sucursal_id propio, así
  // que tablaTieneSucursal() ya la excluye sola (se filtra más abajo, por join).
  if (amarrado && tablaTieneSucursal(DB[modulo][tabla])) {
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
  // El recorte va al final, después de filtrar y agrupar: agrupar por un campo
  // oculto no devuelve nada de todos modos, y así ninguna salida lo lleva.
  return ocultarCamposSensibles(resultado, tabla);
}

module.exports = { consultarModulo, CAMPOS_OCULTOS_POR_TABLA, TABLAS_NO_CONSULTABLES };
