const { ErrorRadar } = require("./errores");

/**
 * Un booleano que viene de fuera tiene que ser un booleano de verdad.
 *
 * En JavaScript la cadena "false" es verdadera. Aceptarla significaba dar de
 * alta un prospecto en el CRM y registrar que el cliente aceptó recibir el
 * aviso cuando nunca lo aceptó. El campo ausente sí es válido: quiere decir
 * que no.
 */
function booleanoEstricto(valor, campo) {
  if (valor === undefined || valor === null) return false;
  if (typeof valor !== "boolean") {
    throw new ErrorRadar(
      `${campo} debe ser verdadero o falso, no ${JSON.stringify(valor)}`,
      400
    );
  }
  return valor;
}

module.exports = { booleanoEstricto };
