/**
 * arranquePersistencia.js — Qué hacer cuando `require("./persistencia")` falla.
 *
 * EL DEFECTO QUE ESTO ARREGLA:
 *
 * server.js envolvía la carga de persistencia en un try/catch que, si fallaba,
 * dejaba `guardar` como función vacía y ARRANCABA IGUAL, con un `console.warn`
 * que nadie lee. El backend se veía perfectamente sano: se podía entrar,
 * cobrar, imprimir tickets, cerrar caja. Y cada venta del día se escribía en el
 * vacío y desaparecía en el siguiente reinicio.
 *
 * No es hipotético: `better-sqlite3` es un módulo NATIVO compilado contra una
 * versión de Node concreta. El día que Render suba la versión de Node, el
 * `require` truena con "NODE_MODULE_VERSION mismatch" y el sistema entra en ese
 * estado sin que nadie se entere hasta el primer reinicio, cuando ya no hay
 * nada que recuperar. Para un punto de venta, arrancar así es peor que no
 * arrancar: una tienda que no puede vender llama por teléfono en cinco minutos;
 * una tienda que vende en el vacío se entera en días, sin sus ventas.
 *
 * POR QUÉ EL CRITERIO ES "NODE_ENV, y si no está lo tratamos como producción":
 *
 * 1. Es el criterio que este repo YA usa. instrument.js (Sentry) resuelve su
 *    entorno con `process.env.NODE_ENV || "production"`: aquí, lo no declarado
 *    ya se considera producción.
 * 2. Es el ÚNICO que funciona con el despliegue real. Se revisó render.yaml y
 *    NO define `NODE_ENV` ni `DB_PATH`. Un criterio de `NODE_ENV === "production"`
 *    o de "DB_PATH presente" no se cumpliría en Render y dejaría la producción
 *    justo con el comportamiento tolerante que estamos tratando de quitar —
 *    exactamente al revés de lo que hace falta.
 * 3. Fallar cerrado es la única opción defendible cuando la duda es "¿esto es
 *    la tienda?". Equivocarse tolerando cuesta las ventas del día; equivocarse
 *    abortando cuesta poner una variable de entorno.
 *
 * Quien desarrolla se sale de la regla A PROPÓSITO, declarando
 * NODE_ENV=development (o =test), que es cómodo para probar sin compilar el
 * módulo nativo. Nunca al revés.
 */

/** Entornos donde seguir sin persistencia es una comodidad legítima. */
const ENTORNOS_TOLERANTES = new Set(["development", "test"]);

/**
 * ¿Hay que abortar el arranque si la persistencia no cargó?
 * Todo lo que no sea un entorno tolerante declarado explícitamente aborta,
 * incluido NODE_ENV vacío o ausente.
 */
function debeAbortarSinPersistencia(env = process.env) {
  const declarado = String(env.NODE_ENV || "").trim().toLowerCase();
  return !ENTORNOS_TOLERANTES.has(declarado);
}

/**
 * El texto del fallo. Se escribe entero aquí para que diga QUÉ pasó, POR QUÉ
 * importa y QUÉ hacer: quien lo lea a las 9 de la mañana con la tienda abierta
 * no debería tener que abrir el código para entenderlo.
 */
function mensajeSinPersistencia(error, abortar) {
  const causa = (error && error.message) || String(error);
  if (abortar) {
    return [
      "",
      "❌❌❌ EL SISTEMA NO PUEDE GUARDAR NADA — ARRANQUE CANCELADO ❌❌❌",
      "",
      `No se pudo cargar el módulo de persistencia SQLite: ${causa}`,
      "",
      "El servidor NO va a arrancar a propósito. Si arrancara, se vería normal:",
      "se podría entrar, cobrar e imprimir tickets — y TODAS las ventas del día",
      "se perderían en el siguiente reinicio, sin aviso y sin recuperación.",
      "",
      "Causa más probable: better-sqlite3 es un módulo nativo y la versión de",
      "Node cambió. Se arregla reinstalando dependencias en el servidor",
      "(npm install --prefix backend) para recompilarlo contra el Node actual.",
      "",
      "Si de verdad quieres levantarlo SIN guardar nada (solo para desarrollo),",
      "arráncalo con NODE_ENV=development.",
      "",
    ].join("\n");
  }
  return [
    "",
    "⚠️⚠️⚠️  SIN PERSISTENCIA: NADA DE LO QUE HAGAS SE VA A GUARDAR  ⚠️⚠️⚠️",
    "",
    `Módulo de persistencia SQLite no disponible: ${causa}`,
    "",
    `Se continúa solo porque NODE_ENV=${process.env.NODE_ENV}. Todo vive en memoria`,
    "y se pierde al reiniciar. En producción esto aborta el arranque.",
    "",
  ].join("\n");
}

module.exports = { debeAbortarSinPersistencia, mensajeSinPersistencia, ENTORNOS_TOLERANTES };
