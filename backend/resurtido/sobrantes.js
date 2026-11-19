// Sobrante de una tienda = lo que tiene arriba de su máximo, menos lo ya apartado para otra tienda. Nunca deja a la
// donante abajo de su máximo. Solo cuenta piezas enteras y tiendas con datos al día.
const PIEZA = 10000;
const NOMBRES = Object.freeze({ 1: 'Ocosingo', 2: 'Yajalón', 3: 'San Cristóbal', 4: 'Palenque' });

function reservasVivas(sqlite, ahora) {
  const vivas = new Map();
  for (const r of sqlite.prepare("SELECT donante, clave, SUM(piezas) piezas FROM resurtido_reservas WHERE estado='viva' AND vence>? GROUP BY donante, clave")
    .all(ahora)) vivas.set(`${r.donante}|${r.clave}`, r.piezas);
  return vivas;
}

// Map clave → [{ sucursal_id, piezas }] de mayor a menor sobrante.
function calcularSobrantes(filas, atrasadas, reservas) {
  const porClave = new Map();
  for (const f of filas) {
    if (atrasadas.includes(f.sucursal_id) || f.ya_no_la_maneja || f.ya_no_es_marca) continue;
    const libre = f.existencia - f.maximo - (reservas.get(`${f.sucursal_id}|${f.clave}`) || 0);
    const piezas = Math.floor(libre / PIEZA) * PIEZA;
    if (piezas <= 0) continue;
    if (!porClave.has(f.clave)) porClave.set(f.clave, []);
    porClave.get(f.clave).push({ sucursal_id: f.sucursal_id, piezas });
  }
  for (const lista of porClave.values()) lista.sort((a, b) => b.piezas - a.piezas || a.sucursal_id - b.sucursal_id);
  return porClave;
}

module.exports = { reservasVivas, calcularSobrantes, NOMBRES, PIEZA };
