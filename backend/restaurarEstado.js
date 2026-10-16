// Arranque: lo guardado en SQLite manda y la semilla solo rellena lo que falte.
// Antes se recorrían las claves de la semilla, así que todo lo que el código crea sobre la marcha
// (pedidos marcados del Radar, historial mensual de Predicciones, carpetas de Drive) se ignoraba al
// reiniciar y el siguiente guardado lo borraba para siempre.
function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

// Un JSON guardado puede traer estos nombres como clave propia; asignarlos escribiría en el prototipo
// de todos los objetos del proceso.
const CLAVES_PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

function restaurarEstado(semilla, guardado) {
  const resultado = {};
  for (const modulo of Object.keys(semilla)) resultado[modulo] = { ...semilla[modulo] };
  if (!esObjeto(guardado)) return resultado;
  for (const [modulo, tablas] of Object.entries(guardado)) {
    if (CLAVES_PROHIBIDAS.has(modulo) || !esObjeto(tablas)) continue;
    if (!Object.hasOwn(resultado, modulo)) resultado[modulo] = {};
    for (const [tabla, valor] of Object.entries(tablas)) {
      if (!CLAVES_PROHIBIDAS.has(tabla) && valor !== undefined) resultado[modulo][tabla] = valor;
    }
  }
  return resultado;
}

module.exports = { restaurarEstado };
