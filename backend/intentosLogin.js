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
 *
 * OJO memoria: la ruta de login es pública, así que un atacante puede mandar
 * un usuario distinto en cada intento. Para que el Map no crezca sin techo
 * (y termine tumbando el proceso), cada entrada guarda `ultimoIntento` y se
 * purga: se sueltan los contadores viejos sin bloqueo activo, y hay un tope
 * duro de tamaño que, ante un ataque sostenido, evita las entradas más
 * antiguas. Un bloqueo todavía vigente nunca se descarta por el tope.
 */

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos
// Un contador sin bloqueo activo se olvida tras este tiempo de inactividad.
const VENTANA_OLVIDO_MS = BLOQUEO_MS;
// Tope duro de entradas vivas en el Map (protección contra el bombardeo).
const LIMITE_ENTRADAS = 10000;

/** Normaliza el usuario para que no se pueda esquivar el bloqueo cambiando
 *  mayúsculas o metiendo espacios. Devuelve "" para datos ausentes.
 *  Debe seguir el MISMO criterio que normalizarUsuario() en usuarios.js (ahí
 *  el login busca la cuenta): si se separan, el cerrojo contaría los fallos
 *  bajo una clave distinta de la cuenta que se intentó abrir. Hay una prueba
 *  en usuarios.test.js que amarra las dos. */
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

/**
 * Suelta lo que ya no hace falta guardar, para que el Map no crezca sin techo:
 *  1) contadores viejos SIN bloqueo activo (la basura que deja un bombardeo de
 *     usuarios inexistentes), y bloqueos ya vencidos;
 *  2) si aun así se pasa del tope (ataque sostenido dentro de la ventana),
 *     evita las entradas más antiguas hasta volver bajo el límite.
 * Un bloqueo TODAVÍA vigente nunca se descarta en el paso 1.
 */
function purgar(store, ahora = Date.now()) {
  for (const [clave, r] of store) {
    const bloqueadoAhora = r.bloqueadoHasta > ahora;
    if (!bloqueadoAhora && (r.ultimoIntento || 0) < ahora - VENTANA_OLVIDO_MS) {
      store.delete(clave);
    }
  }
  if (store.size > LIMITE_ENTRADAS) {
    const porEdad = [...store.entries()].sort(
      (a, b) => (a[1].ultimoIntento || 0) - (b[1].ultimoIntento || 0)
    );
    const sobran = store.size - LIMITE_ENTRADAS;
    for (let i = 0; i < sobran; i++) store.delete(porEdad[i][0]);
  }
}

/** Registra un intento fallido. Al llegar a MAX_INTENTOS activa el bloqueo. */
function registrarFallo(store, usuario, ahora = Date.now()) {
  const clave = normalizar(usuario);
  if (!clave) return;
  const r = store.get(clave) || { fallos: 0, bloqueadoHasta: 0, ultimoIntento: 0 };
  r.fallos += 1;
  r.ultimoIntento = ahora;
  if (r.fallos >= MAX_INTENTOS) r.bloqueadoHasta = ahora + BLOQUEO_MS;
  store.set(clave, r);
  if (store.size > LIMITE_ENTRADAS) purgar(store, ahora);
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
  purgar,
  MAX_INTENTOS,
  BLOQUEO_MS,
  LIMITE_ENTRADAS,
  VENTANA_OLVIDO_MS,
};
