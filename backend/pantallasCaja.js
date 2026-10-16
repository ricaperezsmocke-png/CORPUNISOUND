/**
 * pantallasCaja.js — Interruptores de las pantallas que mueven dinero de caja.
 *
 * Las tiendas cobran en SICAR; Victor apaga el Punto de Venta sin borrarlo
 * (spec docs/superpowers/specs/2026-10-15-pantallas-caja-design.md). Dos
 * reglas existen para que nadie cargue con un faltante inventado:
 *   1. Ninguna pantalla que mete o saca dinero queda encendida sin corte.
 *   2. El corte no se apaga con dinero que el siguiente corte esperaba cobrar.
 * La caja de MercadoLibre conserva su corte siempre (sección 3b del spec).
 *
 * El bloqueo vive en las rutas HTTP, nunca en las funciones de ventas, gastos
 * o garantías: así ninguna otra parte del sistema cambia de comportamiento.
 */
const { calcularCorteEnCurso } = require("./cortes");
const { SUCURSAL_ML } = require("./mercadolibre");

const NOMBRES = {
  punto_venta: "Punto de Venta",
  corte_caja: "Corte de Caja",
  gastos_caja: "Gastos",
  dinero_garantias_caja: "Dinero de garantías en caja",
  depositos: "Depósitos",
};
const PANTALLAS = Object.freeze(Object.keys(NOMBRES));
const DEPENDEN_DEL_CORTE = PANTALLAS.filter((p) => p !== "corte_caja");

function errorCon(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

function registro(DB) {
  const actual = DB.pos.pantallas_caja;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) DB.pos.pantallas_caja = { estado: {}, historial: [] };
  const r = DB.pos.pantallas_caja;
  if (!r.estado || typeof r.estado !== "object" || Array.isArray(r.estado)) r.estado = {};
  if (!Array.isArray(r.historial)) r.historial = [];
  return r;
}

/** Falla cerrando: ausente = encendida (estado anterior a esta entrega); cualquier valor que no sea `true` = apagada. */
function estaActiva(DB, pantalla) {
  const estado = DB.pos?.pantallas_caja?.estado;
  if (!estado || typeof estado !== "object" || !Object.hasOwn(estado, pantalla)) return true;
  return estado[pantalla] === true;
}

function esMercadoLibre(sucursalId) {
  return Number(sucursalId) === SUCURSAL_ML;
}

/** Cajas de tiendas físicas cuyo siguiente corte ya tiene movimientos (los mismos que cobraría el corte). */
function dineroSinCortar(DB) {
  const pendientes = [];
  for (const sucursal of DB.pos.sucursales || []) {
    if (esMercadoLibre(sucursal.id)) continue;
    const cajas = (DB.pos.cajas || []).filter((c) => Number(c.sucursal_id) === Number(sucursal.id));
    for (const caja of cajas.length ? cajas : [null]) {
      const corte = calcularCorteEnCurso(DB, sucursal.id, caja?.id);
      const movimientos = corte.ventas_incluidas + corte.abonos_incluidos + corte.gastos_incluidos
        + corte.garantias_cobros_incluidos + corte.garantias_gastos_incluidos;
      if (movimientos > 0) {
        pendientes.push({ sucursal_id: Number(sucursal.id), sucursal: sucursal.nombre,
          caja_id: caja?.id ?? null, caja: caja?.nombre ?? null, movimientos });
      }
    }
  }
  return pendientes;
}

function validarReglas(DB, pantalla, activa) {
  if (pantalla === "corte_caja" && !activa) {
    const encendidas = DEPENDEN_DEL_CORTE.filter((p) => estaActiva(DB, p)).map((p) => NOMBRES[p]);
    if (encendidas.length) {
      throw errorCon(409, `Primero apaga ${encendidas.join(", ")}: todo lo que mueve dinero necesita un corte que lo espere.`);
    }
    const pendientes = dineroSinCortar(DB);
    if (pendientes.length) {
      const donde = pendientes.map((p) => (p.caja ? `${p.sucursal} (caja ${p.caja})` : p.sucursal)).join(", ");
      throw errorCon(409, `Hay dinero sin cortar en ${donde}. Cierra esos cortes antes de apagar Corte de Caja.`);
    }
  }
  if (pantalla !== "corte_caja" && activa && !estaActiva(DB, "corte_caja")) {
    throw errorCon(409, `Primero enciende Corte de Caja: ${NOMBRES[pantalla]} mueve dinero y necesita un corte que lo espere.`);
  }
}

function cambiarPantalla(DB, datos, usuario) {
  const { pantalla, activa } = datos || {};
  if (!PANTALLAS.includes(pantalla)) throw errorCon(400, "Pantalla desconocida.");
  if (typeof activa !== "boolean") throw errorCon(400, "Indica si la pantalla queda encendida (true) o apagada (false).");
  const antes = estaActiva(DB, pantalla);
  if (antes === activa) return estadoPantallas(DB);
  validarReglas(DB, pantalla, activa);
  const r = registro(DB);
  r.estado[pantalla] = activa;
  r.historial.push({ pantalla, de: antes, a: activa, usuario_id: usuario?.id ?? null,
    usuario_nombre: usuario?.nombre || "—", fecha_hora: new Date().toISOString() });
  return estadoPantallas(DB);
}

function estadoPantallas(DB) {
  const pantallas = Object.fromEntries(PANTALLAS.map((p) => [p, estaActiva(DB, p)]));
  const historial = Array.isArray(DB.pos?.pantallas_caja?.historial) ? DB.pos.pantallas_caja.historial.slice(-100) : [];
  return { pantallas, nombres: NOMBRES, historial };
}

/** Middleware: 409 antes de tocar nada si la pantalla está apagada. */
function requierePantalla(DB, pantalla) {
  return (req, res, next) => {
    if (estaActiva(DB, pantalla)) return next();
    res.status(409).json({ codigo: "PANTALLA_APAGADA", pantalla,
      error: `${NOMBRES[pantalla]} está desactivada por el administrador.` });
  };
}

/**
 * Cancelar una venta con Punto de Venta apagado: solo si es de MercadoLibre (decisión de Victor, 2026-10-15),
 * igual que su corte. Falla cerrando: id que no es un número limpio, venta inexistente u otra tienda = 409.
 */
function requierePuntoVentaSalvoML(DB) {
  const bloquear = requierePantalla(DB, "punto_venta");
  return (req, res, next) => {
    if (estaActiva(DB, "punto_venta")) return next();
    const id = String(req.params.id);
    const venta = /^[1-9]\d*$/.test(id) ? (DB.pos.ventas || []).find((v) => Number(v.id) === Number(id)) : null;
    if (venta && esMercadoLibre(venta.sucursal_id)) return next();
    return bloquear(req, res, next);
  };
}

module.exports = { PANTALLAS, NOMBRES, estaActiva, esMercadoLibre, dineroSinCortar, cambiarPantalla, estadoPantallas,
  requierePantalla, requierePuntoVentaSalvoML };
