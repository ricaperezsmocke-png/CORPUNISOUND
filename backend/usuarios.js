/**
 * usuarios.js — Personal del sistema. Cada usuario tiene un rol asignado
 * (de roles.js) que determina qué puede ver y hacer.
 */

const { hashearPassword, verificarPassword } = require("./auth");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function listarUsuarios(DB) {
  return DB.admin.usuarios.map(({ password_hash, ...resto }) => resto);
}

async function crearUsuario(DB, datos) {
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre es obligatorio");
  if (!datos.usuario || !datos.usuario.trim()) throw new Error("El usuario (para iniciar sesión) es obligatorio");
  if (!datos.password || datos.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
  if (DB.admin.usuarios.some((u) => u.usuario === datos.usuario.trim())) throw new Error("Ese nombre de usuario ya existe");
  if (!datos.rol_id) throw new Error("Debes asignar un rol");

  const nuevo = {
    id: siguienteId(DB.admin.usuarios),
    nombre: datos.nombre.trim(),
    usuario: datos.usuario.trim(),
    password_hash: await hashearPassword(datos.password),
    rol_id: Number(datos.rol_id),
    sucursal_id: Number(datos.sucursal_id) || 1,
    activo: true,
  };
  DB.admin.usuarios.push(nuevo);
  const { password_hash, ...sinPassword } = nuevo;
  return sinPassword;
}

async function actualizarUsuario(DB, id, datos) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  if (datos.password && datos.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");

  DB.admin.usuarios[idx] = {
    ...DB.admin.usuarios[idx],
    nombre: datos.nombre ?? DB.admin.usuarios[idx].nombre,
    rol_id: datos.rol_id !== undefined ? Number(datos.rol_id) : DB.admin.usuarios[idx].rol_id,
    activo: datos.activo !== undefined ? !!datos.activo : DB.admin.usuarios[idx].activo,
  };
  if (datos.password) {
    DB.admin.usuarios[idx].password_hash = await hashearPassword(datos.password);
  }
  const { password_hash, ...sinPassword } = DB.admin.usuarios[idx];
  return sinPassword;
}

function esAccionSobreSiMismo(idObjetivo, idSolicitante) {
  return Number(idObjetivo) === Number(idSolicitante);
}

function eliminarUsuario(DB, id) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  DB.admin.usuarios.splice(idx, 1);
  return { ok: true };
}

async function iniciarSesion(DB, usuario, password) {
  const encontrado = DB.admin.usuarios.find((u) => u.usuario === usuario && u.activo);
  if (!encontrado) throw new Error("Usuario o contraseña incorrectos");
  const ok = await verificarPassword(password, encontrado.password_hash);
  if (!ok) throw new Error("Usuario o contraseña incorrectos");
  return encontrado;
}

module.exports = { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, esAccionSobreSiMismo, iniciarSesion };
