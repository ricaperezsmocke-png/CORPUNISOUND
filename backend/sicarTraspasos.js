// Consulta de traspasos tal como los mandaron los agentes de SICAR, mas el mapa de numeros de sucursal SICAR a tienda.
// No se recalcula nada: se muestran las cifras de cada SICAR y las diferencias entre las dos puntas, sin acusar a nadie.
const { fechaLocal } = require('./fechas');

const DIA = 86400000;
const DIAS_POR_DEFECTO = 30;
const MAX_DIAS_RANGO = 366;
const DIAS_SIN_RECIBIR = 3;
const ESTADOS = ['enviado', 'recibido', 'cancelado'];

// Motivo claro de cada codigo con que el agente omite un traspaso (sicarRepositorio guarda OTRO si no lo conoce).
const MOTIVOS_OMITIDO = {
  DETALLE_FUERA_DE_LIMITE: 'No tiene artículos o tiene más de 500 artículos distintos; el sistema no lo acepta',
  ESTADO_TRASPASO_DESCONOCIDO: 'Estado desconocido en SICAR',
  FECHA_INVALIDA: 'Fecha imposible',
  TEXTO_VACIO: 'Folio vacío',
  TEXTO_INVALIDO: 'Folio demasiado largo o con caracteres que no se pueden leer',
  ID_INVALIDO: 'Artículo repetido, o número de artículo o de sucursal inválido',
  DECIMAL_INVALIDO: 'Cantidad o importe que no es un número',
  PRECISION_NO_PACTADA: 'Cantidad o importe con más decimales de los permitidos',
  IMPORTE_EXCESIVO: 'Cantidad o importe demasiado grande',
  OTRO: 'Dato que el sistema no sabe leer',
};

const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function filtroFecha(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const texto = typeof valor === 'string' ? valor : '';
  const d = new Date(`${texto}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) {
    throw fallo(400, `La fecha ${campo} es inválida.`);
  }
  return texto;
}

// Alcance solo de quien pregunta (regla 5): ver todas, o la tienda de su token. Sin tienda valida no ve nada.
function tiendaDelAlcance(alcance) {
  if (alcance?.verTodas) return null;
  const propia = Number(alcance?.sucursalId);
  if (!Number.isSafeInteger(propia) || propia <= 0) throw fallo(403, 'No tienes una tienda autorizada.');
  return propia;
}

const diaMs = texto => Date.parse(`${texto.slice(0, 10)}T00:00:00Z`);
const dias = (desde, hasta) => Math.round((diaMs(hasta) - diaMs(desde)) / DIA);

// "12.3400" -> 123400n (diezmilesimas), exacto y sin flotantes.
function aDiezmilesimas(texto) {
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(texto));
  if (!m) return 0n;
  const n = BigInt(m[2]) * 10000n + BigInt((m[3] ?? '').padEnd(4, '0'));
  return m[1] ? -n : n;
}

function diezmilesimasATexto(valor) {
  const abs = valor < 0n ? -valor : valor;
  return `${valor < 0n ? '-' : ''}${abs / 10000n}.${String(abs % 10000n).padStart(4, '0')}`;
}

function centavosATexto(valor) {
  const n = BigInt(valor);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function leerMapa(sqlite) {
  return new Map(sqlite.prepare('SELECT sicar_sucursal, sucursal_id FROM sicar_sucursales_mapa').all()
    .map(m => [m.sicar_sucursal, m.sucursal_id]));
}

// Diferencias por articulo entre lo que salio del origen y lo que quedo registrado en el destino.
function compararPuntas(origen, destino, cantidades) {
  const env = cantidades(origen), rec = cantidades(destino);
  const diferencias = [];
  for (const art of [...new Set([...env.keys(), ...rec.keys()])].sort()) {
    const e = env.get(art) ?? 0n, r = rec.get(art) ?? 0n;
    if (e !== r) {
      diferencias.push({ art_id: art, enviado: diezmilesimasATexto(e), recibido: diezmilesimasATexto(r), diferencia: diezmilesimasATexto(r - e) });
    }
  }
  return diferencias;
}

function consultarTraspasosSicar(sqlite, filtros = {}, alcance, nombresTiendas = {}, hoy = fechaLocal()) {
  const propia = tiendaDelAlcance(alcance);
  const hasta = filtroFecha(filtros.hasta, 'hasta') ?? hoy;
  const desde = filtroFecha(filtros.desde, 'desde')
    ?? new Date(diaMs(hoy) - (DIAS_POR_DEFECTO - 1) * DIA).toISOString().slice(0, 10);
  if (dias(desde, hasta) > MAX_DIAS_RANGO) throw fallo(400, `El rango de fechas no puede pasar de ${MAX_DIAS_RANGO} días.`);
  const estado = filtros.estado === undefined || filtros.estado === '' ? null : filtros.estado;
  if (estado !== null && !ESTADOS.includes(estado)) throw fallo(400, 'El estado es inválido.');

  const mapa = leerMapa(sqlite);
  const nombre = n => (mapa.has(n) && nombresTiendas[mapa.get(n)]) || `SICAR ${n}`;
  const limiteViejos = new Date(diaMs(hoy) - (DIAS_SIN_RECIBIR + 1) * DIA).toISOString().slice(0, 10);
  const filas = sqlite.prepare(`SELECT * FROM sicar_traspasos
    WHERE (@tienda IS NULL OR sucursal_id = @tienda)
      AND ((substr(fecha, 1, 10) BETWEEN @desde AND @hasta AND (@estado IS NULL OR estado = @estado))
        OR (estado = 'enviado' AND (@estado IS NULL OR @estado = 'enviado') AND substr(fecha, 1, 10) <= @limite))
    ORDER BY fecha DESC, sucursal_id, length(tra_id) DESC, tra_id DESC`)
    .all({ desde, hasta, tienda: propia, estado, limite: limiteViejos });
  const candidatas = sqlite.prepare(`SELECT * FROM sicar_traspasos
    WHERE folio = ? AND suc_origen = ? AND suc_destino = ? AND sucursal_id = ?`);
  const detalle = sqlite.prepare('SELECT art_id, cantidad FROM sicar_traspasos_detalle WHERE sucursal_id = ? AND tra_id = ?');
  const cantidades = fila => {
    const m = new Map();
    for (const d of detalle.all(fila.sucursal_id, fila.tra_id)) m.set(d.art_id, (m.get(d.art_id) ?? 0n) + aDiezmilesimas(d.cantidad));
    return m;
  };

  const traspasos = [];
  for (const f of filas) {
    let otra = null, diferencias = [], ambiguas = false, conciliacion;
    const idOrigen = mapa.get(f.suc_origen), idDestino = mapa.get(f.suc_destino);
    if (idOrigen == null || idDestino == null) conciliacion = 'sin_mapa';
    else if (idOrigen === idDestino || (f.sucursal_id !== idOrigen && f.sucursal_id !== idDestino)) conciliacion = 'mapa_no_coincide';
    else {
      const contraria = f.sucursal_id === idOrigen ? idDestino : idOrigen;
      const lista = candidatas.all(f.folio, f.suc_origen, f.suc_destino, contraria);
      conciliacion = lista.length === 0 ? 'una_punta' : 'dos_puntas';
      if (lista.length > 1) { ambiguas = true; conciliacion = 'ambigua'; }
      else if (lista.length === 1) {
        otra = lista[0];
        const [origen, destino] = f.sucursal_id === idOrigen ? [f, otra] : [otra, f];
        // Mientras ninguna punta lo haya recibido no hay nada que comparar: no es una perdida.
        if (origen.estado === 'recibido' || destino.estado === 'recibido') diferencias = compararPuntas(origen, destino, cantidades);
      }
    }
    const enTransito = f.estado === 'enviado' ? dias(f.fecha, hoy)
      : f.estado === 'recibido' && f.fecha_aplicado ? dias(f.fecha, f.fecha_aplicado) : null;
    const sinRecibir = f.estado === 'enviado' && !(conciliacion === 'dos_puntas' && otra?.estado === 'recibido') && enTransito > DIAS_SIN_RECIBIR;
    // Un envio viejo entra aunque no caiga en el rango solo si de verdad sigue sin recibirse.
    const enRango = f.fecha.slice(0, 10) >= desde && f.fecha.slice(0, 10) <= hasta && (estado === null || f.estado === estado);
    if (!enRango && !sinRecibir) continue;
    traspasos.push({
      sucursal_id: f.sucursal_id, tra_id: f.tra_id, folio: f.folio, fecha: f.fecha, estado: f.estado,
      fecha_aplicado: f.fecha_aplicado, fecha_cancelado: f.fecha_cancelado, total: centavosATexto(f.total_centavos),
      origen: nombre(f.suc_origen), destino: nombre(f.suc_destino), suc_origen: f.suc_origen, suc_destino: f.suc_destino,
      dias_en_transito: enTransito, conciliacion, diferencias,
      alertas: {
        sin_recibir_3_dias: sinRecibir,
        cancelado: f.estado === 'cancelado',
        con_diferencias: diferencias.length > 0,
        sin_conciliar: conciliacion === 'sin_mapa' || conciliacion === 'mapa_no_coincide',
        puntas_ambiguas: ambiguas,
      },
    });
  }
  // Omitidos: sin filtro de fechas ni de estado; se ven hasta que el traspaso llegue valido. Mismo alcance de tienda.
  const omitidos = sqlite.prepare(`SELECT sucursal_id, tra_id, codigo, primera_vez, ultima_vez FROM sicar_traspasos_omitidos
    WHERE (@tienda IS NULL OR sucursal_id = @tienda) ORDER BY sucursal_id, length(tra_id), tra_id`).all({ tienda: propia })
    .map(o => ({ sucursal_id: o.sucursal_id, tienda: nombresTiendas[o.sucursal_id] ?? `Tienda ${o.sucursal_id}`, tra_id: o.tra_id,
      codigo: o.codigo, motivo: MOTIVOS_OMITIDO[o.codigo] ?? MOTIVOS_OMITIDO.OTRO, primera_vez: o.primera_vez, ultima_vez: o.ultima_vez }));
  return { desde, hasta, traspasos, omitidos };
}

function listarMapaSicar(sqlite, nombresTiendas = {}) {
  return sqlite.prepare('SELECT sicar_sucursal, sucursal_id, asignado_por, asignado_en FROM sicar_sucursales_mapa').all()
    .sort((a, b) => Number(a.sicar_sucursal) - Number(b.sicar_sucursal))
    .map(m => ({ ...m, tienda: m.sucursal_id === null ? null : nombresTiendas[m.sucursal_id] ?? null }));
}

// Numeros SICAR (origen o destino) que aparecen en traspasos y no tienen tienda asignada, dentro del alcance de quien pregunta.
function listarSinAsignarSicar(sqlite, alcance) {
  const propia = tiendaDelAlcance(alcance);
  const filas = sqlite.prepare(`SELECT suc_origen AS n FROM sicar_traspasos WHERE (@t IS NULL OR sucursal_id = @t)
    UNION SELECT suc_destino FROM sicar_traspasos WHERE (@t IS NULL OR sucursal_id = @t)`).all({ t: propia });
  const mapa = leerMapa(sqlite);
  return filas.map(f => f.n).filter(n => mapa.get(n) == null).sort((x, y) => Number(x) - Number(y) || (x < y ? -1 : 1));
}

// El mapa es de toda la empresa: cambiarlo cambia los nombres que ven todas las tiendas. Solo con alcance total.
function asignarMapaSicar(sqlite, datos, actor, alcance, tiendaExiste) {
  if (tiendaDelAlcance(alcance) !== null) throw fallo(403, 'El mapa de sucursales es de toda la empresa.');
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw fallo(400, 'Solicitud inválida.');
  const sicar = typeof datos.sicar_sucursal === 'number' ? String(datos.sicar_sucursal) : datos.sicar_sucursal;
  if (typeof sicar !== 'string' || !/^[1-9]\d{0,8}$/.test(sicar)) throw fallo(400, 'El número de sucursal SICAR es inválido.');
  let nuevo = datos.sucursal_id;
  if (nuevo !== null) {
    const n = Number(nuevo);
    if (!['number', 'string'].includes(typeof nuevo) || nuevo === '' || !Number.isSafeInteger(n) || n <= 0) throw fallo(400, 'La tienda es inválida.');
    if (!tiendaExiste(n)) throw fallo(400, 'La tienda no existe.');
    nuevo = n;
  }
  const quien = String(actor ?? '');
  if (!quien) throw fallo(401, 'No autenticado.');
  return sqlite.transaction(() => {
    const anterior = sqlite.prepare('SELECT * FROM sicar_sucursales_mapa WHERE sicar_sucursal = ?').get(sicar);
    if (anterior && anterior.sucursal_id === nuevo) return anterior;
    if (nuevo !== null && sqlite.prepare('SELECT 1 FROM sicar_sucursales_mapa WHERE sucursal_id = ? AND sicar_sucursal <> ?').get(nuevo, sicar)) {
      throw fallo(400, 'Esa tienda ya tiene otro número de sucursal SICAR asignado.');
    }
    const fila = { sicar_sucursal: sicar, sucursal_id: nuevo, asignado_por: quien, asignado_en: new Date().toISOString() };
    sqlite.prepare(`INSERT INTO sicar_sucursales_mapa (sicar_sucursal, sucursal_id, asignado_por, asignado_en)
      VALUES (@sicar_sucursal, @sucursal_id, @asignado_por, @asignado_en)
      ON CONFLICT(sicar_sucursal) DO UPDATE SET sucursal_id = excluded.sucursal_id, asignado_por = excluded.asignado_por,
        asignado_en = excluded.asignado_en`).run(fila);
    sqlite.prepare(`INSERT INTO sicar_sucursales_mapa_historial (sicar_sucursal, anterior, nuevo, actor, fecha)
      VALUES (?, ?, ?, ?, ?)`).run(sicar, anterior?.sucursal_id == null ? null : String(anterior.sucursal_id),
      nuevo === null ? null : String(nuevo), quien, fila.asignado_en);
    return fila;
  }).immediate();
}

module.exports = { consultarTraspasosSicar, listarMapaSicar, listarSinAsignarSicar, asignarMapaSicar };
