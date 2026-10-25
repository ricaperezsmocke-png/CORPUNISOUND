const HORA = 3600000;
const POR_PAGINA = 50;
const VENCE_FILA_HORAS = 36;
const SIN_CONTACTO_HORAS = 24;
// Va despues de cualquier clave real al ordenar: los articulos sin clave quedan al final.
const DESPUES_DE_TODA_CLAVE = '\uFFFF';

// Entero en diezmilesimas -> texto con 4 decimales, sin aritmetica binaria.
function diezmilesimasATexto(valor) {
  const n = BigInt(valor);
  const abs = n < 0n ? -n : n;
  const entero = abs / 10000n;
  const fraccion = String(abs % 10000n).padStart(4, '0');
  return `${n < 0n ? '-' : ''}${entero}.${fraccion}`;
}

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function consultarExistenciasSicar(sqlite, { q, solo, pagina } = {}, ahora = new Date(), nombres = {}) {
  const ms = ahora.getTime();
  const filas = sqlite.prepare(`SELECT e.sucursal_id, e.art_id, e.existencia_diezmilesimas AS cant, e.actualizado_en,
      a.clave, a.descripcion, a.categoria, a.departamento
    FROM sicar_existencias e
    LEFT JOIN sicar_articulos a ON a.sucursal_id = e.sucursal_id AND a.art_id = e.art_id
    ORDER BY e.sucursal_id, e.art_id`).all();
  const tiendas = sqlite.prepare(`SELECT t.sucursal_id AS id, t.ultima_recepcion AS ultimo_contacto,
      (SELECT MAX(actualizado_en) FROM sicar_existencias e WHERE e.sucursal_id = t.sucursal_id) AS ultimo_cambio
    FROM sicar_tiendas t ORDER BY t.sucursal_id`).all().map(t => ({
    id: t.id,
    nombre: nombres[t.id] ?? `Tienda ${t.id}`,
    ultimo_contacto: t.ultimo_contacto,
    ultimo_cambio: t.ultimo_cambio,
    sin_contacto_24h: !t.ultimo_contacto || ms - Date.parse(t.ultimo_contacto) > SIN_CONTACTO_HORAS * HORA,
  }));

  const grupos = new Map();
  for (const f of filas) {
    const clave = f.clave ? String(f.clave).trim() : '';
    const llave = clave ? `c:${clave}` : `s:${f.sucursal_id}:${f.art_id}`;
    let g = grupos.get(llave);
    if (!g) {
      g = { clave: clave || null, descripcion: f.descripcion || `Artículo ${f.art_id}`, departamento: f.departamento ?? null,
        categoria: f.categoria ?? null, por_tienda: {}, suma: 0n, negativa: false };
      grupos.set(llave, g);
    }
    if (!g.descripcion || g.descripcion.startsWith('Artículo ')) g.descripcion = f.descripcion || g.descripcion;
    const vencida = ms - Date.parse(f.actualizado_en) > VENCE_FILA_HORAS * HORA;
    g.por_tienda[f.sucursal_id] = { existencia: diezmilesimasATexto(f.cant), sin_confirmar_desde: vencida ? f.actualizado_en : null };
    if (!vencida) g.suma += BigInt(f.cant);
    if (f.cant < 0) g.negativa = true;
  }

  const modo = solo === 'negativas' || solo === 'todas' ? solo : 'con';
  const busqueda = normalizar(q).trim();
  let renglones = [...grupos.values()].filter(g => {
    if (modo === 'con' && g.suma <= 0n) return false;
    if (modo === 'negativas' && !g.negativa) return false;
    return !busqueda || normalizar(g.clave).includes(busqueda) || normalizar(g.descripcion).includes(busqueda);
  });
  renglones.sort((a, b) => (a.clave ?? DESPUES_DE_TODA_CLAVE).localeCompare(b.clave ?? DESPUES_DE_TODA_CLAVE) || a.descripcion.localeCompare(b.descripcion));
  const paginas = Math.max(1, Math.ceil(renglones.length / POR_PAGINA));
  const pedida = Number.parseInt(pagina, 10);
  const actual = Math.min(paginas, Number.isSafeInteger(pedida) && pedida > 0 ? pedida : 1);
  renglones = renglones.slice((actual - 1) * POR_PAGINA, actual * POR_PAGINA).map(g => ({
    clave: g.clave, descripcion: g.descripcion, departamento: g.departamento, categoria: g.categoria,
    por_tienda: g.por_tienda, total: diezmilesimasATexto(g.suma),
  }));
  return { tiendas, renglones, pagina: actual, paginas };
}

module.exports = { consultarExistenciasSicar, diezmilesimasATexto };
