/**
 * usuarios.js — Personal del sistema. Cada usuario tiene un rol asignado
 * (de roles.js) que determina qué puede ver y hacer.
 */

const { hashearPassword, verificarPassword } = require("./auth");

/**
 * Normaliza el nombre de usuario para COMPARARLO: sin espacios sobrantes y sin
 * distinguir mayúsculas. El teclado del celular autocapitaliza la primera
 * letra, así que la cajera que teclea "Maria" tiene que entrar a la cuenta
 * "maria" en vez de sumar un fallo al freno de fuerza bruta.
 *
 * Es el MISMO criterio que usa normalizar() en intentosLogin.js (trim +
 * minúsculas): si los dos difirieran, el cerrojo contaría los fallos bajo una
 * clave distinta a la del usuario que realmente se buscó.
 *
 * La CONTRASEÑA no se normaliza nunca: esa sí distingue mayúsculas.
 */
function normalizarUsuario(usuario) {
  return typeof usuario === "string" ? usuario.trim().toLowerCase() : "";
}

/**
 * Cuentas YA guardadas que se pisan entre sí al normalizar (trim + minúsculas).
 *
 * crearUsuario impide crear nuevas y actualizarUsuario no deja renombrar, así
 * que esto no puede aparecer de aquí en adelante — pero una base vieja podría
 * tener "Maria" y "maria" desde antes. iniciarSesion se queda con la PRIMERA
 * del arreglo, así que la segunda no puede entrar nunca y solo ve el mensaje
 * genérico "Usuario o contraseña incorrectos": para el dueño se ve como "a
 * Fulana le dejó de funcionar la cuenta", sin ninguna pista de por qué.
 *
 * Por eso el arranque de server.js lo dice en voz alta (avisa, no bloquea).
 * Las cuentas con el nombre en blanco se ignoran: esas ya no pueden entrar por
 * la guarda de nombre vacío de iniciarSesion, choquen o no.
 *
 * @returns [{ clave, usuarios: ["Maria", "maria"] }] — vacío si no hay choques
 */
function usuariosQueChocanAlNormalizar(DB) {
  const porClave = new Map();
  for (const u of (DB && DB.admin && DB.admin.usuarios) || []) {
    const clave = normalizarUsuario(u.usuario);
    if (!clave) continue;
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(u.usuario);
  }
  return [...porClave.entries()]
    .filter(([, usuarios]) => usuarios.length > 1)
    .map(([clave, usuarios]) => ({ clave, usuarios }));
}

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
  // Se compara normalizado: dos cuentas que solo difieren en mayúsculas o
  // espacios serían indistinguibles al entrar (el login busca normalizado y
  // se quedaría siempre con la primera).
  if (DB.admin.usuarios.some((u) => normalizarUsuario(u.usuario) === normalizarUsuario(datos.usuario))) throw new Error("Ese nombre de usuario ya existe");
  if (!datos.rol_id) throw new Error("Debes asignar un rol");

  const nuevo = {
    id: siguienteId(DB.admin.usuarios),
    nombre: datos.nombre.trim(),
    usuario: datos.usuario.trim(),
    password_hash: await hashearPassword(datos.password),
    rol_id: Number(datos.rol_id),
    sucursal_id: Number(datos.sucursal_id) || 1,
    // Liga con el catálogo DB.pos.vendedores (Gerencia de Ventas). null = esta
    // cuenta no participa del programa de objetivos, que es el comportamiento
    // de siempre. Es un dato administrativo: lo pone quien da de alta al
    // personal, nunca la propia persona.
    vendedor_id: datos.vendedor_id ? Number(datos.vendedor_id) : null,
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
    sucursal_id: datos.sucursal_id !== undefined ? Number(datos.sucursal_id) : DB.admin.usuarios[idx].sucursal_id,
    // Se acepta null explícito para DESLIGAR una cuenta de su vendedor (por eso
    // se distingue `undefined` de `null` en vez de usar `||`).
    vendedor_id: datos.vendedor_id !== undefined
      ? (datos.vendedor_id === null || datos.vendedor_id === "" ? null : Number(datos.vendedor_id))
      : (DB.admin.usuarios[idx].vendedor_id ?? null),
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
  // Se normalizan los DOS lados: los usuarios ya guardados conservan las
  // mayúsculas con que se capturaron, así que "Maria" en la base debe
  // encontrarse escribiendo "maria", "MARIA" o " Maria ". Sin migrar nada.
  const clave = normalizarUsuario(usuario);
  const encontrado = clave ? DB.admin.usuarios.find((u) => normalizarUsuario(u.usuario) === clave && u.activo) : null;
  if (!encontrado) throw new Error("Usuario o contraseña incorrectos");
  const ok = await verificarPassword(password, encontrado.password_hash);
  if (!ok) throw new Error("Usuario o contraseña incorrectos");
  return encontrado;
}

module.exports = {
  listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario,
  esAccionSobreSiMismo, iniciarSesion, normalizarUsuario, usuariosQueChocanAlNormalizar,
};
