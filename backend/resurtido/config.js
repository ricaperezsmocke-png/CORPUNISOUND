const TIENDAS = Object.freeze([1, 2, 3, 4]);
const MARCAS = Object.freeze(['JR', 'SOLCOR']);
const INDICES_SICAR = Object.freeze({
  JR: Object.freeze([0.9, 1, 1.1, 1, 1, 1.1, 0.9, 0.9, 1.1, 1, 1, 1]),
  SOLCOR: Object.freeze([0.9, 0.9, 1.1, 0.8, 0.6, 1.2, 1.1, 0.9, 1.1, 1.3, 1.2, 1]),
});
const VALORES_INICIALES = Object.freeze({
  plazo_dias: 20, ciclo_dias: 30, z_servicio_centesimas: 165, dias_historia: 365,
  dias_validos_minimos: 30, proporcion_cero_sin_historia: 80, dias_datos_atrasados: 2,
});
const error = mensaje => Object.assign(new Error(mensaje), { status: 400 });

function leerConfig(sqlite) {
  const valores = { ...VALORES_INICIALES };
  for (const { clave, valor } of sqlite.prepare('SELECT clave, valor FROM resurtido_config').all()) {
    if (Object.hasOwn(valores, clave)) valores[clave] = Number(valor);
  }
  return valores;
}

function cambiarConfig(sqlite, cambios, actor, ahora = new Date().toISOString()) {
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios) || !Object.keys(cambios).length) {
    throw error('Manda al menos un valor.');
  }
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!Object.hasOwn(VALORES_INICIALES, clave)) throw error(`Valor desconocido: ${clave}.`);
    const porcentaje = clave === 'proporcion_cero_sin_historia';
    const minimo = porcentaje || clave === 'z_servicio_centesimas' ? 0 : 1;
    const maximo = porcentaje ? 100 : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) throw error(`Valor inválido: ${clave}.`);
  }
  return sqlite.transaction(() => {
    const actual = leerConfig(sqlite);
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === actual[clave]) continue;
      sqlite.prepare(`INSERT INTO resurtido_config(clave, valor, actor, fecha) VALUES (?, ?, ?, ?)
        ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actor=excluded.actor, fecha=excluded.fecha`)
        .run(clave, String(valor), actor, ahora);
      sqlite.prepare(`INSERT INTO resurtido_config_historial(clave, anterior, nuevo, actor, fecha) VALUES (?, ?, ?, ?, ?)`)
        .run(clave, String(actual[clave]), String(valor), actor, ahora);
    }
    return leerConfig(sqlite);
  }).immediate();
}

module.exports = { TIENDAS, MARCAS, INDICES_SICAR, VALORES_INICIALES, leerConfig, cambiarConfig };
