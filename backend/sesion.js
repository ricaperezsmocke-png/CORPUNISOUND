/**
 * sesion.js — Arma el objeto de sesión que se devuelve al frontend en el
 * login y en /api/auth/yo, incluyendo la sucursal del usuario y si tiene
 * vista global.
 */

const { obtenerRol, permisosDeRol } = require("./roles");

function armarSesion(DB, usuario) {
  const rol = obtenerRol(DB, usuario.rol_id);
  const permisos = permisosDeRol(DB, usuario.rol_id);
  const sucursal = DB.pos.sucursales.find((s) => s.id === Number(usuario.sucursal_id));
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    rol: rol.nombre,
    rol_id: rol.id,
    permisos: rol.permisos,
    modulos: rol.modulos,
    sucursal_id: usuario.sucursal_id,
    sucursal_nombre: sucursal ? sucursal.nombre : "—",
    ver_todas: permisos.includes("ver_todas_las_sucursales"),
  };
}

module.exports = { armarSesion };
