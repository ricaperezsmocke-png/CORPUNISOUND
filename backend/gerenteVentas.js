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
/** Días que una tarea ya cerrada (hecha o descartada) impide que se vuelva a
 *  proponer la misma. Ver `tareaYaCubierta`. Un mes: suficiente para no
 *  repetirle lo que acaba de hacer, y poco para no abandonar a un cliente que
 *  sigue sin volver. */
const DIAS_ANTES_DE_REPETIR = 30;
/** Cuántos productos se evalúan con `predecirDemanda` en cada vuelta. Se toman
 *  los más vendidos de SU sucursal. Ver `candidatosAPredecir`: sin este tope,
 *  la pantalla congelaba el sistema entero 2.2 segundos por carga. */
const MAX_PRODUCTOS_A_EVALUAR = 40;
/** Meses completos de historial que mira `sugerirMeta`. Medio año: suficiente
 *  para ver una tendencia, poco para que un diciembre viejo mande sobre la
 *  meta de hoy. */
const MESES_PARA_SUGERIR = 6;
/** Cuánto puede mover la tendencia a la meta sugerida, hacia arriba o hacia
 *  abajo. Sin este tope, un mes extraordinario produce una meta imposible que
 *  desmotiva en vez de empujar. */
const MAX_AJUSTE_TENDENCIA = 0.2;

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

/**
 * ¿Se debe volver a proponer esta tarea, o ya está cubierta?
 *
 * Cubre DOS casos, y el segundo es el que importa:
 *  1. Ya hay una PENDIENTE del mismo cliente/producto — no se duplica.
 *  2. Ya hubo una que el vendedor CERRÓ (hecha o descartada) hace poco.
 *
 * Sin el caso 2 pasaba esto, verificado ejecutándolo: la vendedora marca
 * "habla con Juan" como hecha, recarga la pantalla, y la tarea le VUELVE A
 * APARECER — porque Juan sigue en riesgo hasta que compre. Lo mismo al
 * descartar "empuja este producto" porque no lo tiene en piso: reaparecía cada
 * vez. La lista se volvía inservible, y la colección crecía dos renglones por
 * cada visita a la pantalla.
 *
 * Por qué una VENTANA y no "nunca más": si contactó a Juan hace un mes y Juan
 * sigue sin comprar, sí hay que volver a intentarlo. Enterrar la tarea para
 * siempre sería perder el cliente en silencio.
 */
function tareaYaCubierta(DB, vendedorId, { cliente_id = null, producto_id = null }, instante = ahora()) {
  const limiteMs = Date.parse(instante) - DIAS_ANTES_DE_REPETIR * 24 * 60 * 60 * 1000;

  return DB.pos.tareas_venta.tareas.some((t) => {
    if (t.vendedor_id !== Number(vendedorId)) return false;
    const mismoObjetivo =
      (cliente_id != null && t.cliente_id === cliente_id) ||
      (producto_id != null && t.producto_id === producto_id);
    if (!mismoObjetivo) return false;

    if (t.estado === "pendiente") return true;

    // Cerrada: cuenta como cubierta solo si fue hace poco. Una fecha ilegible
    // se trata como reciente (no se repite): mejor una tarea de menos que
    // inundar la lista por un dato corrupto.
    const cerradaMs = Date.parse(t.completada_en);
    if (!Number.isFinite(cerradaMs)) return true;
    return cerradaMs >= limiteMs;
  });
}

/**
 * Los pocos productos sobre los que vale la pena correr una predicción.
 *
 * ESTO EXISTE POR RENDIMIENTO, y no es un detalle: la versión anterior corría
 * `predecirDemanda` sobre TODO el catálogo activo. Medido con el catálogo real
 * de Unisound (6,229 productos importados de SICAR) y 8,000 ventas, eso tardaba
 * **2.2 segundos bloqueando el event loop** — y Node es de un solo hilo, así que
 * durante esos 2.2 s NINGUNA caja de NINGUNA tienda podía cobrar. Con tres
 * vendedoras abriendo su pantalla, casi 7 segundos de sistema congelado.
 *
 * La preselección además tiene sentido de negocio: "empújale este producto al
 * cliente" solo aplica a mercancía que la tienda de verdad mueve. Un producto
 * sin ventas recientes no tiene historial del que proyectar nada
 * (`predecirDemanda` devuelve `{ error }`), así que recorrerlo era trabajo puro
 * sin resultado posible.
 */
function candidatosAPredecir(DB, vendedor) {
  const productos = DB["catalogo-productos"].productos.filter((p) => p.activo !== false);
  const porId = new Map(productos.map((p) => [p.id, p]));

  // Un solo recorrido de las ventas de SU sucursal para saber qué se mueve ahí.
  const ventasDeLaSucursal = new Set(
    DB.pos.ventas
      .filter((v) => v.estatus === "cerrada" && Number(v.sucursal_id) === Number(vendedor.sucursal_id))
      .map((v) => v.id)
  );

  const unidades = new Map();
  for (const d of DB.pos.venta_detalle || []) {
    if (!ventasDeLaSucursal.has(d.venta_id)) continue;
    if (!porId.has(d.producto_id)) continue;
    unidades.set(d.producto_id, (unidades.get(d.producto_id) || 0) + Number(d.cantidad || 0));
  }

  return [...unidades.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PRODUCTOS_A_EVALUAR)
    .map(([id]) => porId.get(id));
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
    const productos = candidatosAPredecir(DB, vendedor);
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
  let creadas = 0;

  for (const p of generarTareas(DB, vendedorId)) {
    if (tareaYaCubierta(DB, vendedorId, p, instante)) continue;
    creadas++;
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

  // `creadas` lo usa la ruta para decidir si vale la pena persistir el DB: el
  // tablero se pide por GET, y la auto-persistencia de server.js solo corre en
  // POST/PUT/DELETE. Sin esto, las tareas recién generadas vivían solo en
  // memoria hasta que alguien, en cualquier parte del sistema, hiciera una
  // escritura — y se perdían en cada reinicio del servidor. Se persiste SOLO
  // cuando de verdad hubo tareas nuevas, para no reescribir la base entera cada
  // vez que alguien abre su pantalla.
  return { tareas: listarTareas(DB, vendedorId), creadas };
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

/**
 * Sugiere una meta mensual para un vendedor, a partir de SU historial real.
 *
 * La CIFRA es determinista y sale de las ventas de los últimos meses; la IA
 * (opcional, ver `redactarSugerenciaMeta`) solo explica el porqué en lenguaje
 * llano. Ese reparto es a propósito: una meta la usa Victor para evaluar a una
 * persona, así que el número no puede salir de una IA que podría inventarlo.
 *
 * Cómo se calcula:
 *  - Se toman los últimos MESES_PARA_SUGERIR meses COMPLETOS (el mes en curso
 *    no cuenta: va a la mitad y arrastraría la meta hacia abajo).
 *  - Base = promedio de esos meses.
 *  - Se compara la mitad reciente contra la mitad vieja para ver la tendencia,
 *    y se ajusta la base con ella, topada a ±MAX_AJUSTE_TENDENCIA para que un
 *    mes extraordinario no dispare una meta imposible.
 *  - Se redondea a centenas: una meta de $47,383 se ve calculada con calzador.
 */
function sugerirMeta(DB, vendedorId, instante = ahora()) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");

  const hoy = fechaLocal(instante);
  const mesActual = hoy.slice(0, 7);

  // Ventas cerradas por mes, del vendedor, excluyendo el mes en curso.
  const porMes = new Map();
  for (const v of DB.pos.ventas) {
    if (v.vendedor_id !== Number(vendedorId)) continue;
    if (v.estatus !== "cerrada") continue;
    const mes = String(v.fecha || "").slice(0, 7);
    if (!mes || mes >= mesActual) continue;
    porMes.set(mes, (porMes.get(mes) || 0) + Number(v.total || 0));
  }

  const meses = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const usados = meses.slice(-MESES_PARA_SUGERIR);

  if (usados.length === 0) {
    return {
      vendedor_id: vendedor.id,
      vendedor_nombre: vendedor.nombre,
      sugerencia: null,
      meses_de_historial: 0,
      confianza: "ninguna",
      motivo:
        `Todavía no hay meses completos de ventas registradas a nombre de ${vendedor.nombre}, ` +
        "así que no hay de dónde calcular una meta. Ponla a mano por ahora y vuelve en un mes.",
      detalle: { promedio: 0, tendencia_pct: 0, meses: [] },
    };
  }

  const promedio = usados.reduce((s, [, monto]) => s + monto, 0) / usados.length;

  // Tendencia: mitad reciente contra mitad vieja. Con un solo mes no hay
  // tendencia que medir (0), y eso es más honesto que inventarle una.
  let tendencia = 0;
  if (usados.length >= 2) {
    const corte = Math.floor(usados.length / 2);
    const vieja = usados.slice(0, corte);
    const reciente = usados.slice(corte);
    const promVieja = vieja.reduce((s, [, m]) => s + m, 0) / vieja.length;
    const promReciente = reciente.reduce((s, [, m]) => s + m, 0) / reciente.length;
    if (promVieja > 0) tendencia = (promReciente - promVieja) / promVieja;
  }

  const ajuste = Math.max(-MAX_AJUSTE_TENDENCIA, Math.min(MAX_AJUSTE_TENDENCIA, tendencia));
  const cruda = promedio * (1 + ajuste);
  const sugerencia = Math.max(0, Math.round(cruda / 100) * 100);

  // La confianza NO adorna: con dos meses de historial una meta es un tiro al
  // aire, y Victor tiene que saberlo antes de evaluar a alguien con ella.
  const confianza = usados.length >= 6 ? "alta" : usados.length >= 3 ? "media" : "baja";

  const pct = Math.round(tendencia * 100);
  const rumbo = pct > 5 ? `viene subiendo (${pct}%)` : pct < -5 ? `viene bajando (${pct}%)` : "viene pareja";

  return {
    vendedor_id: vendedor.id,
    vendedor_nombre: vendedor.nombre,
    sugerencia,
    meses_de_historial: usados.length,
    confianza,
    motivo:
      `En los últimos ${usados.length} mes(es) completos, ${vendedor.nombre} vendió en promedio ` +
      `$${Math.round(promedio).toLocaleString("es-MX")} al mes, y su venta ${rumbo}. ` +
      `Sobre eso sale la meta sugerida de $${sugerencia.toLocaleString("es-MX")}.` +
      (confianza === "baja"
        ? " Ojo: es poco historial, así que tómala como un punto de partida, no como un dato firme."
        : ""),
    detalle: {
      promedio: Math.round(promedio),
      tendencia_pct: pct,
      meses: usados.map(([mes, monto]) => ({ mes, monto: Math.round(monto) })),
    },
  };
}

/** El tablero completo del vendedor: progreso + tareas al día. */
function tablero(DB, vendedorId, instante = ahora()) {
  const progreso = calcularProgreso(DB, vendedorId, instante);
  const { tareas, creadas } = sincronizarTareas(DB, vendedorId, instante);
  return { ...progreso, tareas, tareas_nuevas: creadas };
}

module.exports = {
  nuevoEstadoTareasVenta, calcularProgreso, generarTareas, sincronizarTareas,
  listarTareas, cambiarEstadoTarea, fijarMeta, tablero, tareaYaCubierta, sugerirMeta,
  diasRestantesDelMes, primerDiaDelMes,
  MAX_CLIENTES_SUGERIDOS, MAX_PRODUCTOS_SUGERIDOS, DIAS_ANTES_DE_REPETIR, MAX_PRODUCTOS_A_EVALUAR,
  MESES_PARA_SUGERIR, MAX_AJUSTE_TENDENCIA,
  candidatosAPredecir,
};
