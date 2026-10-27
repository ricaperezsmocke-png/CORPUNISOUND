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
 * - es una persona DISTINTA de quien pide;
 * - tiene el permiso pedido;
 * - es de la misma sucursal, salvo que tenga `ver_todas_las_sucursales`.
 *
 * Freno: cada intento de ADIVINAR (contraseña mala, usuario inexistente o
 * inactivo) cuenta contra el usuario autorizador tecleado Y contra quien pide.
 * Tras 5 (ventana de 15 minutos) cualquiera de los dos queda bloqueado 15
 * minutos. El bloqueo responde EXACTAMENTE el mismo error genérico que una
 * contraseña mala, para no dar pistas de que hay bloqueo ni de qué parte falló.
 *
 * No cuentan los rechazos con la contraseña CORRECTA (misma persona, sin el
 * permiso, otra sucursal) ni los datos incompletos: ahí no se está probando
 * ninguna contraseña, y la respuesta es la misma, así que no sirven de oráculo.
 */

const { verificarPassword } = require("./auth");
const { crearRegistroIntentos, estaBloqueado, registrarFallo, registrarExito } = require("./intentosLogin");

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

/**
 * Devuelve { id, nombre } del autorizador o lanza un Error con status 403 y el
 * mensaje genérico. Falla cerrando: cualquier dato que no sea exactamente lo
 * esperado es un rechazo.
 */
async function verificarAutorizador(DB, credenciales, opciones) {
  const { solicitante, permiso, sucursalId, resolverPermisosDeRol, registro } = opciones || {};
  if (!registro || typeof resolverPermisosDeRol !== "function" || typeof permiso !== "string" || !permiso) {
    throw new Error("verificarAutorizador: faltan opciones obligatorias");
  }
  const claveAut = `aut:${normalizar(credenciales?.usuario)}`;
  const claveSol = `sol:${Number(solicitante?.id)}`;
  // Un intento de adivinar: suma a los dos contadores.
  const fallar = () => {
    registrarFallo(registro, claveAut);
    registrarFallo(registro, claveSol);
    return rechazo();
  };

  if (typeof credenciales?.usuario !== "string" || !credenciales.usuario.trim()
    || typeof credenciales?.password !== "string" || !credenciales.password) throw rechazo();
  // Bloqueado: el mismo 403 genérico, y la contraseña ni se revisa.
  if (estaBloqueado(registro, claveAut).bloqueado || estaBloqueado(registro, claveSol).bloqueado) throw rechazo();

  const clave = normalizar(credenciales.usuario);
  const autorizador = DB.admin.usuarios.find((u) => normalizar(String(u.usuario)) === clave);
  if (!autorizador?.activo) throw fallar();
  let coincide = false;
  try { coincide = await verificarPassword(credenciales.password, autorizador.password_hash); }
  catch { throw fallar(); }
  if (!coincide) throw fallar();
  // De aquí en adelante la contraseña es correcta: se rechaza sin contar.
  if (Number(autorizador.id) === Number(solicitante?.id)) throw rechazo();
  const permisos = resolverPermisosDeRol(autorizador.rol_id);
  if (!Array.isArray(permisos) || !permisos.includes(permiso)) throw rechazo();
  const sucursalAut = Number(autorizador.sucursal_id);
  const sucursalPedida = sucursalId == null ? NaN : Number(sucursalId);
  if (!permisos.includes("ver_todas_las_sucursales")
    && (!Number.isInteger(sucursalAut) || sucursalAut <= 0 || sucursalAut !== sucursalPedida)) throw rechazo();

  registrarExito(registro, claveAut);
  registrarExito(registro, claveSol);
  return { id: autorizador.id, nombre: autorizador.nombre };
}

module.exports = { verificarAutorizador, crearRegistroAutorizador, MENSAJE_RECHAZO };
