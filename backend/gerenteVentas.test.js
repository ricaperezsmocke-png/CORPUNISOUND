/**
 * gerenteVentas.test.js — El motor de objetivos y tareas de venta.
 *
 * Todo el módulo es JS puro (sin IA, sin red), así que se prueba entero.
 * Las cifras que salen de aquí las lee una vendedora para decidir su día: una
 * cuenta mal hecha es peor que no tener pantalla.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const {
  calcularProgreso, generarTareas, sincronizarTareas, listarTareas,
  cambiarEstadoTarea, fijarMeta, tablero, diasRestantesDelMes,
  nuevoEstadoTareasVenta, MAX_CLIENTES_SUGERIDOS,
} = require("./gerenteVentas");

/** Fecha local de la tienda para un instante dado. Las pruebas fijan el
 *  instante para no depender del día en que se corran. */
const AHORA = "2026-08-15T18:00:00.000Z"; // 15 de agosto, mediodía en Chiapas

function nuevoDB() {
  return {
    pos: {
      ventas: [],
      venta_detalle: [],
      vendedores: [
        { id: 1, nombre: "Ana López", sucursal_id: 1, meta_mensual: 50000 },
        { id: 2, nombre: "Carlos Ruiz", sucursal_id: 1, meta_mensual: 0 },
      ],
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      tareas_venta: nuevoEstadoTareasVenta(),
    },
    crm: { clientes: [], contactos_cliente: [] },
    "catalogo-productos": { productos: [], categorias: [], proveedores: [] },
  };
}

function venta(DB, { id, vendedor_id, total, fecha, estatus = "cerrada", cliente_id = null }) {
  DB.pos.ventas.push({ id, vendedor_id, total, fecha, estatus, cliente_id, sucursal_id: 1 });
}

function cliente(DB, { id, nombre, vendedor_asignado_id, ultimaCompra = null }) {
  DB.crm.clientes.push({ id, nombre, vendedor_asignado_id, sucursal_id: 1, estado: "cliente" });
  if (ultimaCompra) {
    const ventaId = 900 + id;
    venta(DB, { id: ventaId, vendedor_id: vendedor_asignado_id, total: 1000, fecha: ultimaCompra, cliente_id: id });
  }
}

// ---------- calcularProgreso ----------

test("calcularProgreso suma solo las ventas del vendedor, del mes en curso y cerradas", () => {
  const DB = nuevoDB();
  venta(DB, { id: 1, vendedor_id: 1, total: 10000, fecha: "2026-08-03" }); // cuenta
  venta(DB, { id: 2, vendedor_id: 1, total: 5000, fecha: "2026-08-15" });  // cuenta
  venta(DB, { id: 3, vendedor_id: 2, total: 9000, fecha: "2026-08-10" });  // otro vendedor
  venta(DB, { id: 4, vendedor_id: 1, total: 7000, fecha: "2026-07-31" });  // mes pasado
  venta(DB, { id: 5, vendedor_id: 1, total: 3000, fecha: "2026-08-12", estatus: "cancelada" });

  const p = calcularProgreso(DB, 1, AHORA);
  assert.strictEqual(p.vendido_mes, 15000);
  assert.strictEqual(p.meta, 50000);
  assert.strictEqual(p.porcentaje, 30);
  assert.strictEqual(p.faltante, 35000);
});

test("una venta CANCELADA no puede seguir contando para la meta", () => {
  // Si contara, una cajera podría inflar su meta capturando y cancelando.
  const DB = nuevoDB();
  venta(DB, { id: 1, vendedor_id: 1, total: 40000, fecha: "2026-08-10", estatus: "cancelada" });
  assert.strictEqual(calcularProgreso(DB, 1, AHORA).vendido_mes, 0);
});

test("sin meta asignada NO se muestra 0% ni se divide entre cero", () => {
  // Mostrar "0% de tu meta" a quien no tiene meta la haría ver como si no
  // hubiera vendido nada. La pantalla debe decir la verdad: no hay objetivo.
  const DB = nuevoDB();
  venta(DB, { id: 1, vendedor_id: 2, total: 12000, fecha: "2026-08-05" });
  const p = calcularProgreso(DB, 2, AHORA);
  assert.strictEqual(p.sin_meta, true);
  assert.strictEqual(p.porcentaje, null);
  assert.strictEqual(p.faltante, null);
  assert.strictEqual(p.vendido_mes, 12000, "lo vendido sí se cuenta, aunque no haya meta");
});

test("el mes se corta por la fecha LOCAL de la tienda, no por UTC", () => {
  // A las 18:00 UTC del 1 de agosto ya es 1 de agosto en Chiapas (mediodía),
  // pero a las 03:00 UTC del 1 de agosto todavía es 31 de julio allá. Las
  // ventas guardan la fecha local, así que el corte debe usar la misma.
  const DB = nuevoDB();
  venta(DB, { id: 1, vendedor_id: 1, total: 1000, fecha: "2026-08-01" });
  venta(DB, { id: 2, vendedor_id: 1, total: 2000, fecha: "2026-07-31" });
  const p = calcularProgreso(DB, 1, AHORA);
  assert.strictEqual(p.desde, "2026-08-01");
  assert.strictEqual(p.vendido_mes, 1000);
});

test("una venta con fecha futura del mismo mes no se cuenta antes de tiempo", () => {
  const DB = nuevoDB();
  venta(DB, { id: 1, vendedor_id: 1, total: 8000, fecha: "2026-08-28" }); // aún no llega
  assert.strictEqual(calcularProgreso(DB, 1, AHORA).vendido_mes, 0);
});

test("días restantes del mes cuenta el día de hoy", () => {
  assert.strictEqual(diasRestantesDelMes("2026-08-15"), 17); // 31 - 15 + 1
  assert.strictEqual(diasRestantesDelMes("2026-08-31"), 1, "el último día todavía cuenta");
  assert.strictEqual(diasRestantesDelMes("2026-02-01"), 28);
  assert.strictEqual(diasRestantesDelMes("2028-02-01"), 29, "2028 es bisiesto");
});

test("un vendedor que no existe da un error claro, no cifras en cero", () => {
  assert.throws(() => calcularProgreso(nuevoDB(), 99, AHORA), /Vendedor no encontrado/);
});

// ---------- generarTareas ----------

test("propone contactar a los clientes en riesgo e inactivos ASIGNADOS al vendedor", () => {
  const DB = nuevoDB();
  cliente(DB, { id: 1, nombre: "Juan", vendedor_asignado_id: 1, ultimaCompra: "2026-08-10" }); // activo
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" }); // en riesgo
  cliente(DB, { id: 3, nombre: "Pedro", vendedor_asignado_id: 1, ultimaCompra: "2026-01-05" }); // inactivo
  cliente(DB, { id: 4, nombre: "Rosa", vendedor_asignado_id: 2, ultimaCompra: "2026-01-05" }); // de otro vendedor

  const nombres = generarTareas(DB, 1)
    .filter((t) => t.tipo === "contactar_cliente")
    .map((t) => t.cliente_id);

  assert.ok(nombres.includes(2), "María está en riesgo y debe aparecer");
  assert.ok(nombres.includes(3), "Pedro está inactivo y debe aparecer");
  assert.ok(!nombres.includes(1), "Juan compró hace días: no hay nada que recuperar");
  assert.ok(!nombres.includes(4), "Rosa es de otro vendedor");
});

test('nunca propone contactar a "Público en General"', () => {
  const DB = nuevoDB();
  DB.crm.clientes.push({ id: 0, nombre: "Público en General", vendedor_asignado_id: 1, sucursal_id: 1 });
  const tareas = generarTareas(DB, 1).filter((t) => t.tipo === "contactar_cliente");
  assert.strictEqual(tareas.length, 0);
});

test("prioriza a los clientes que llevan MÁS tiempo sin comprar", () => {
  const DB = nuevoDB();
  // Seis en riesgo/inactivos, más que el tope: debe quedarse con los más viejos.
  cliente(DB, { id: 1, nombre: "C1", vendedor_asignado_id: 1, ultimaCompra: "2026-06-01" });
  cliente(DB, { id: 2, nombre: "C2", vendedor_asignado_id: 1, ultimaCompra: "2026-01-01" });
  cliente(DB, { id: 3, nombre: "C3", vendedor_asignado_id: 1, ultimaCompra: "2026-05-01" });
  cliente(DB, { id: 4, nombre: "C4", vendedor_asignado_id: 1, ultimaCompra: "2026-02-01" });
  cliente(DB, { id: 5, nombre: "C5", vendedor_asignado_id: 1, ultimaCompra: "2026-04-01" });
  cliente(DB, { id: 6, nombre: "C6", vendedor_asignado_id: 1, ultimaCompra: "2026-03-01" });

  const ids = generarTareas(DB, 1).filter((t) => t.tipo === "contactar_cliente").map((t) => t.cliente_id);
  assert.strictEqual(ids.length, MAX_CLIENTES_SUGERIDOS, "la lista se acota para que sea seguible");
  assert.strictEqual(ids[0], 2, "el más antiguo va primero");
  assert.ok(!ids.includes(1), "el más reciente de los seis queda fuera del tope");
});

test("un cliente asignado que NUNCA compró también se propone, pero al final", () => {
  const DB = nuevoDB();
  cliente(DB, { id: 1, nombre: "Nunca", vendedor_asignado_id: 1 });
  cliente(DB, { id: 2, nombre: "Viejo", vendedor_asignado_id: 1, ultimaCompra: "2026-01-01" });
  const ids = generarTareas(DB, 1).filter((t) => t.tipo === "contactar_cliente").map((t) => t.cliente_id);
  assert.deepStrictEqual(ids, [2, 1]);
});

test("sin clientes ni historial, no truena: simplemente no hay tareas", () => {
  assert.deepStrictEqual(generarTareas(nuevoDB(), 1), []);
});

test("sin historial para predecir demanda, las tareas de clientes SIGUEN saliendo", () => {
  // La demanda proyectada es un extra. El caso real es una tienda con productos
  // dados de alta pero sin suficiente historial de ventas: predecirDemanda
  // devuelve { error } producto por producto, y eso NO debe dejar a la vendedora
  // sin su lista de clientes, que es la parte que más vale.
  const DB = nuevoDB();
  DB["catalogo-productos"].productos = [
    { id: 1, nombre: "Guitarra", activo: true },
    { id: 2, nombre: "Teclado", activo: true },
  ];
  // No se siembra ni un venta_detalle: no hay de dónde proyectar nada.
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });

  const tareas = generarTareas(DB, 1);
  assert.ok(tareas.some((t) => t.tipo === "contactar_cliente"), "las de cliente no deben perderse");
  assert.ok(
    !tareas.some((t) => t.tipo === "empujar_producto"),
    "sin historial no se debe inventar una demanda proyectada",
  );
});

// ---------- sincronizarTareas: no duplicar ----------

test("abrir la pantalla dos veces NO duplica las tareas", () => {
  // Sin esto, cada visita agregaría otra vez "habla con María" y la lista
  // sería inservible en dos días.
  const DB = nuevoDB();
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });

  const primera = sincronizarTareas(DB, 1, AHORA);
  const segunda = sincronizarTareas(DB, 1, AHORA);

  assert.strictEqual(primera.length, segunda.length);
  assert.strictEqual(DB.pos.tareas_venta.tareas.length, primera.length);
});

test("una tarea DESCARTADA no vuelve a aparecer sola en la misma vuelta", () => {
  const DB = nuevoDB();
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });
  const [tarea] = sincronizarTareas(DB, 1, AHORA);
  cambiarEstadoTarea(DB, 1, tarea.id, "descartada", AHORA);

  const pendientes = listarTareas(DB, 1);
  assert.strictEqual(pendientes.length, 0, "la descartada no debe seguir pendiente");
});

test("los ids de tarea son únicos aunque se sincronice muchas veces", () => {
  const DB = nuevoDB();
  for (let i = 1; i <= 5; i++) {
    cliente(DB, { id: i, nombre: `C${i}`, vendedor_asignado_id: 1, ultimaCompra: "2026-01-0" + i });
  }
  sincronizarTareas(DB, 1, AHORA);
  sincronizarTareas(DB, 1, AHORA);
  const ids = DB.pos.tareas_venta.tareas.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, "hubo ids repetidos");
});

// ---------- cambiarEstadoTarea: el candado ----------

test("una vendedora NO puede cerrar la tarea de otra, aunque sepa el id", () => {
  // Mismo tipo de hueco que tuvo Apartados en julio: actuar sobre el registro
  // de alguien más pasando su folio. El guard vive DENTRO del módulo.
  const DB = nuevoDB();
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });
  const [ajena] = sincronizarTareas(DB, 1, AHORA);

  assert.throws(
    () => cambiarEstadoTarea(DB, 2, ajena.id, "hecha", AHORA),
    /Tarea no encontrada/,
    "y el mensaje no debe confirmar que la tarea de la otra existe",
  );
  assert.strictEqual(ajena.estado, "pendiente", "no debió tocarse");
});

test("marcar hecha una tarea la saca de pendientes y guarda cuándo", () => {
  const DB = nuevoDB();
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });
  const [t] = sincronizarTareas(DB, 1, AHORA);

  const cerrada = cambiarEstadoTarea(DB, 1, t.id, "hecha", AHORA);
  assert.strictEqual(cerrada.estado, "hecha");
  assert.strictEqual(cerrada.completada_en, AHORA);
  assert.strictEqual(listarTareas(DB, 1).length, 0);
  assert.strictEqual(listarTareas(DB, 1, "hecha").length, 1, "se conserva como bitácora");
});

test("no se puede cerrar dos veces la misma tarea", () => {
  const DB = nuevoDB();
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });
  const [t] = sincronizarTareas(DB, 1, AHORA);
  cambiarEstadoTarea(DB, 1, t.id, "hecha", AHORA);
  assert.throws(() => cambiarEstadoTarea(DB, 1, t.id, "descartada", AHORA), /ya estaba cerrada/);
});

test("un estado inventado se rechaza", () => {
  const DB = nuevoDB();
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });
  const [t] = sincronizarTareas(DB, 1, AHORA);
  assert.throws(() => cambiarEstadoTarea(DB, 1, t.id, "cancelada", AHORA), /inválido/i);
});

// ---------- fijarMeta ----------

test("fijar la meta cambia el objetivo del vendedor", () => {
  const DB = nuevoDB();
  fijarMeta(DB, 2, 75000);
  assert.strictEqual(calcularProgreso(DB, 2, AHORA).meta, 75000);
  assert.strictEqual(calcularProgreso(DB, 2, AHORA).sin_meta, false);
});

test("una meta negativa o basura se rechaza", () => {
  const DB = nuevoDB();
  assert.throws(() => fijarMeta(DB, 1, -100), /mayor o igual a cero/);
  assert.throws(() => fijarMeta(DB, 1, "mucho"), /número/);
});

test("fijar la meta en cero es válido: quita el objetivo", () => {
  const DB = nuevoDB();
  fijarMeta(DB, 1, 0);
  assert.strictEqual(calcularProgreso(DB, 1, AHORA).sin_meta, true);
});

// ---------- tablero ----------

test("el tablero trae progreso y tareas en una sola llamada", () => {
  const DB = nuevoDB();
  venta(DB, { id: 1, vendedor_id: 1, total: 20000, fecha: "2026-08-05" });
  cliente(DB, { id: 2, nombre: "María", vendedor_asignado_id: 1, ultimaCompra: "2026-07-01" });

  const t = tablero(DB, 1, AHORA);
  assert.strictEqual(t.vendedor_nombre, "Ana López");
  // 20000/50000 = 40%. La compra de María es de JULIO (por eso está en riesgo),
  // así que correctamente no suma al mes en curso.
  assert.strictEqual(t.porcentaje, 40);
  assert.strictEqual(t.vendido_mes, 20000);
  assert.ok(Array.isArray(t.tareas));
  assert.ok(t.tareas.length > 0);
});
