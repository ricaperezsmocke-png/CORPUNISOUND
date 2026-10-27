/**
 * oauthEstado.js — El `state` de OAuth que liga el regreso de Google Drive o de
 * MercadoLibre con la persona que apretó "Conectar".
 *
 * Antes el callback no pedía sesión ni `state`: cualquiera en internet abría la
 * pantalla de autorización con el identificador público de la app, entraba con
 * SU cuenta, y el sistema guardaba esa cuenta como la del negocio. Desde ahí los
 * respaldos y los expedientes se subían al Drive del intruso.
 *
 * Reglas:
 * - El `state` es aleatorio (32 bytes) y vive solo en memoria: un reinicio del
 *   servidor lo borra y quien estaba conectando vuelve a apretar el botón.
 * - Va ligado a un proveedor y a un usuario, y vence a los 10 minutos.
 * - Es de UN solo uso: se borra al consumirlo, sirva o no.
 * - La búsqueda es por llave exacta en un Map: no hay comparación carácter por
 *   carácter que filtre tiempos.
 */

const crypto = require("crypto");

const VIGENCIA_MS = 10 * 60 * 1000;

function crearRegistroEstados({ ahora = () => Date.now() } = {}) {
  const pendientes = new Map();

  function purgarVencidos() {
    const t = ahora();
    for (const [llave, dato] of pendientes) {
      if (dato.vence <= t) pendientes.delete(llave);
    }
  }

  function emitir(proveedor, usuario) {
    purgarVencidos();
    const state = crypto.randomBytes(32).toString("hex");
    pendientes.set(state, {
      proveedor,
      usuario_id: usuario?.id ?? null,
      usuario_nombre: usuario?.nombre ?? null,
      vence: ahora() + VIGENCIA_MS,
    });
    return state;
  }

  // Devuelve { usuario_id, usuario_nombre } o null. Falla cerrando: cualquier
  // cosa que no sea un texto conocido, vigente y del proveedor pedido es null.
  function consumir(proveedor, state) {
    if (typeof state !== "string" || !state) return null;
    const dato = pendientes.get(state);
    if (!dato) return null;
    pendientes.delete(state);
    if (dato.proveedor !== proveedor) return null;
    if (dato.vence <= ahora()) return null;
    return { usuario_id: dato.usuario_id, usuario_nombre: dato.usuario_nombre };
  }

  return { emitir, consumir, _pendientes: () => pendientes.size };
}

module.exports = { crearRegistroEstados, VIGENCIA_MS };
