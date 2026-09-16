/**
 * Task 5 del plan 2026-09-15-radar-familias-solo-reglas.
 *
 * Aquí se comprueba que la proyección por familias entra en las consultas
 * reales y, sobre todo, que una demanda CANCELADA deja de inflar el número con
 * el que Victor decide qué comprar. El bloque `resumen` es la excepción
 * declarada: son las métricas operativas de conversión, que reportan las
 * canceladas a propósito y no se redefinen aquí.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { obtenerAnalisis, crearDemanda, actualizarDemanda } = require("./radarDemanda");

function registro(id, cambios = {}) {
  return {
    id, sucursal_id: 1, producto_id: null, producto_nombre_registrado: "",
    producto_sku_registrado: "", producto_buscado: "guitarra electroacustica",
    marca_solicitada: "", modelo_solicitado: "", variante_solicitada: "",
    categoria_solicitada: "", cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA",
    estado: "REGISTRADA", requiere_seguimiento: false, fecha_seguimiento: null,
    fecha_registro: "2026-08-10T18:00:00.000Z", cliente_id: null,
    nombre_contacto: "", telefono_contacto: "", venta_recuperada_id: null,
    ...cambios,
  };
}

function base(registros = []) {
  return {
    radar_demanda: { registros, seguimientos: [] },
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalon" }], ventas: [] },
  };
}

const alcanceGlobal = { verTodas: true, sucursalId: null };
const periodo = { fecha_inicio: "2026-08-01", fecha_fin: "2026-08-31" };
const analizar = (registros, filtros = periodo, alcance = alcanceGlobal) =>
  obtenerAnalisis(base(registros), alcance, filtros);

test("el analisis expone la proyeccion por familias", () => {
  const resultado = analizar([registro(1)]);
  assert.ok(resultado.familias, "falta el bloque familias");
  assert.equal(resultado.familias.universo, "HISTORICA");
  assert.ok(resultado.familias_pendientes, "falta el bloque familias_pendientes");
  assert.equal(resultado.familias_pendientes.universo, "PENDIENTE");
});

test("la familia agrupa dos marcas distintas de guitarra en un solo renglon", () => {
  const resultado = analizar([
    registro(1, { producto_buscado: "guitarra electroacustica Yamaha", cantidad: 5 }),
    registro(2, { producto_buscado: "guitarra electroacustica Fender", cantidad: 3 }),
  ]);
  assert.equal(resultado.familias.familias.length, 1);
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 8);
  assert.equal(resultado.familias.familias[0].solicitudes, 2);
});

test("una cancelada no cuenta en familias", () => {
  const resultado = analizar([registro(1), registro(2, { estado: "CANCELADA", cantidad: 99 })]);
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 1);
});

test("una no convertida SI cuenta en el historico y NO en pendientes", () => {
  const resultado = analizar([registro(1, { estado: "NO_CONVERTIDA", cantidad: 4 })]);
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 4);
  assert.equal(resultado.familias_pendientes.familias.length, 0);
});

test("una cancelada no entra en el ranking de productos", () => {
  const resultado = analizar([registro(1), registro(2, { estado: "CANCELADA" })]);
  const solicitudes = resultado.productos.reduce((total, item) => total + item.solicitudes, 0);
  assert.equal(solicitudes, 1);
});

test("una cancelada no entra en el conteo de motivos", () => {
  const resultado = analizar([
    registro(1, { motivo_no_venta: "SIN_EXISTENCIA" }),
    registro(2, { motivo_no_venta: "SIN_EXISTENCIA", estado: "CANCELADA" }),
  ]);
  const motivo = resultado.motivos.find((item) => item.motivo === "SIN_EXISTENCIA");
  assert.equal(motivo.cantidad, 1);
});

test("una cancelada no entra en el corte por sucursal", () => {
  const resultado = analizar([
    registro(1, { sucursal_id: 2 }),
    registro(2, { sucursal_id: 2, estado: "CANCELADA" }),
  ]);
  const sucursal = resultado.sucursales.find((item) => item.sucursal_id === 2);
  assert.equal(sucursal.demandas, 1);
});

test("una cancelada no entra en la evolucion diaria", () => {
  const resultado = analizar([
    registro(1, { cantidad: 2 }),
    registro(2, { cantidad: 50, estado: "CANCELADA" }),
  ]);
  const dia = resultado.evolucion.find((item) => item.demandas > 0);
  assert.equal(dia.demandas, 1);
  assert.equal(dia.cantidad_solicitada, 2);
});

test("una cancelada no mueve la comparacion contra el periodo anterior", () => {
  const conCancelada = analizar([registro(1), registro(2, { estado: "CANCELADA" })]);
  const sinCancelada = analizar([registro(1)]);
  assert.deepEqual(conCancelada.comparaciones, sinCancelada.comparaciones);
});

test("el resumen operativo si sigue reportando las canceladas", () => {
  const resultado = analizar([registro(1), registro(2, { estado: "CANCELADA" })]);
  assert.equal(resultado.resumen.canceladas, 1);
  assert.equal(resultado.resumen.total, 2);
});

test("un estado desconocido no cuenta como demanda viva y queda reportado", () => {
  const resultado = analizar([registro(1), registro(2, { estado: "LO_QUE_SEA", cantidad: 77 })]);
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 1);
  const aviso = resultado.familias.diagnosticos.find((item) => item.motivo === "ESTADO_NO_CLASIFICABLE");
  assert.ok(aviso, "el estado invalido debe quedar en diagnosticos");
});

test("una demanda con texto corrupto no tumba la consulta completa", () => {
  const roto = registro(2, { producto_buscado: { raro: true }, cantidad: "x" });
  const resultado = analizar([registro(1), roto]);
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 1);
  assert.ok(resultado.productos.length >= 1);
});

test("una marca fuera del diccionario se conserva tal como la escribio el vendedor", () => {
  const resultado = analizar([registro(1, { marca_solicitada: "Takamine", cantidad: 2 })]);
  const familia = resultado.familias.familias[0];
  const marca = familia.marcas.find((item) => item.etiqueta === "Takamine");
  assert.ok(marca, "la marca debe conservarse");
  assert.equal(marca.unidades_conocidas, 2);
});

test("el analisis no modifica la base", () => {
  const registros = [registro(1), registro(2, { estado: "CANCELADA" })];
  const DB = base(registros);
  const antes = JSON.stringify(DB);
  obtenerAnalisis(DB, alcanceGlobal, periodo);
  assert.equal(JSON.stringify(DB), antes);
});

// SOLO REGLAS: nadie clasifica a mano. Si alguien manda una clasificación por
// HTTP, no se guarda y no manda sobre las reglas.
function baseEscritura() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }], vendedores: [], ventas: [] },
    admin: { usuarios: [{ id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: null, activo: true }] },
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }] },
    "catalogo-productos": { productos: [] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const datosDemanda = (extra = {}) => ({
  producto_buscado: "guitarra electroacustica", cantidad: 2,
  motivo_no_venta: "SIN_EXISTENCIA", intencion_compra: false,
  consentimiento_aviso: false, ...extra,
});

test("crear una demanda no guarda una clasificacion mandada a mano", () => {
  const DB = baseEscritura();
  const creada = crearDemanda(
    DB,
    datosDemanda({ necesidades: [{ familia: "Baterias", cantidad: 9 }] }),
    { usuarioId: 100, sucursalId: 1 },
  );
  assert.equal(creada.necesidades, undefined);
  assert.equal(DB.radar_demanda.registros[0].necesidades, undefined);
});

test("actualizar una demanda RECHAZA una clasificacion mandada a mano", () => {
  const DB = baseEscritura();
  crearDemanda(DB, datosDemanda(), { usuarioId: 100, sucursalId: 1 });
  const id = DB.radar_demanda.registros[0].id;
  // Rechaza en vez de ignorar: quien lo intente se entera, y nada queda guardado.
  assert.throws(
    () => actualizarDemanda(DB, id, { necesidades: [{ familia: "Baterias", cantidad: 9 }] }, { verTodas: false, sucursalId: 1 }),
    /necesidades/,
  );
  assert.equal(DB.radar_demanda.registros[0].necesidades, undefined);
});

test("una clasificacion guardada de antes no manda sobre las reglas", () => {
  const resultado = analizar([
    registro(1, { cantidad: 2, necesidades: [{ familia: "Baterias", tipo: "Acustica", cantidad: 40 }] }),
  ]);
  const familia = resultado.familias.familias[0];
  assert.equal(familia.etiqueta, "Guitarras");
  assert.equal(familia.unidades_conocidas, 2);
});

test("las familias respetan el alcance por sucursal", () => {
  const resultado = analizar(
    [registro(1, { sucursal_id: 1, cantidad: 3 }), registro(2, { sucursal_id: 2, cantidad: 9 })],
    periodo,
    { verTodas: false, sucursalId: 1 },
  );
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 3);
});

// La pantalla de compras solo puede ver la oportunidad viva.
test("la inteligencia de compras entrega familias del universo PENDIENTE", () => {
  const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
  const DB = base([
    registro(1, { cantidad: 4, fecha_registro: "2026-08-10T18:00:00.000Z" }),
    registro(2, { cantidad: 9, estado: "CONVERTIDA", fecha_registro: "2026-08-10T18:00:00.000Z" }),
    registro(3, { cantidad: 7, estado: "CANCELADA", fecha_registro: "2026-08-10T18:00:00.000Z" }),
  ]);
  DB["catalogo-productos"] = { productos: [], proveedores: [] };
  const evidencia = obtenerEvidenciaCompras(DB, alcanceGlobal, { fecha_fin: "2026-08-31" });
  assert.equal(evidencia.familias.universo, "PENDIENTE");
  assert.equal(evidencia.familias.familias[0].unidades_conocidas, 4);
});
