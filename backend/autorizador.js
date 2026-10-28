/**
 * autorizador.js — La ÚNICA verificación de "otra persona autoriza esto" con
 * usuario y contraseña (cancelar una venta, aplicar un monedero).
 *
 * Antes vivía pegada dentro de la ruta de cancelación y no tenía freno: con
 * `cancelar_ventas` se podía probar la contraseña de Victor una y otra vez desde
 * el campo del autorizador, sin pasar por el cerrojo de 5 intentos del login
 * (auditoría de permisos 2026-10, M1).
 *
 * Reglas (las mismas que tenía la cancelación):
 * - el autorizador existe, está activo y la contraseña coincide;
 * - es una persona DISTINTA de quien pide, y no es una cuenta que dio de alta
 *   quien pide (`creado_por_id`);
 * - tiene el permiso pedido;
 * - es de la misma sucursal, salvo que tenga `ver_todas_las_sucursales`.
 *
 * Freno: cada intento de ADIVINAR (contraseña mala, usuario inexistente o
 * inactivo) cuenta contra el usuario autorizador tecleado Y contra quien pide.
 * Tras 5 (ventana de 15 minutos) cualquiera de los dos queda bloqueado 15
 * minutos. El bloqueo responde EXACTAMENTE el mismo error genérico que una
 * contraseña mala, para no dar pistas de que hay bloqueo ni de qué parte falló.
 *
 * No cuentan los rechazos con la contraseña CORRECTA (misma persona, cuenta
 * creada por quien pide, sin el permiso, otra sucursal) ni los datos incompletos: ahí no se está probando
 * ninguna contraseña, y la respuesta es la misma, así que no sirven de oráculo.
 */

const crypto = require("crypto");
const { verificarPassword, hashearPassword } = require("./auth");
const { crearRegistroIntentos, estaBloqueado, registrarFallo, registrarExito } = require("./intentosLogin");

// Hash de una contraseña al azar que nadie conoce, generado UNA vez al cargar
// el módulo (con el mismo costo que los reales). Cuando la cuenta no existe,
// está inactiva o el par está bloqueado, la contraseña se compara igual contra
// este hash y el resultado se tira: así todas las respuestas tardan lo mismo y
// el tiempo no dice si la cuenta existe ni si la adivinanza anterior acertó
// (revisión 2026-10-27, R2 y R3).
const HASH_FICTICIO = hashearPassword(crypto.randomBytes(32).toString("hex"));

const MENSAJE_RECHAZO = "La autorización no es válida";

function rechazo() {
  const e = new Error(MENSAJE_RECHAZO);
  e.status = 403;
  return e;
}

function crearRegistroAutorizador() {
  return crearRegistroIntentos();
}

function normalizar(usuario) {
  return typeof usuario === "string" ? usuario.trim().toLowerCase() : "";
}

function credencialesBienFormadas(c) {
  return typeof c?.usuario === "string" && !!c.usuario.trim() && typeof c?.password === "string" && !!c.password;
}

// Un error de programación, no un rechazo: sin estas opciones no hay guarda.
function exigirOpciones(registro, resolverPermisosDeRol, permiso) {
  if (!registro || typeof resolverPermisosDeRol !== "function" || typeof permiso !== "string" || !permiso) {
    throw new Error("verificarAutorizador: faltan opciones obligatorias");
  }
}

// Misma sucursal que la operación, salvo alcance global. `Number(null)` es 0,
// así que una sucursal ausente de cualquiera de los dos lados se rechaza.
function alcanzaSucursal(autorizador, permisos, sucursalId) {
  if (permisos.includes("ver_todas_las_sucursales")) return true;
  const sucursalAut = Number(autorizador.sucursal_id);
  const sucursalPedida = sucursalId == null ? NaN : Number(sucursalId);
  return Number.isInteger(sucursalAut) && sucursalAut > 0 && sucursalAut === sucursalPedida;
}

// Una cuenta que dio de alta quien pide no le autoriza nada: si no, con una
// cuenta títere de su mismo rol se autorizaba a sí mismo (revisión 2026-10-27,
// R1). Las cuentas viejas sin `creado_por_id` no se afectan: `Number(null)` es
// 0 y ningún id válido es 0, por eso se exige un entero positivo.
function creadaPorQuienPide(autorizador, solicitante) {
  if (autorizador.creado_por_id == null || autorizador.creado_por_id === "") return false;
  const creador = Number(autorizador.creado_por_id);
  return Number.isInteger(creador) && creador > 0 && creador === Number(solicitante?.id);
}

/**
 * Devuelve { id, nombre } del autorizador o lanza un Error con status 403 y el
 * mensaje genérico. Falla cerrando: cualquier dato que no sea exactamente lo
 * esperado es un rechazo.
 */
async function verificarAutorizador(DB, credenciales, opciones) {
  const { solicitante, permiso, sucursalId, resolverPermisosDeRol, registro } = opciones || {};
  // Inyectable solo para las pruebas (contar comparaciones sin medir tiempo).
  const verificar = opciones?.verificarPassword || verificarPassword;
  exigirOpciones(registro, resolverPermisosDeRol, permiso);
  const claveAut = `aut:${normalizar(credenciales?.usuario)}`;
  const claveSol = `sol:${Number(solicitante?.id)}`;
  // Un intento de adivinar: suma a los dos contadores.
  const fallar = () => {
    registrarFallo(registro, claveAut);
    registrarFallo(registro, claveSol);
    return rechazo();
  };

  // Compara contra el hash ficticio y descarta el resultado: solo gasta el
  // mismo tiempo que una comparación real.
  const gastarComparacion = async () => {
    try { await verificar(credenciales.password, await HASH_FICTICIO); } catch { /* da igual: se rechaza */ }
  };

  if (!credencialesBienFormadas(credenciales)) throw rechazo();
  // Bloqueado: el mismo 403 genérico. La contraseña real ni se revisa, pero
  // se gasta lo mismo que si se revisara.
  if (estaBloqueado(registro, claveAut).bloqueado || estaBloqueado(registro, claveSol).bloqueado) {
    await gastarComparacion();
    throw rechazo();
  }

  const clave = normalizar(credenciales.usuario);
  const autorizador = DB.admin.usuarios.find((u) => normalizar(String(u.usuario)) === clave);
  if (!autorizador?.activo) {
    await gastarComparacion();
    throw fallar();
  }
  let coincide = false;
  try { coincide = await verificar(credenciales.password, autorizador.password_hash); }
  catch { throw fallar(); }
  if (!coincide) throw fallar();
  // De aquí en adelante la contraseña es correcta: se rechaza sin contar.
  if (Number(autorizador.id) === Number(solicitante?.id)) throw rechazo();
  if (creadaPorQuienPide(autorizador, solicitante)) throw rechazo();
  const permisos = resolverPermisosDeRol(autorizador.rol_id);
  if (!Array.isArray(permisos) || !permisos.includes(permiso)) throw rechazo();
  if (!alcanzaSucursal(autorizador, permisos, sucursalId)) throw rechazo();

  registrarExito(registro, claveAut);
  registrarExito(registro, claveSol);
  return { id: autorizador.id, nombre: autorizador.nombre };
}

module.exports = { verificarAutorizador, crearRegistroAutorizador, MENSAJE_RECHAZO };
