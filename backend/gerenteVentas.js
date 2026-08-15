/**
 * gerenteVentas.js — El objetivo de venta de cada vendedor y las tareas
 * concretas para alcanzarlo.
 *
 * Patrón de crm.js: funciones planas que reciben DB y devuelven datos
 * calculados. NO hay IA en este archivo, y es a propósito: todo lo que ve el
 * vendedor sale de sus propios datos (sus ventas, sus clientes, la demanda
 * proyectada de su tienda). Una cifra inventada aquí sería peor que no tener
 * pantalla — la vendedora toma decisiones de su día con esto.
 *
 * Reutiliza lo ya construido y probado en vez de reimplementarlo:
 *  - `crm.js` decide qué cliente está "en riesgo" o "inactivo" (calcularSegmento)
 *  - `predicciones.js` proyecta la demanda de productos
 *  - `fechas.js` da la fecha LOCAL de la tienda (America/Mexico_City)
 *
 * Sobre el alcance por sucursal: un vendedor solo ve LO SUYO. Aquí no hace falta
 * el guard de `dentroDeAlcance` porque todo se filtra por `vendedor_id`, que es
 * más estrecho que la sucursal; la capa de rutas sí verifica que nadie consulte
 * el tablero de otro vendedor.
 */

const { calcularSegmento, comprasDeCliente } = require("./crm");
const { predecirDemanda } = require("./predicciones");
const { fechaLocal, ahora } = require("./fechas");

/** Cuántos productos con demanda alta se sugieren empujar. Corto a propósito:
 *  una lista de 20 tareas no la sigue nadie. */
const MAX_PRODUCTOS_SUGERIDOS = 3;
/** Tope de clientes a contactar por vuelta, por el mismo motivo. Se priorizan
 *  los que llevan MÁS tiempo sin comprar: son los que se están perdiendo. */
const MAX_CLIENTES_SUGERIDOS = 5;

function nuevoEstadoTareasVenta() {
  return { tareas: [], ultimo_id: 0 };
}

/** Contador SÍNCRONO, reservado antes de cualquier await. La lección del bug
 *  CRITICAL de Gastos: dos capturas concurrentes recibieron el mismo folio
 *  porque el push ocurría después del await. */
function reservarSiguienteId(DB) {
  const estado = DB.pos.tareas_venta;
  const maxExistente = estado.tareas.reduce((m, t) => Math.max(m, t.id), 0);
  estado.ultimo_id = Math.max(estado.ultimo_id || 0, maxExistente) + 1;
  return estado.ultimo_id;
}

function primerDiaDelMes(fechaLocalStr) {
  return `${fechaLocalStr.slice(0, 7)}-01`;
}

/** Días que faltan para que termine el mes, contando hoy. */
function diasRestantesDelMes(fechaLocalStr) {
  const [anio, mes, dia] = fechaLocalStr.split("-").map(Number);
  // Día 0 del mes siguiente = último día de este mes.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return ultimoDia - dia + 1;
}

/**
 * Cuánto lleva vendido este vendedor en el mes en curso, contra su meta.
 *
 * Solo cuenta ventas `cerrada`: una venta cancelada no puede seguir sumando a
 * la meta de nadie. Las fechas se comparan en la fecha LOCAL de la tienda
 * (ver fechas.js) — con UTC, todo lo vendido después de las 6pm del último día
 * del mes se habría contado en el mes siguiente.
 */
function calcularProgreso(DB, vendedorId, instante = ahora()) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");

  const hoy = fechaLocal(instante);
  const desde = primerDiaDelMes(hoy);

  const vendido_mes = DB.pos.ventas
    .filter((v) => v.vendedor_id === Number(vendedorId))
    .filter((v) => v.estatus === "cerrada")
    .filter((v) => {
      // `v.fecha` ya es una fecha sola (AAAA-MM-DD) en hora local de la tienda.
      const f = String(v.fecha || "").slice(0, 10);
      return f >= desde && f <= hoy;
    })
    .reduce((suma, v) => suma + Number(v.total || 0), 0);

  const meta = Number(vendedor.meta_mensual || 0);
  // Sin meta NO se muestra 0% ni se divide entre cero: la pantalla dice
  // "sin objetivo asignado", que es la verdad, en vez de un progreso engañoso
  // que haría ver a la vendedora como si no hubiera vendido nada.
  const sin_meta = !(meta > 0);

  return {
    vendedor_id: vendedor.id,
    vendedor_nombre: vendedor.nombre,
    meta,
    sin_meta,
    vendido_mes,
    porcentaje: sin_meta ? null : Math.round((vendido_mes / meta) * 100),
    faltante: sin_meta ? null : Math.max(0, meta - vendido_mes),
    dias_restantes_del_mes: diasRestantesDelMes(hoy),
    desde,
    hasta: hoy,
  };
}

/** ¿Ya hay una tarea PENDIENTE para este vendedor sobre este mismo cliente o
 *  producto? Sin esto, cada vez que la vendedora abre su pantalla le aparecería
 *  otra vez "habla con Juan", y la lista se volvería inservible en dos días. */
function yaTienePendiente(DB, vendedorId, { cliente_id = null, producto_id = null }) {
  return DB.pos.tareas_venta.tareas.some(
    (t) =>
      t.vendedor_id === Number(vendedorId) &&
      t.estado === "pendiente" &&
      ((cliente_id != null && t.cliente_id === cliente_id) ||
        (producto_id != null && t.producto_id === producto_id))
  );
}

/**
 * Calcula qué tareas TOCARÍA sugerirle a este vendedor. Función pura: no
 * escribe nada. Quien la llama decide si las guarda (ver `sincronizarTareas`).
 *
 * De dónde sale cada tipo:
 *  - "contactar_cliente": clientes ASIGNADOS a este vendedor cuyo segmento del
 *    CRM sea "en_riesgo" (30-90 días sin comprar) o "inactivo" (más de 90).
 *    Son ventas que ya se tuvieron y se están perdiendo: lo más barato de
 *    recuperar.
 *  - "empujar_producto": productos con demanda proyectada al alza, tomados del
 *    módulo de Predicciones que ya existe.
 */
function generarTareas(DB, vendedorId) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");

  const propuestas = [];

  // --- Clientes que se están enfriando ---
  const clientes = DB.crm.clientes
    .filter((c) => c.id !== 0) // "Público en General" no se contacta
    .filter((c) => c.vendedor_asignado_id === Number(vendedorId))
    .map((c) => {
      const compras = comprasDeCliente(DB, c.id);
      const ultima = compras.length ? compras[compras.length - 1].fecha : null;
      return { cliente: c, segmento: calcularSegmento(compras), ultima };
    })
    .filter((x) => x.segmento === "en_riesgo" || x.segmento === "inactivo");

  // Primero los que llevan más tiempo sin comprar. Los que nunca compraron
  // (sin fecha) van al final: hay menos que recuperar ahí.
  clientes.sort((a, b) => {
    if (!a.ultima) return 1;
    if (!b.ultima) return -1;
    return a.ultima.localeCompare(b.ultima);
  });

  for (const { cliente, segmento, ultima } of clientes.slice(0, MAX_CLIENTES_SUGERIDOS)) {
    propuestas.push({
      tipo: "contactar_cliente",
      cliente_id: cliente.id,
      producto_id: null,
      descripcion: ultima
        ? `Habla con ${cliente.nombre} — su última compra fue el ${ultima}` +
          (segmento === "inactivo" ? " (ya lleva más de 3 meses sin volver)" : "")
        : `Habla con ${cliente.nombre} — está dado de alta pero nunca ha comprado`,
    });
  }

  // --- Productos con demanda al alza ---
  // predecirDemanda puede fallar si no hay historial suficiente; que no haya
  // predicción NO debe dejar a la vendedora sin sus tareas de clientes.
  try {
    const productos = DB["catalogo-productos"].productos.filter((p) => p.activo !== false);
    const conDemanda = [];
    for (const p of productos) {
      try {
        const pred = predecirDemanda(DB, { producto_id: p.id, meses_adelante: 1 });
        // Sin historial, predecirDemanda devuelve { error } en vez de lanzar.
        if (pred?.error) continue;
        const proyectado = pred?.prediccion?.[0]?.cantidad_estimada ?? 0;
        if (proyectado > 0) conDemanda.push({ producto: p, proyectado, confianza: pred.confianza });
      } catch (_) { /* ese producto no tiene historial utilizable: se salta */ }
    }
    conDemanda.sort((a, b) => b.proyectado - a.proyectado);
    for (const { producto, proyectado } of conDemanda.slice(0, MAX_PRODUCTOS_SUGERIDOS)) {
      propuestas.push({
        tipo: "empujar_producto",
        cliente_id: null,
        producto_id: producto.id,
        descripcion: `Empuja ${producto.nombre} — se proyectan ${proyectado} piezas de demanda este mes`,
      });
    }
  } catch (_) { /* sin catálogo o sin predicciones: solo van las de clientes */ }

  return propuestas;
}

/**
 * Guarda las tareas nuevas que falten, sin duplicar las que ya están pendientes.
 * Devuelve la lista COMPLETA de tareas pendientes del vendedor, ya ordenada.
 *
 * Es el único punto de este módulo que escribe.
 */
function sincronizarTareas(DB, vendedorId, instante = ahora()) {
  if (!DB.pos.tareas_venta) DB.pos.tareas_venta = nuevoEstadoTareasVenta();

  for (const p of generarTareas(DB, vendedorId)) {
    if (yaTienePendiente(DB, vendedorId, p)) continue;
    DB.pos.tareas_venta.tareas.push({
      id: reservarSiguienteId(DB),
      vendedor_id: Number(vendedorId),
      tipo: p.tipo,
      descripcion: p.descripcion,
      cliente_id: p.cliente_id,
      producto_id: p.producto_id,
      estado: "pendiente",
      origen: "motor",
      generada_en: instante,
      completada_en: null,
    });
  }

  return listarTareas(DB, vendedorId);
}

/** Las tareas pendientes del vendedor. Las hechas y descartadas se conservan
 *  (sirven de bitácora) pero no se le muestran. */
function listarTareas(DB, vendedorId, estado = "pendiente") {
  if (!DB.pos.tareas_venta) return [];
  return DB.pos.tareas_venta.tareas
    .filter((t) => t.vendedor_id === Number(vendedorId))
    .filter((t) => !estado || t.estado === estado)
    .sort((a, b) => a.id - b.id);
}

/**
 * Marca una tarea como hecha o descartada.
 *
 * `vendedorId` NO es informativo: es el candado. Sin él, cualquier vendedora
 * podría cerrar las tareas de otra pasando el id (el mismo tipo de hueco que
 * tuvo Apartados en julio). El guard vive DENTRO del módulo, no solo en la ruta.
 */
function cambiarEstadoTarea(DB, vendedorId, tareaId, nuevoEstado, instante = ahora()) {
  if (!["hecha", "descartada"].includes(nuevoEstado)) {
    throw new Error("Estado de tarea inválido");
  }
  const tarea = (DB.pos.tareas_venta?.tareas || []).find((t) => t.id === Number(tareaId));
  // Mismo mensaje para "no existe" y "es de otra persona": no se confirma que
  // la tarea de alguien más exista.
  if (!tarea || tarea.vendedor_id !== Number(vendedorId)) {
    throw new Error("Tarea no encontrada");
  }
  if (tarea.estado !== "pendiente") {
    throw new Error("Esa tarea ya estaba cerrada");
  }
  tarea.estado = nuevoEstado;
  tarea.completada_en = instante;
  return tarea;
}

/**
 * Fija la meta mensual de un vendedor. Solo lo hace quien tiene
 * `editar_objetivos_venta` — nunca el propio vendedor sobre sí mismo, y nunca
 * la IA (cuando se agregue el chat, no tendrá herramienta para esto).
 */
function fijarMeta(DB, vendedorId, meta) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");
  const valor = Number(meta);
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error("La meta debe ser un número mayor o igual a cero");
  }
  vendedor.meta_mensual = valor;
  return vendedor;
}

/** El tablero completo del vendedor: progreso + tareas al día. */
function tablero(DB, vendedorId, instante = ahora()) {
  const progreso = calcularProgreso(DB, vendedorId, instante);
  const tareas = sincronizarTareas(DB, vendedorId, instante);
  return { ...progreso, tareas };
}

module.exports = {
  nuevoEstadoTareasVenta, calcularProgreso, generarTareas, sincronizarTareas,
  listarTareas, cambiarEstadoTarea, fijarMeta, tablero,
  diasRestantesDelMes, primerDiaDelMes,
  MAX_CLIENTES_SUGERIDOS, MAX_PRODUCTOS_SUGERIDOS,
};
