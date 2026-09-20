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

test("crear una demanda RECHAZA una clasificacion mandada a mano", () => {
  const DB = baseEscritura();
  // Antes devolvia 200 y la creaba ignorando el campo: quien consume la API
  // podia creer que su clasificacion quedo aceptada. Se rechaza, como el PATCH.
  assert.throws(
    () => crearDemanda(DB, datosDemanda({ necesidades: [{ familia: "Baterias", cantidad: 9 }] }), { usuarioId: 100, sucursalId: 1 }),
    /necesidades/,
  );
  assert.equal(DB.radar_demanda.registros.length, 0, "no se crea nada a medias");
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

/**
 * Hallazgo 1 de la revision de Codex (2026-09-16), el mas caro:
 * las senales de compra de Inteligencia contaban TODA demanda de los ultimos
 * 180 dias, canceladas incluidas. Tres cancelaciones del mismo producto
 * bastaban para que el sistema dijera "revisar compra". El plan exige que las
 * senales de compra consuman EXCLUSIVAMENTE la demanda pendiente.
 */
test("las senales de compra de Inteligencia ignoran las canceladas", () => {
  const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
  const DB = base([
    registro(1, { estado: "CANCELADA", cantidad: 3, nombre_contacto: "Ana", telefono_contacto: "9611111111" }),
    registro(2, { estado: "CANCELADA", cantidad: 3, nombre_contacto: "Beto", telefono_contacto: "9612222222" }),
    registro(3, { estado: "CANCELADA", cantidad: 3, nombre_contacto: "Cruz", telefono_contacto: "9613333333" }),
  ]);
  DB["catalogo-productos"] = { productos: [], proveedores: [] };
  const evidencia = obtenerEvidenciaCompras(DB, alcanceGlobal, { fecha_fin: "2026-08-31" });
  const solicitudes = evidencia.productos_no_manejados.reduce((total, item) => total + item.solicitudes, 0);
  assert.equal(solicitudes, 0, "una cancelada no es una oportunidad de compra");
  assert.equal(evidencia.productos_no_manejados.length, 0);
});

test("las senales de compra de Inteligencia tampoco cuentan las ya vendidas", () => {
  const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
  const DB = base([
    registro(1, { estado: "CONVERTIDA", cantidad: 4, nombre_contacto: "Ana", telefono_contacto: "9611111111" }),
    registro(2, { cantidad: 2, nombre_contacto: "Beto", telefono_contacto: "9612222222" }),
  ]);
  DB["catalogo-productos"] = { productos: [], proveedores: [] };
  const evidencia = obtenerEvidenciaCompras(DB, alcanceGlobal, { fecha_fin: "2026-08-31" });
  const cantidad = evidencia.productos_no_manejados.reduce((total, item) => total + item.cantidad_solicitada, 0);
  assert.equal(cantidad, 2, "solo la pendiente alimenta la compra");
});

/**
 * Hallazgo 4 de la revision de Codex (2026-09-16): una demanda cuya
 * fecha_registro ya viene como dia suelto ("2026-08-01") se corria al dia
 * anterior al filtrar el periodo, y desaparecia del primer dia del rango.
 * Un dia suelto YA es el dia de la tienda: pasarlo por zona horaria solo
 * puede correrlo.
 */
test("una demanda con fecha de dia suelto cuenta en su propio dia", () => {
  const resultado = analizar(
    [registro(1, { fecha_registro: "2026-08-01", cantidad: 3 })],
    { fecha_inicio: "2026-08-01", fecha_fin: "2026-08-01" },
  );
  assert.equal(resultado.resumen.total, 1, "la demanda del dia 1 no se puede perder");
  assert.equal(resultado.familias.familias[0].unidades_conocidas, 3);
});

test("una demanda con fecha de dia suelto no se adelanta al periodo anterior", () => {
  const resultado = analizar(
    [registro(1, { fecha_registro: "2026-07-31", cantidad: 3 })],
    { fecha_inicio: "2026-08-01", fecha_fin: "2026-08-31" },
  );
  assert.equal(resultado.resumen.total, 0, "la del 31 de julio no es de agosto");
});
