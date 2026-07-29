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

Sentry.init({
  dsn: process.env.SENTRY_DSN || DSN_POR_DEFECTO,

  // Entorno: aparece como etiqueta en cada evento de Sentry.
  environment: process.env.NODE_ENV || "production",

  // Trazas de rendimiento: 100% en desarrollo, 10% en producción
  // (equilibrio entre visibilidad y costo/cuota del plan gratuito).
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Incluye el valor de las variables locales en el stack trace de cada error
  // — facilita entender qué pasó sin tener que reproducirlo. Sentry depura del
  // lado del servidor los campos que parecen contraseñas/tokens por defecto.
  includeLocalVariables: true,
});
