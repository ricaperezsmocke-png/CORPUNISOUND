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
    { id: usuario.id, nombre: usuario.nombre, rol_id: usuario.rol_id },
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

module.exports = { hashearPassword, verificarPassword, firmarToken, verificarToken, requiereLogin, requierePermiso };
