const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  POLITICA_INTELIGENCIA,
  clasificarEvidenciaCompra,
  clasificarProductoNoManejado,
} = require("./radarDemandaReglas");
const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");

function expediente(cambios = {}) {
  const base = {
    producto: { producto_id: 10, sku: "P-10", nombre: "Producto", producto_activo: true },
    sucursal: { sucursal_id: 1, sucursal_nombre: "Ocosingo" },
    radar: {
      "30d": { solicitudes: 3, cantidad_solicitada: 3, contactos_distintos: 2, motivos: { PRECIO: 3 } },
    },
    ventas: { unidades_30d: 0, unidades_90d: 0 },
    inventario: { existencia_registrada: true, cantidad_actual: 0, cantidad_minima: 5, cantidad_maxima: 20 },
    otras_sucursales: [],
    traspasos: { cantidad_entrante_en_transito: 0, numero_traspasos_entrantes: 0 },
    compras_historicas: { ultima_recepcion_fecha: null },
    proveedores: { proveedor_configurado_id: null, ultimo_proveedor_recepcion_id: null },
    calidad_datos: ["SIN_HISTORIAL_COMPRAS", "PROVEEDOR_NO_IDENTIFICADO", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"],
  };
  return {
    ...base, ...cambios,
    producto: Object.prototype.hasOwnProperty.call(cambios, "producto") && cambios.producto === null
      ? null : { ...base.producto, ...(cambios.producto || {}) },
    radar: { ...base.radar, ...(cambios.radar || {}) },
    ventas: { ...base.ventas, ...(cambios.ventas || {}) },
    inventario: { ...base.inventario, ...(cambios.inventario || {}) },
    traspasos: { ...base.traspasos, ...(cambios.traspasos || {}) },
  };
}

test("política inicial está centralizada con los umbrales aprobados", () => {
  assert.deepEqual(POLITICA_INTELIGENCIA, {
    solicitudes_repetidas_30d: 3,
    contactos_minimos_30d: 2,
    ventas_relevantes_30d: 2,
    ventas_relevantes_90d: 4,
  });
  assert.equal(Object.isFrozen(POLITICA_INTELIGENCIA), true);
});

test("evidencia insuficiente sin producto catalogado", () => {
  const salida = clasificarEvidenciaCompra(expediente({ producto: null }));
  assert.deepEqual(salida.razones, ["PRODUCTO_NO_CATALOGADO"]);
  assert.equal(salida.clasificacion, "EVIDENCIA_INSUFICIENTE");
});

test("evidencia insuficiente sin fila de inventario", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    inventario: { existencia_registrada: false, cantidad_actual: null },
    calidad_datos: ["SIN_FILA_EXISTENCIA", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"],
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["EVIDENCIA_INSUFICIENTE", ["SIN_FILA_EXISTENCIA"]]);
});

test("evidencia insuficiente cuando no hay señales recientes", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    radar: { "30d": { solicitudes: 0, contactos_distintos: 0, motivos: {} } },
    ventas: { unidades_30d: 0, unidades_90d: 0 },
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["EVIDENCIA_INSUFICIENTE", ["SIN_SENALES_COMERCIALES_RECIENTES"]]);
});

test("revisar traspaso exige excedente real sobre mínimo configurado", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    otras_sucursales: [{ existencia_registrada: true, cantidad_actual: 8, cantidad_minima: 3, minimo_configurado: true, excedente_matematico_sobre_minimo: 5 }],
  }));
  assert.deepEqual(salida, {
    clasificacion: "REVISAR_TRASPASO",
    razones: ["STOCK_LOCAL_CERO", "DEMANDA_REPETIDA_30D", "STOCK_OTRA_SUCURSAL", "EXCEDENTE_OTRA_SUCURSAL"],
    advertencias: ["SIN_HISTORIAL_COMPRAS", "PROVEEDOR_NO_IDENTIFICADO", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"],
    calidad_datos: ["SIN_HISTORIAL_COMPRAS", "PROVEEDOR_NO_IDENTIFICADO", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"],
  });
});

test("mínimo de origen no configurado evita revisar traspaso", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    otras_sucursales: [{ existencia_registrada: true, cantidad_actual: 8, cantidad_minima: 0, minimo_configurado: false, excedente_matematico_sobre_minimo: 8 }],
  }));
  assert.equal(salida.clasificacion, "OBSERVAR");
  assert.ok(salida.razones.includes("STOCK_OTRA_SUCURSAL"));
  assert.ok(salida.advertencias.includes("MINIMO_ORIGEN_NO_CONFIGURADO"));
});

test("traspaso entrante que cubre mínimo obliga a observar", () => {
  const salida = clasificarEvidenciaCompra(expediente({ traspasos: { cantidad_entrante_en_transito: 5 } }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["OBSERVAR", ["STOCK_LOCAL_CERO", "TRASPASO_ENTRANTE_CUBRE_MINIMO"]]);
  assert.ok(salida.advertencias.includes("TRASPASO_ENTRANTE_EXISTENTE"));
});

test("traspaso entrante con mínimo desconocido obliga a observar", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    inventario: { cantidad_actual: 0, cantidad_minima: 0 },
    traspasos: { cantidad_entrante_en_transito: 2 },
  }));
  assert.equal(salida.clasificacion, "OBSERVAR");
  assert.ok(salida.razones.includes("MINIMO_NO_CONFIGURADO"));
  assert.ok(salida.advertencias.includes("MINIMO_NO_CONFIGURADO"));
});

test("traspaso entrante insuficiente no oculta revisión de compra", () => {
  const salida = clasificarEvidenciaCompra(expediente({ traspasos: { cantidad_entrante_en_transito: 2 } }));
  assert.equal(salida.clasificacion, "REVISAR_COMPRA");
  assert.ok(salida.advertencias.includes("TRASPASO_ENTRANTE_EXISTENTE"));
});

test("demanda repetida activa revisar compra sin stock alternativo", () => {
  const salida = clasificarEvidenciaCompra(expediente());
  assert.deepEqual([salida.clasificacion, salida.razones], ["REVISAR_COMPRA", ["STOCK_LOCAL_CERO", "DEMANDA_REPETIDA_30D"]]);
});

test("dos unidades vendidas en 30d activan evidencia comercial", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    radar: { "30d": { solicitudes: 0, contactos_distintos: 0, motivos: {} } },
    ventas: { unidades_30d: 2, unidades_90d: 2 },
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["REVISAR_COMPRA", ["STOCK_LOCAL_CERO", "VENTAS_RECIENTES"]]);
});

test("cuatro unidades vendidas en 90d activan evidencia comercial", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    radar: { "30d": { solicitudes: 0, contactos_distintos: 0, motivos: {} } },
    ventas: { unidades_30d: 0, unidades_90d: 4 },
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["REVISAR_COMPRA", ["STOCK_LOCAL_CERO", "VENTAS_RECIENTES"]]);
});

test("demanda concentrada en un contacto no activa repetida", () => {
  const salida = clasificarEvidenciaCompra(expediente({ radar: { "30d": { solicitudes: 5, contactos_distintos: 1, motivos: { PRECIO: 5 } } } }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["OBSERVAR", ["DEMANDA_CONCENTRADA_UN_CONTACTO"]]);
});

test("Radar sin existencia pero stock positivo es contradicción", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    radar: { "30d": { solicitudes: 3, contactos_distintos: 2, motivos: { SIN_EXISTENCIA: 2, PRECIO: 1 } } },
    inventario: { cantidad_actual: 2, cantidad_minima: 5, cantidad_maxima: 20 },
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["OBSERVAR", ["RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK"]]);
});

test("stock sobre máximo agrega razón a contradicción Radar", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    radar: { "30d": { solicitudes: 3, contactos_distintos: 2, motivos: { SIN_EXISTENCIA: 3 } } },
    inventario: { cantidad_actual: 25, cantidad_minima: 5, cantidad_maxima: 20 },
  }));
  assert.deepEqual(salida.razones, ["RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK", "STOCK_SOBRE_MAXIMO"]);
});

test("demanda con stock pero cero ventas es contradicción", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    inventario: { cantidad_actual: 10, cantidad_minima: 5, cantidad_maxima: 20 },
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["OBSERVAR", ["DEMANDA_CON_STOCK_PERO_SIN_VENTAS"]]);
});

test("producto inactivo nunca revisa compra ni traspaso", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    producto: { producto_activo: false },
    otras_sucursales: [{ existencia_registrada: true, minimo_configurado: true, excedente_matematico_sobre_minimo: 8 }],
  }));
  assert.deepEqual([salida.clasificacion, salida.razones], ["OBSERVAR", ["PRODUCTO_INACTIVO_CON_DEMANDA"]]);
});

test("bajo mínimo utiliza razón específica", () => {
  const salida = clasificarEvidenciaCompra(expediente({ inventario: { cantidad_actual: 2, cantidad_minima: 5 }, ventas: { unidades_30d: 2, unidades_90d: 2 } }));
  assert.equal(salida.clasificacion, "REVISAR_COMPRA");
  assert.ok(salida.razones.includes("STOCK_LOCAL_BAJO_MINIMO"));
});

test("stock positivo con mínimo no configurado queda en observar", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    inventario: { cantidad_actual: 2, cantidad_minima: 0 },
    radar: { "30d": { solicitudes: 1, contactos_distintos: 1, motivos: { PRECIO: 1 } } },
    ventas: { unidades_30d: 1, unidades_90d: 1 },
    calidad_datos: ["MINIMO_NO_CONFIGURADO"],
  }));
  assert.equal(salida.clasificacion, "OBSERVAR");
  assert.ok(salida.razones.includes("MINIMO_NO_CONFIGURADO"));
});

test("falta de proveedor, historial y pedidos son advertencias, no bloqueo", () => {
  const salida = clasificarEvidenciaCompra(expediente());
  assert.equal(salida.clasificacion, "REVISAR_COMPRA");
  assert.deepEqual(salida.advertencias, ["SIN_HISTORIAL_COMPRAS", "PROVEEDOR_NO_IDENTIFICADO", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"]);
});

test("stock negativo se conserva como advertencia", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    inventario: { cantidad_actual: -2 },
    calidad_datos: ["STOCK_NEGATIVO", "PEDIDOS_PROVEEDOR_NO_DISPONIBLES"],
  }));
  assert.equal(salida.clasificacion, "REVISAR_COMPRA");
  assert.ok(salida.advertencias.includes("STOCK_NEGATIVO"));
});

test("precedencia traspaso gana a compra", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    ventas: { unidades_30d: 10, unidades_90d: 20 },
    otras_sucursales: [{ existencia_registrada: true, minimo_configurado: true, excedente_matematico_sobre_minimo: 1 }],
  }));
  assert.equal(salida.clasificacion, "REVISAR_TRASPASO");
  assert.ok(salida.razones.includes("VENTAS_RECIENTES"));
});

test("contradicción gana a revisar compra", () => {
  const salida = clasificarEvidenciaCompra(expediente({
    inventario: { cantidad_actual: 1, cantidad_minima: 5 },
    radar: { "30d": { solicitudes: 4, contactos_distintos: 3, motivos: { SIN_EXISTENCIA: 4 } } },
  }));
  assert.equal(salida.clasificacion, "OBSERVAR");
  assert.deepEqual(salida.razones, ["RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK"]);
});

test("producto libre repetido evalúa incorporación y nunca compra", () => {
  const salida = clasificarProductoNoManejado({ radar_30d: { solicitudes: 3, contactos_distintos: 2 } });
  assert.deepEqual(salida, { estado: "EVALUAR_INCORPORACION", razones: ["DEMANDA_REPETIDA_30D", "PRODUCTO_NO_CATALOGADO"], advertencias: [] });
  assert.doesNotMatch(JSON.stringify(salida), /REVISAR_COMPRA/);
});

test("producto libre con evidencia baja queda en observar", () => {
  const salida = clasificarProductoNoManejado({ radar_30d: { solicitudes: 2, contactos_distintos: 2 } });
  assert.deepEqual(salida, { estado: "OBSERVAR", razones: ["PRODUCTO_NO_CATALOGADO", "DEMANDA_BAJA"], advertencias: [] });
});

test("contratos de reglas no contienen score, prioridad ni confianza", () => {
  const salidas = [clasificarEvidenciaCompra(expediente()), clasificarProductoNoManejado({ radar_30d: {} })];
  assert.doesNotMatch(JSON.stringify(salidas), /score|prioridad|confidence|cantidad_sugerida/);
});

test("clasificación no modifica expediente", () => {
  const entrada = expediente();
  const antes = structuredClone(entrada);
  clasificarEvidenciaCompra(entrada);
  assert.deepStrictEqual(entrada, antes);
});

function DBIntegracion() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }], ventas: [], venta_detalle: [] },
    inventario: {
      existencias: [
        { producto_id: 10, sucursal_id: 1, cantidad_actual: 0, cantidad_minima: 5, cantidad_maxima: 20 },
        { producto_id: 10, sucursal_id: 2, cantidad_actual: 10, cantidad_minima: 2, cantidad_maxima: 20 },
      ], compras: [], compra_detalle: [], traspasos: [],
    },
    "catalogo-productos": { productos: [{ id: 10, sku: "P10", nombre: "Producto", activo: true }], proveedores: [] },
    radar_demanda: { registros: [1, 2, 3].flatMap((sucursalId) => [1, 2, 3].map((n) => ({
      id: sucursalId * 10 + n, producto_id: 10, sucursal_id: sucursalId > 2 ? 2 : sucursalId,
      cantidad: 1, fecha_registro: "2026-08-20T12:00:00Z", cliente_id: n,
      telefono_contacto: "", nombre_contacto: "", motivo_no_venta: "PRECIO",
    }))).filter((r) => r.sucursal_id <= 2), seguimientos: [] },
  };
}

test("alcance limitado no usa stock de otra sucursal", () => {
  const DB = DBIntegracion();
  const evidencia = obtenerEvidenciaCompras(DB, { verTodas: false, sucursalId: 1 }, { fecha_fin: "2026-08-20" });
  assert.deepEqual(evidencia.productos[0].otras_sucursales, []);
  assert.equal(clasificarEvidenciaCompra(evidencia.productos[0]).clasificacion, "REVISAR_COMPRA");
});

test("alcance global puede evaluar stock autorizado de otra sucursal", () => {
  const DB = DBIntegracion();
  const evidencia = obtenerEvidenciaCompras(DB, { verTodas: true, sucursalIds: [1, 2] }, { fecha_fin: "2026-08-20" });
  const sucursal1 = evidencia.productos.find((x) => x.sucursal.sucursal_id === 1);
  assert.equal(clasificarEvidenciaCompra(sucursal1).clasificacion, "REVISAR_TRASPASO");
});

test("integración evidencia y reglas mantiene DB inmutable", () => {
  const DB = DBIntegracion();
  const antes = structuredClone(DB);
  const evidencia = obtenerEvidenciaCompras(DB, { verTodas: true }, { fecha_fin: "2026-08-20" });
  evidencia.productos.map(clasificarEvidenciaCompra);
  assert.deepStrictEqual(DB, antes);
});
