/**
 * instrument.js — Inicialización de Sentry (monitoreo de errores + trazas).
 *
 * DEBE cargarse antes que cualquier otro módulo: es el PRIMER require de
 * server.js. Así Sentry puede auto-instrumentar HTTP y Express.
 *
 * El DSN del proyecto de Sentry viene embebido como valor por defecto (un DSN
 * no es secreto: solo permite ENVIAR errores, no leerlos). Una variable de
 * entorno SENTRY_DSN en Render lo puede sobrescribir si alguna vez hace falta.
 */
require("dotenv").config();
const Sentry = require("@sentry/node");

const DSN_POR_DEFECTO = "https://34df60160c30cbcfd7b1387459880acd@o4511779628646400.ingest.us.sentry.io/4511779724460032";

/**
 * Nombres (en minúsculas) que marcan una variable/campo como secreto. Se
 * compara por SUBSTRING, no por igualdad exacta, para que "RESPALDO_LLAVE",
 * "CLAVE_RESTAURACION" o "ml_client_secret" caigan aunque el depurado
 * automático de Sentry (que solo conoce nombres en inglés) no los reconozca.
 *
 * Restricción global 12: "Ningún secreto se escribe en bitácora, log,
 * respuesta HTTP ni Sentry. Nunca." — `includeLocalVariables: true` adjunta
 * las variables locales de cada frame del stack trace, y una de esas
 * variables puede ser justo la llave o la clave que no debe salir de aquí.
 */
const NOMBRES_SECRETOS = [
  "llave", "clave", "respaldo_llave", "clave_restauracion",
  "token_descarga_respaldos", "jwt_secret", "ml_client_secret",
  "token", "secret", "password", "contrasena", "contraseña", "authorization",
];

function esNombreSecreto(nombre) {
  if (typeof nombre !== "string" || !nombre) return false;
  const normalizado = nombre.toLowerCase();
  return NOMBRES_SECRETOS.some((s) => normalizado.includes(s));
}

/** Reemplaza en el lugar, en `obj`, el valor de toda propiedad cuyo NOMBRE
 *  case con la lista de secretos. `visitados` evita ciclos infinitos. */
function filtrarObjeto(obj, visitados) {
  if (!obj || typeof obj !== "object") return;
  if (visitados.has(obj)) return;
  visitados.add(obj);
  for (const clave of Object.keys(obj)) {
    if (esNombreSecreto(clave)) {
      obj[clave] = "[Filtrado]";
      continue;
    }
    const valor = obj[clave];
    if (valor && typeof valor === "object") filtrarObjeto(valor, visitados);
  }
}

/**
 * Depurador propio de eventos de Sentry: recorre variables locales de cada
 * frame del stack trace, `extra`, `tags`, `contexts` y los datos/encabezados
 * de la petición, y reemplaza por "[Filtrado]" cualquier campo cuyo nombre
 * case con NOMBRES_SECRETOS.
 *
 * Pura sobre `evento` salvo por la mutación en el lugar de sus propios
 * objetos internos (que es justo lo que Sentry espera de un `beforeSend`).
 * NUNCA lanza: un evento raro, con ciclos, sin `exception`, o `null` no debe
 * tumbar el envío a Sentry — eso apagaría el monitoreo de errores de TODO
 * el backend, que es peor que un evento sin depurar del todo.
 */
function depurarSecretos(evento) {
  try {
    if (!evento || typeof evento !== "object") return evento;
    const visitados = new WeakSet();

    const values = evento.exception && evento.exception.values;
    if (Array.isArray(values)) {
      for (const valor of values) {
        const frames = valor && valor.stacktrace && valor.stacktrace.frames;
        if (Array.isArray(frames)) {
          for (const frame of frames) {
            if (frame && frame.vars && typeof frame.vars === "object") {
              filtrarObjeto(frame.vars, visitados);
            }
          }
        }
      }
    }

    if (evento.extra) filtrarObjeto(evento.extra, visitados);
    if (evento.tags) filtrarObjeto(evento.tags, visitados);
    if (evento.contexts) filtrarObjeto(evento.contexts, visitados);
    if (evento.request) {
      if (evento.request.data) filtrarObjeto(evento.request.data, visitados);
      if (evento.request.headers) filtrarObjeto(evento.request.headers, visitados);
      if (evento.request.cookies) filtrarObjeto(evento.request.cookies, visitados);
    }

    return evento;
  } catch (_) {
    // Si depurarSecretos revienta, se manda el evento TAL CUAL en vez de
    // tumbar el envío entero — ver el comentario de arriba.
    return evento;
  }
}

Sentry.init({
  dsn: process.env.SENTRY_DSN || DSN_POR_DEFECTO,

  // Entorno: aparece como etiqueta en cada evento de Sentry.
  environment: process.env.NODE_ENV || "production",

  // Trazas de rendimiento: 100% en desarrollo, 10% en producción
  // (equilibrio entre visibilidad y costo/cuota del plan gratuito).
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Incluye el valor de las variables locales en el stack trace de cada error
  // — facilita entender qué pasó sin tener que reproducirlo. Sentry depura del
  // lado del servidor los campos que parecen contraseñas/tokens por defecto,
  // pero solo reconoce nombres en inglés — depurarSecretos() de arriba cubre
  // lo que Sentry no conoce (RESPALDO_LLAVE, CLAVE_RESTAURACION, etc.).
  includeLocalVariables: true,

  // Compón, no pises: si algún día se agrega OTRO beforeSend, este debe seguir
  // corriendo. Hoy es el único, así que se limita a llamar a depurarSecretos.
  beforeSend(event) {
    return depurarSecretos(event);
  },
});

module.exports = { depurarSecretos };
