/**
 * Reglas deterministas para interpretar la evidencia de Inteligencia de
 * Compras. No consulta ni modifica DB y no sugiere cantidades.
 */

const POLITICA_INTELIGENCIA = Object.freeze({
  solicitudes_repetidas_30d: 3,
  contactos_minimos_30d: 2,
  ventas_relevantes_30d: 2,
  ventas_relevantes_90d: 4,
});

const ADVERTENCIAS_CONOCIDAS = new Set([
  "PEDIDOS_PROVEEDOR_NO_DISPONIBLES",
  "MINIMO_NO_CONFIGURADO",
  "MAXIMO_NO_CONFIGURADO",
  "SIN_HISTORIAL_COMPRAS",
  "PROVEEDOR_NO_IDENTIFICADO",
  "STOCK_NEGATIVO",
]);

function unicos(valores) {
  return [...new Set(valores.filter(Boolean))];
}

function resultado(clasificacion, razones, advertencias, calidadDatos) {
  return {
    clasificacion,
    razones: unicos(razones),
    advertencias: unicos(advertencias),
    calidad_datos: unicos(calidadDatos || []),
  };
}

function advertenciasBase(expediente) {
  const calidad = Array.isArray(expediente?.calidad_datos) ? expediente.calidad_datos : [];
  const advertencias = calidad.filter((codigo) => ADVERTENCIAS_CONOCIDAS.has(codigo));
  if (!advertencias.includes("PEDIDOS_PROVEEDOR_NO_DISPONIBLES")) {
    advertencias.push("PEDIDOS_PROVEEDOR_NO_DISPONIBLES");
  }
  return advertencias;
}

function clasificarEvidenciaCompra(expediente) {
  const calidad = Array.isArray(expediente?.calidad_datos) ? expediente.calidad_datos : [];
  const advertencias = advertenciasBase(expediente);
  const producto = expediente?.producto;
  const radar30 = expediente?.radar?.["30d"] || {};
  const ventas = expediente?.ventas || {};
  const inventario = expediente?.inventario || {};
  const solicitudes30 = Number(radar30.solicitudes) || 0;
  const contactos30 = Number(radar30.contactos_distintos) || 0;
  const ventas30 = Number(ventas.unidades_30d) || 0;
  const ventas90 = Number(ventas.unidades_90d) || 0;
  const demandaRepetida = solicitudes30 >= POLITICA_INTELIGENCIA.solicitudes_repetidas_30d
    && contactos30 >= POLITICA_INTELIGENCIA.contactos_minimos_30d;
  const ventasRecientes = ventas30 >= POLITICA_INTELIGENCIA.ventas_relevantes_30d
    || ventas90 >= POLITICA_INTELIGENCIA.ventas_relevantes_90d;
  const haySenalComercial = demandaRepetida || ventasRecientes;

  // Precedencia 1: sin identidad/stock local o sin señal comercial reciente.
  if (!producto || producto.producto_id == null) {
    return resultado("EVIDENCIA_INSUFICIENTE", ["PRODUCTO_NO_CATALOGADO"], advertencias, calidad);
  }
  if (!inventario.existencia_registrada || calidad.includes("SIN_FILA_EXISTENCIA")) {
    return resultado("EVIDENCIA_INSUFICIENTE", ["SIN_FILA_EXISTENCIA"], advertencias, calidad);
  }
  if (solicitudes30 === 0 && ventas30 === 0 && ventas90 === 0) {
    return resultado("EVIDENCIA_INSUFICIENTE", ["SIN_SENALES_COMERCIALES_RECIENTES"], advertencias, calidad);
  }

  const actual = Number(inventario.cantidad_actual);
  const minima = Number(inventario.cantidad_minima) || 0;
  const maxima = Number(inventario.cantidad_maxima) || 0;
  const minimoConfigurado = minima > 0;
  const stockCero = actual <= 0;
  const bajoMinimo = minimoConfigurado && actual < minima;
  const faltanteLocal = stockCero || bajoMinimo;
  const razonesStock = stockCero ? ["STOCK_LOCAL_CERO"] : bajoMinimo ? ["STOCK_LOCAL_BAJO_MINIMO"] : [];
  const razonesComerciales = [];
  if (demandaRepetida) razonesComerciales.push("DEMANDA_REPETIDA_30D");
  if (ventasRecientes) razonesComerciales.push("VENTAS_RECIENTES");

  if (producto.producto_activo === false) {
    return resultado("OBSERVAR", ["PRODUCTO_INACTIVO_CON_DEMANDA"], advertencias, calidad);
  }

  const entrante = Number(expediente?.traspasos?.cantidad_entrante_en_transito) || 0;
  if (entrante > 0) {
    advertencias.push("TRASPASO_ENTRANTE_EXISTENTE");
    if (!minimoConfigurado) {
      advertencias.push("MINIMO_NO_CONFIGURADO");
      return resultado("OBSERVAR", [...razonesStock, "TRASPASO_ENTRANTE_EXISTENTE", "MINIMO_NO_CONFIGURADO"], advertencias, calidad);
    }
    if (actual + entrante >= minima) {
      return resultado("OBSERVAR", [...razonesStock, "TRASPASO_ENTRANTE_CUBRE_MINIMO"], advertencias, calidad);
    }
  }

  const otras = Array.isArray(expediente?.otras_sucursales) ? expediente.otras_sucursales : [];
  const excedentesUtilizables = otras.filter((otra) => otra.existencia_registrada
    && otra.minimo_configurado === true
    && Number(otra.excedente_matematico_sobre_minimo) > 0);
  const stockConMinimoDesconocido = otras.filter((otra) => otra.existencia_registrada
    && Number(otra.cantidad_actual) > 0
    && otra.minimo_configurado !== true);

  // Precedencia 2: solución interna evidente antes que compra.
  if (faltanteLocal && haySenalComercial && excedentesUtilizables.length > 0) {
    return resultado("REVISAR_TRASPASO", [
      ...razonesStock, ...razonesComerciales, "STOCK_OTRA_SUCURSAL", "EXCEDENTE_OTRA_SUCURSAL",
    ], advertencias, calidad);
  }
  if (faltanteLocal && haySenalComercial && stockConMinimoDesconocido.length > 0) {
    advertencias.push("MINIMO_ORIGEN_NO_CONFIGURADO");
    return resultado("OBSERVAR", [
      ...razonesStock, ...razonesComerciales, "STOCK_OTRA_SUCURSAL", "MINIMO_NO_CONFIGURADO",
    ], advertencias, calidad);
  }

  // Precedencia 3: contradicciones fuertes.
  const motivos = radar30.motivos || {};
  if ((Number(motivos.SIN_EXISTENCIA) || 0) > 0 && actual > 0) {
    const razones = ["RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK"];
    if (maxima > 0 && actual > maxima) razones.push("STOCK_SOBRE_MAXIMO");
    return resultado("OBSERVAR", razones, advertencias, calidad);
  }
  if (actual > 0 && ventas30 === 0 && ventas90 === 0 && solicitudes30 > 0) {
    return resultado("OBSERVAR", ["DEMANDA_CON_STOCK_PERO_SIN_VENTAS"], advertencias, calidad);
  }
  if (solicitudes30 >= POLITICA_INTELIGENCIA.solicitudes_repetidas_30d
      && contactos30 <= 1 && !ventasRecientes) {
    return resultado("OBSERVAR", ["DEMANDA_CONCENTRADA_UN_CONTACTO"], advertencias, calidad);
  }

  // Precedencia 4: faltante local con evidencia comercial suficiente.
  if (faltanteLocal && haySenalComercial) {
    return resultado("REVISAR_COMPRA", [...razonesStock, ...razonesComerciales], advertencias, calidad);
  }

  // Precedencia 5: evidencia presente, pero sin regla de acción.
  const razones = [];
  if (!faltanteLocal) razones.push("STOCK_SUFICIENTE");
  if (!minimoConfigurado) razones.push("MINIMO_NO_CONFIGURADO");
  if (solicitudes30 > 0 && !demandaRepetida) razones.push("DEMANDA_BAJA");
  if (!ventasRecientes) razones.push("SIN_VENTAS_RECIENTES");
  if (ventas90 > 0 && ventas30 === 0) razones.push("VENTAS_ANTIGUAS");
  return resultado("OBSERVAR", razones.length ? razones : ["DEMANDA_BAJA"], advertencias, calidad);
}

function clasificarProductoNoManejado(productoLibre) {
  const radar30 = productoLibre?.radar_30d || {};
  const solicitudes = Number(radar30.solicitudes) || 0;
  const contactos = Number(radar30.contactos_distintos) || 0;
  if (solicitudes >= POLITICA_INTELIGENCIA.solicitudes_repetidas_30d
      && contactos >= POLITICA_INTELIGENCIA.contactos_minimos_30d) {
    return {
      estado: "EVALUAR_INCORPORACION",
      razones: ["DEMANDA_REPETIDA_30D", "PRODUCTO_NO_CATALOGADO"],
      advertencias: [],
    };
  }
  const razones = ["PRODUCTO_NO_CATALOGADO", "DEMANDA_BAJA"];
  if (solicitudes >= POLITICA_INTELIGENCIA.solicitudes_repetidas_30d && contactos <= 1) {
    razones.push("DEMANDA_CONCENTRADA_UN_CONTACTO");
  }
  return { estado: "OBSERVAR", razones, advertencias: [] };
}

module.exports = {
  POLITICA_INTELIGENCIA,
  clasificarEvidenciaCompra,
  clasificarProductoNoManejado,
};
