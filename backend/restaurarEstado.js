// Arranque: lo guardado en SQLite manda y la semilla solo rellena lo que falte.
// Antes se recorrían las claves de la semilla, así que todo lo que el código crea sobre la marcha
// (pedidos marcados del Radar, historial mensual de Predicciones, carpetas de Drive) se ignoraba al
// reiniciar y el siguiente guardado lo borraba para siempre.
function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function restaurarEstado(semilla, guardado) {
  const resultado = {};
  for (const modulo of Object.keys(semilla)) resultado[modulo] = { ...semilla[modulo] };
  if (!esObjeto(guardado)) return resultado;
  for (const [modulo, tablas] of Object.entries(guardado)) {
    if (!esObjeto(tablas)) continue;
    if (!resultado[modulo]) resultado[modulo] = {};
    for (const [tabla, valor] of Object.entries(tablas)) {
      if (valor !== undefined) resultado[modulo][tabla] = valor;
    }
  }
  return resultado;
}

module.exports = { restaurarEstado };
