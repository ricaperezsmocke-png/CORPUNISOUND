/**
 * reconciliarRestauracion.js — Lo que hay que rehacer después de restaurar.
 *
 * Restaurar reemplaza colecciones enteras con una foto vieja, y una foto vieja
 * no conoce lo que se construyó después de tomarla. Sin volver a aplicar las
 * reconciliaciones del arranque, restaurar era **una puerta de una sola
 * dirección**: una foto anterior al módulo de respaldos dejaba al Administrador
 * sin sus permisos, la pantalla desaparecía del tablero y las rutas respondían
 * 403 — nadie podía deshacer la restauración desde el sistema.
 *
 * Esto vivía como función anónima dentro de `server.js`. Se sacó aquí para que
 * se pueda probar: es el camino que corre justo después de reemplazar los datos
 * del negocio, y no puede ser el único sin pruebas propias.
 *
 * REGLA AL AGREGAR ALGO: cada vez que el arranque de `server.js` reconcilie o
 * siembre una colección nueva, hay que sumarla AQUÍ. Si no, esa colección
 * existirá al arrancar y desaparecerá al restaurar, que es la peor combinación
 * posible: funciona hasta el día que alguien restaura, y ese día nadie
 * relaciona una cosa con la otra.
 */

const { reconciliarSucursalesCedis } = require("./sucursales");
const { reconciliarRoles } = require("./roles");
const { nuevoEstadoTareasVenta } = require("./gerenteVentas");
const { sembrarCajas } = require("./cajas");
const { avisarSiLaEpocaEstaEnElFuturo } = require("./corteEpoca");

function reconciliarTrasRestaurar(db, avisar = console.error) {
  db.pos.sucursales = reconciliarSucursalesCedis(db.pos.sucursales);
  reconciliarRoles(db);

  // Un respaldo anterior a Gerencia de Ventas no trae esta colección.
  if (!db.pos.tareas_venta || !Array.isArray(db.pos.tareas_venta.tareas)) {
    db.pos.tareas_venta = nuevoEstadoTareasVenta();
  }

  // Un respaldo anterior a las cajas no las trae. Sin esto, hasta el siguiente
  // reinicio no hay cajas que ofrecer, el corte queda bloqueado, y cada venta
  // se guarda sin caja.
  if (!Array.isArray(db.pos.cajas)) db.pos.cajas = [];
  sembrarCajas(db);

  // La época NO se toma del respaldo a propósito: la de la foto es de otro
  // momento —o de otra máquina— y moverla hacia atrás volvería a tratar como
  // históricos movimientos que ya están sellados, reabriendo los huecos que el
  // sello cierra. Si la foto no trae ninguna, empieza aquí.
  if (!db.pos.corte_epoca) db.pos.corte_epoca = new Date().toISOString();
  avisarSiLaEpocaEstaEnElFuturo(db, avisar);

  return db;
}

module.exports = { reconciliarTrasRestaurar };
