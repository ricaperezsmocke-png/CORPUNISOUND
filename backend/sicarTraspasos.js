// Consulta de traspasos tal como los mandaron los agentes de SICAR, mas el mapa de numeros de sucursal SICAR a tienda.
// No se recalcula nada: se muestran las cifras de cada SICAR y las diferencias entre las dos puntas, sin acusar a nadie.
const { fechaLocal } = require('./fechas');

const DIA = 86400000;
const DIAS_POR_DEFECTO = 30;
const MAX_DIAS_RANGO = 366;
const DIAS_SIN_RECIBIR = 3;
const ESTADOS = ['enviado', 'recibido', 'cancelado'];

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
  const filas = sqlite.prepare(`SELECT * FROM sicar_traspasos
    WHERE substr(fecha, 1, 10) BETWEEN @desde AND @hasta
      AND (@tienda IS NULL OR sucursal_id = @tienda) AND (@estado IS NULL OR estado = @estado)
    ORDER BY fecha DESC, sucursal_id, length(tra_id) DESC, tra_id DESC`).all({ desde, hasta, tienda: propia, estado });
  const otraPunta = sqlite.prepare(`SELECT * FROM sicar_traspasos
    WHERE folio = ? AND suc_origen = ? AND suc_destino = ? AND sucursal_id <> ?`);
  const detalle = sqlite.prepare('SELECT art_id, cantidad FROM sicar_traspasos_detalle WHERE sucursal_id = ? AND tra_id = ?');
  const cantidades = fila => {
    const m = new Map();
    for (const d of detalle.all(fila.sucursal_id, fila.tra_id)) m.set(d.art_id, (m.get(d.art_id) ?? 0n) + aDiezmilesimas(d.cantidad));
    return m;
  };

  const traspasos = filas.map(f => {
    const otra = otraPunta.get(f.folio, f.suc_origen, f.suc_destino, f.sucursal_id);
    let diferencias = [], conciliacion = otra ? 'sin_mapa' : 'una_punta';
    const idOrigen = mapa.get(f.suc_origen), idDestino = mapa.get(f.suc_destino);
    if (otra && idOrigen != null && idDestino != null) {
      const origen = [f, otra].find(x => x.sucursal_id === idOrigen);
      const destino = [f, otra].find(x => x.sucursal_id === idDestino);
      if (origen && destino && origen !== destino) {
        conciliacion = 'dos_puntas';
        // Mientras ninguna punta lo haya recibido no hay nada que comparar: no es una perdida.
        if (origen.estado === 'recibido' || destino.estado === 'recibido') diferencias = compararPuntas(origen, destino, cantidades);
      }
    }
    const enTransito = f.estado === 'enviado' ? dias(f.fecha, hoy)
      : f.estado === 'recibido' && f.fecha_aplicado ? dias(f.fecha, f.fecha_aplicado) : null;
    return {
      sucursal_id: f.sucursal_id, tra_id: f.tra_id, folio: f.folio, fecha: f.fecha, estado: f.estado,
      fecha_aplicado: f.fecha_aplicado, fecha_cancelado: f.fecha_cancelado, total: centavosATexto(f.total_centavos),
      origen: nombre(f.suc_origen), destino: nombre(f.suc_destino), suc_origen: f.suc_origen, suc_destino: f.suc_destino,
      dias_en_transito: enTransito, conciliacion, diferencias,
      alertas: {
        sin_recibir_3_dias: f.estado === 'enviado' && otra?.estado !== 'recibido' && enTransito > DIAS_SIN_RECIBIR,
        cancelado: f.estado === 'cancelado',
        con_diferencias: diferencias.length > 0,
      },
    };
  });
  return { desde, hasta, traspasos };
}

function listarMapaSicar(sqlite, nombresTiendas = {}) {
  return sqlite.prepare('SELECT sicar_sucursal, sucursal_id, asignado_por, asignado_en FROM sicar_sucursales_mapa').all()
    .sort((a, b) => Number(a.sicar_sucursal) - Number(b.sicar_sucursal))
    .map(m => ({ ...m, tienda: m.sucursal_id === null ? null : nombresTiendas[m.sucursal_id] ?? null }));
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

module.exports = { consultarTraspasosSicar, listarMapaSicar, asignarMapaSicar };
