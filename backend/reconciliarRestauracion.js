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
 * RESTAURAR REPARA; EL ARRANQUE GRITA. El arranque puede permitirse morir ante
 * un catalogo de cajas torcido porque existe una salida: restaurar. La salida no
 * puede morir por lo mismo. Antes, una foto con dos cajas predeterminadas se
 * rechazaba entera y —como el arranque tambien muere por eso— un solo booleano
 * mal puesto dejaba la tienda sin sistema Y sin manera de recuperarlo. Ahora el
 * catalogo de cajas se REPARA (es derivable de la lista de sucursales; lo unico
 * intocable son los ids) y las reparaciones se devuelven para que se vean en
 * pantalla: una reparacion invisible es la mitad del defecto. Decision de
 * Victor, 2026-09-04.
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
const { repararCajas } = require("./cajas");

function reconciliarTrasRestaurar(db) {
  db.pos.sucursales = reconciliarSucursalesCedis(db.pos.sucursales);
  reconciliarRoles(db);

  // Un respaldo anterior a Gerencia de Ventas no trae esta colección.
  if (!db.pos.tareas_venta || !Array.isArray(db.pos.tareas_venta.tareas)) {
    db.pos.tareas_venta = nuevoEstadoTareasVenta();
  }

  // Un respaldo anterior a las cajas no las trae. Sin esto, hasta el siguiente
  // reinicio no hay cajas que ofrecer, el corte queda bloqueado, y cada venta
  // se guarda sin caja. Y si la foto trae el catalogo torcido, se repara en vez
  // de rechazar la restauracion entera.
  if (!Array.isArray(db.pos.cajas)) db.pos.cajas = [];
  const { reparaciones } = repararCajas(db);

  // Una época vieja pertenece a la misma foto que sus movimientos y se conserva:
  // cambiarla reclasificaría datos ya sellados. Una época futura, en cambio, no
  // ha ocurrido y haría históricos todos los movimientos nuevos; se sustituye
  // por el instante de esta restauración. El aviso de corteEpoca sigue reservado
  // al arranque, donde aún sirve para detectar corrupción fuera de este flujo.
  const ahora = new Date().toISOString();
  if (!db.pos.corte_epoca || db.pos.corte_epoca > ahora) db.pos.corte_epoca = ahora;

  // Una sola forma de devolver esto, igual para los dos llamadores
  // (respaldos.js y server.js): el db reconciliado y lo que hubo que reparar.
  return { db, reparaciones };
}

/**
 * Ejecuta sobre una copia todo lo determinista de la reconciliación. Si la foto
 * trae una forma incompatible, lanza antes de tocar DB.
 *
 * Ya NO lanza por un catálogo de cajas torcido: eso se repara (ver la cabecera).
 */
function validarAntesDeRestaurar(datos) {
  const copia = JSON.parse(JSON.stringify(datos));
  reconciliarTrasRestaurar(copia);
}

module.exports = { reconciliarTrasRestaurar, validarAntesDeRestaurar };
