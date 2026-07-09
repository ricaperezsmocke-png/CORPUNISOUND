/**
 * auth.js — Autenticación y control de permisos.
 *
 * IMPORTANTE (léelo antes de usar esto en producción real):
 * - Las contraseñas se guardan hasheadas con bcrypt, nunca en texto plano.
 * - JWT_SECRET debe venir de .env — si no existe, se genera uno temporal
 *   en cada arranque (lo cual invalida sesiones anteriores); para uso real
 *   define JWT_SECRET fijo en tu .env.
 * - Esto es una base funcional, no una auditoría de seguridad completa.
 *   Antes de exponer el backend a internet (Fase 4 del plan de sucursales),
 *   pide una revisión de seguridad específica.
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { permisosDeRol } = require("./roles");

const JWT_SECRET = process.env.JWT_SECRET || "clave-temporal-desarrollo-cambiar-en-produccion";
const EXPIRA_EN = "12h";

async function hashearPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, 10);
}

async function verificarPassword(passwordPlano, hash) {
  return bcrypt.compare(passwordPlano, hash);
}

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nombre: usuario.nombre, rol_id: usuario.rol_id, sucursal_id: usuario.sucursal_id },
    JWT_SECRET,
    { expiresIn: EXPIRA_EN }
  );
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Middleware: exige un JWT válido, y adjunta req.usuarioToken con lo que trae el token */
function requiereLogin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    req.usuarioToken = verificarToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o expirada" });
  }
}

/**
 * Middleware: exige que el usuario logueado tenga cierto permiso.
 * Requiere que ya haya corrido requiereLogin, y recibe una función para
 * resolver los permisos del rol (para no acoplar este archivo a la DB).
 */
function requierePermiso(clave, resolverPermisosDeRol) {
  return (req, res, next) => {
    if (!req.usuarioToken) return res.status(401).json({ error: "No autenticado" });
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    if (!permisos.includes(clave)) {
      return res.status(403).json({ error: `No tienes el permiso requerido: ${clave}` });
    }
    next();
  };
}

/**
 * Resuelve qué sucursal(es) puede ver este request.
 * - Con permiso "ver_todas_las_sucursales": respeta ?sucursal_id= si viene
 *   (para filtrar a una tienda) o devuelve verTodas si no.
 * - Sin ese permiso: se ignora el query y se fuerza la sucursal del token.
 */
function alcanceSucursal(req, permisos) {
  const puedeVerTodas = Array.isArray(permisos) && permisos.includes("ver_todas_las_sucursales");
  const solicitada = req.query ? req.query.sucursal_id : undefined;

  if (puedeVerTodas) {
    if (solicitada !== undefined && solicitada !== "" && solicitada !== "todas" && !Number.isNaN(Number(solicitada))) {
      return { verTodas: false, sucursalId: Number(solicitada) };
    }
    return { verTodas: true, sucursalId: null };
  }
  const sucursalToken = req.usuarioToken && req.usuarioToken.sucursal_id != null ? Number(req.usuarioToken.sucursal_id) : null;
  return { verTodas: false, sucursalId: sucursalToken };
}

/** Filtra un arreglo (que tenga campo sucursal_id) según el alcance resuelto. */
function filtrarPorSucursal(lista, alcance) {
  if (alcance.verTodas) return [...lista];
  return lista.filter((x) => Number(x.sucursal_id) === alcance.sucursalId);
}

/**
 * Versión de filtrarPorSucursal para UN solo registro (rutas por :id).
 * Se usa para decidir si un registro puntual (cliente, venta...) es visible
 * dentro del alcance resuelto, antes de devolverlo o de mutarlo. Un usuario
 * amarrado que pide el registro de otra sucursal debe recibir 404 (no 403,
 * para no confirmar que el registro existe en otra tienda).
 */
function dentroDeAlcance(sucursalId, alcance) {
  if (!alcance || alcance.verTodas) return true;
  return Number(sucursalId) === alcance.sucursalId;
}

const RADIO_TOLERANCIA_METROS = 300;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radio de la Tierra en metros
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Valida que quien inicia sesión esté físicamente en la sucursal que dice
 * ser. Usuario con "ver_todas_las_sucursales" (Administrador) siempre pasa
 * sin evaluar nada más. Usuario amarrado: la sucursal seleccionada debe
 * coincidir con la de su cuenta; si esa sucursal tiene coordenadas
 * configuradas, además su ubicación GPS debe caer dentro del radio de
 * tolerancia. Sin coordenadas configuradas en la sucursal, no se valida GPS
 * todavía (para no bloquear una tienda antes de que Victor la configure).
 */
function validarUbicacionLogin(usuario, sucursalSeleccionadaId, lat, lng, DB) {
  const permisos = permisosDeRol(DB, usuario.rol_id);
  if (permisos.includes("ver_todas_las_sucursales")) return { ok: true };

  const sucursalReal = usuario.sucursal_id != null ? Number(usuario.sucursal_id) : null;
  if (sucursalReal == null || Number(sucursalSeleccionadaId) !== sucursalReal) {
    return { ok: false, motivo: "sucursal_no_coincide" };
  }

  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursalReal);
  if (!sucursal || sucursal.lat == null || sucursal.lng == null) {
    return { ok: true };
  }

  if (lat == null || lng == null) {
    return { ok: false, motivo: "sin_permiso_ubicacion" };
  }

  const distancia = distanciaMetros(Number(lat), Number(lng), sucursal.lat, sucursal.lng);
  if (distancia > RADIO_TOLERANCIA_METROS) {
    return { ok: false, motivo: "ubicacion_no_coincide", distancia };
  }
  return { ok: true };
}

/** Traduce el motivo de bloqueo a un mensaje claro, sin revelar la sucursal real de la cuenta. */
function mensajePorMotivoUbicacion(motivo) {
  if (motivo === "sucursal_no_coincide") return "La sucursal seleccionada no coincide con tu cuenta.";
  if (motivo === "ubicacion_no_coincide") return "Tu ubicación no coincide con la sucursal seleccionada. Verifica que tengas el GPS activado y que estés en la tienda.";
  if (motivo === "sin_permiso_ubicacion") return "Debes permitir el acceso a tu ubicación para iniciar sesión.";
  return "No se pudo iniciar sesión.";
}

module.exports = {
  hashearPassword, verificarPassword, firmarToken, verificarToken, requiereLogin, requierePermiso,
  alcanceSucursal, filtrarPorSucursal, dentroDeAlcance,
  distanciaMetros, validarUbicacionLogin, mensajePorMotivoUbicacion,
};
