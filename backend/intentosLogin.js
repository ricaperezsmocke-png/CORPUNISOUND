/**
 * intentosLogin.js — Freno a la fuerza bruta en el inicio de sesión.
 *
 * Sin esto, alguien podía probar contraseñas contra un usuario sin ningún
 * límite (miles por minuto) hasta adivinar. Aquí se cuentan los fallos por
 * usuario y, al llegar a MAX_INTENTOS, la cuenta queda bloqueada por
 * BLOQUEO_MS. Un inicio de sesión exitoso limpia el contador.
 *
 * El estado vive EN MEMORIA a propósito (no en SQLite): es información de
 * seguridad efímera. Que se reinicie cuando Render reinicia el servicio es
 * aceptable — un atacante no gana nada con eso, y no ensuciamos la base con
 * contadores que no interesa conservar. Los "intentos bloqueados por
 * ubicación" (GPS) sí se persisten porque son una bitácora que Victor revisa;
 * esto no, es solo un cerrojo temporal.
 *
 * Se bloquea por USUARIO (no por IP): detrás del proxy de Render la IP real
 * es poco confiable, y el ataque que importa aquí es probar muchas
 * contraseñas contra un usuario conocido. Contrapartida asumida: alguien
 * podría, a propósito, dejar temporalmente bloqueado a un usuario legítimo
 * fallando su login; por eso el bloqueo es corto (15 min) y se limpia solo.
 */

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos

/** Normaliza el usuario para que no se pueda esquivar el bloqueo cambiando
 *  mayúsculas o metiendo espacios. Devuelve "" para datos ausentes. */
function normalizar(usuario) {
  return typeof usuario === "string" ? usuario.trim().toLowerCase() : "";
}

/** Crea un almacén nuevo de intentos (un Map en memoria). */
function crearRegistroIntentos() {
  return new Map();
}

/**
 * ¿La cuenta está bloqueada ahora mismo? Además, si el bloqueo ya venció,
 * limpia el registro (para que el usuario arranque de cero al reintentar).
 * Devuelve { bloqueado, restanteMs } — restanteMs solo cuando está bloqueado.
 */
function estaBloqueado(store, usuario, ahora = Date.now()) {
  const clave = normalizar(usuario);
  if (!clave) return { bloqueado: false };
  const r = store.get(clave);
  if (!r || !r.bloqueadoHasta) return { bloqueado: false };
  if (r.bloqueadoHasta > ahora) {
    return { bloqueado: true, restanteMs: r.bloqueadoHasta - ahora };
  }
  store.delete(clave); // el bloqueo venció: borrón y cuenta nueva
  return { bloqueado: false };
}

/** Registra un intento fallido. Al llegar a MAX_INTENTOS activa el bloqueo. */
function registrarFallo(store, usuario, ahora = Date.now()) {
  const clave = normalizar(usuario);
  if (!clave) return;
  const r = store.get(clave) || { fallos: 0, bloqueadoHasta: 0 };
  r.fallos += 1;
  if (r.fallos >= MAX_INTENTOS) r.bloqueadoHasta = ahora + BLOQUEO_MS;
  store.set(clave, r);
}

/** Limpia el contador de una cuenta tras un inicio de sesión exitoso. */
function registrarExito(store, usuario) {
  const clave = normalizar(usuario);
  if (clave) store.delete(clave);
}

module.exports = {
  crearRegistroIntentos,
  estaBloqueado,
  registrarFallo,
  registrarExito,
  MAX_INTENTOS,
  BLOQUEO_MS,
};
