/**
 * mantenimiento.js — El interruptor que congela el sistema mientras se restaura.
 *
 * Restaurar reemplaza TODOS los datos del negocio. Si una cajera está cobrando en
 * ese momento, su venta se escribe sobre datos que están a punto de desaparecer, o
 * peor: se pierde sin que nadie se entere. Victor pidió que el sistema se bloquee
 * solo (2026-08-12) en vez de confiar en el aviso de la pantalla.
 *
 * El estado vive en una variable de módulo, NO en el objeto DB, y eso es a
 * propósito: `persistencia.js` serializa el DB entero a SQLite, y un interruptor
 * de mantenimiento persistido podría quedarse trabado en "prendido" tras un
 * reinicio a media restauración — dejando la tienda cerrada sin forma de abrirla
 * desde la interfaz. En memoria, un reinicio siempre despierta con el sistema
 * abierto: si la restauración quedó a medias, se vuelve a intentar; una tienda
 * trabada sería peor.
 */

let activo = false;
let motivo = null;
let desde = null;

/** Prende el bloqueo. Llamar dos veces NO reinicia el reloj: si ya estaba
 *  bloqueado, lo que importa es desde cuándo lo está. */
function activar(razon) {
  motivo = razon || "Mantenimiento en curso";
  if (!activo) {
    activo = true;
    desde = new Date().toISOString();
  }
}

function desactivar() {
  activo = false;
  motivo = null;
  desde = null;
}

function estaActivo() {
  return activo;
}

function estado() {
  return { activo, motivo, desde };
}

module.exports = { activar, desactivar, estaActivo, estado };
