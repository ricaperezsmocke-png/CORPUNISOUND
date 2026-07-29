/**
 * instrument.js — Inicialización de Sentry (monitoreo de errores + trazas).
 *
 * DEBE cargarse antes que cualquier otro módulo: es el PRIMER require de
 * server.js. Así Sentry puede auto-instrumentar HTTP y Express.
 *
 * Si SENTRY_DSN no está configurado (por ejemplo, corriendo en local),
 * Sentry queda completamente inerte: no envía nada ni cambia el comportamiento
 * del backend. En producción (Render) se activa poniendo la variable de
 * entorno SENTRY_DSN con el DSN del proyecto de Sentry.
 */
require("dotenv").config();
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,

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
