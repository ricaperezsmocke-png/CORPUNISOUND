/**
 * Error de dominio de Radar con su propio código HTTP.
 *
 * Antes el código HTTP se adivinaba con una expresión regular sobre el texto
 * del mensaje en server.js. Eso obliga a redactar los mensajes para engañar a
 * la regex. Con esta clase el dominio dice explícitamente qué código quiere.
 */
class ErrorRadar extends Error {
  constructor(mensaje, estatus = 400) {
    super(mensaje);
    this.name = "ErrorRadar";
    this.estatus = estatus;
  }
}

module.exports = { ErrorRadar };
