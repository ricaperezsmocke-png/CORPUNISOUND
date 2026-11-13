// Por conexión: el procesador reemplaza la base y el receptor suma solo nuevas inserciones.
// Separar adicionales permite inyectar un lector de base sin recalcular SQL por petición.
const contadores = new WeakMap();

function contadorPendientes(sqlite) {
  if (!contadores.has(sqlite)) contadores.set(sqlite, { base: 0, adicionales: 0 });
  return contadores.get(sqlite);
}

module.exports = { contadorPendientes };
