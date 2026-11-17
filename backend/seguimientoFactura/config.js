const ORIGENES = Object.freeze([
  { sucursal_id: 6, nombre: 'CEDIS', traslada: true },
  { sucursal_id: 7, nombre: 'Innotec', traslada: false },
]);
const TIENDAS_APARTE = Object.freeze([7]);
const perteneceCadena = (origen, tienda) => TIENDAS_APARTE.includes(Number(origen))
  ? Number(tienda) === Number(origen) : !TIENDAS_APARTE.includes(Number(tienda));
function origenesIncorporados(sqlite) {
  const ids = new Set(sqlite.prepare('SELECT sucursal_id FROM seguimiento_tiendas').all().map(t => t.sucursal_id));
  return ORIGENES.filter(o => ids.has(o.sucursal_id));
}

// La base guarda solo sobrescrituras; los valores iniciales no activan una generación nueva de respaldo.
const VALORES_INICIALES = Object.freeze({
  dias_revisado_caduca: 15,
  dias_posponer_maximo: 30,
  dias_transito_alarma: 7,
  dias_traslado: 45,
  dias_margen_75: 60,
  dias_margen_50: 90,
  dias_liquidacion: 120,
  ganancia_75_porcentaje: 75,
  ganancia_50_porcentaje: 50,
  ganancia_liquidacion_porcentaje: 0,
  semanas_ventas: 8,
  semanas_informativas: 4,
  multiplicador_destino: 2,
  semanas_con_ventas: 2,
  semanas_cobertura_destino: 4,
  semanas_reserva_origen: 2,
  dias_datos_atrasados: 2,
  horas_foto_vieja: 24,
});

function leerConfig(sqlite) {
  return { ...VALORES_INICIALES,
    ...Object.fromEntries(sqlite.prepare('SELECT clave, valor FROM seguimiento_config').all()
      .map(({ clave, valor }) => [clave, Number(valor)])),
  };
}

module.exports = { VALORES_INICIALES, leerConfig, ORIGENES, TIENDAS_APARTE, perteneceCadena, origenesIncorporados };
