// Metas que se cuentan solas (spec 2026-10-22 §4.2): cada fuente lee registros que ya guardan quién (usuario_id)
// y cuándo. Lo que no tiene usuario_id no se le atribuye a nadie. Cada renglón cuenta una vez por su clave.
const { finDePeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");

const HORAS_SEGUIMIENTO = 48;
const FUENTES = ["manual", "radar_seguimiento_a_tiempo", "crm_cambios_estado", "bandeja_respuestas",
  "revisiones_metas_tienda", "visitas_tienda"];
const DESCRIPCION_FUENTES = {
  manual: "Se marca \"Hecho\" con su prueba",
  radar_seguimiento_a_tiempo: "Demandas del Radar a las que diste el primer seguimiento antes de 2 días",
  crm_cambios_estado: "Cambios de estado de clientes que hiciste en el CRM",
  bandeja_respuestas: "Mensajes que respondiste desde la bandeja",
  revisiones_metas_tienda: "Capturas de metas de tienda que revisaste o anulaste",
  visitas_tienda: "Visitas a tienda terminadas y con ubicación comprobada (una por tienda al mes)",
};
const SIN_BANDEJA = "La bandeja de mensajes no está disponible; esta meta no se puede contar ahora";

let conexion = null;
function configurarFuentes({ sqlite }) { conexion = sqlite || null; }

const diaDe = (iso) => fechaLocal(new Date(iso));
function enPeriodo(meta, iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return false;
  const dia = diaDe(iso);
  return dia >= meta.inicio && dia <= finDePeriodo(meta.periodo, meta.inicio);
}
const deTienda = (meta, sucursalId) => meta.sucursal_id == null || Number(sucursalId) === Number(meta.sucursal_id);
const esDe = (meta, usuarioId) => usuarioId != null && Number(usuarioId) === Number(meta.usuario_id);
const resultado = (detalle, aviso = null) => ({ valor: detalle.length, detalle, aviso });
const cambio = (anterior, nuevo) => `${anterior || "sin estado"} → ${nuevo}`;

function tablaExiste(nombre) {
  return !!conexion?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nombre);
}

// El primer seguimiento de cada demanda es el que cuenta, y solo si fue de esta cuenta y antes de 48 h.
function radarSeguimiento(DB, meta) {
  const registros = new Map((DB.radar_demanda?.registros || []).map((r) => [Number(r.id), r]));
  const primero = new Map();
  for (const s of DB.radar_demanda?.seguimientos || []) {
    const previo = primero.get(Number(s.demanda_id));
    if (!previo || Date.parse(s.fecha_hora) < Date.parse(previo.fecha_hora)) primero.set(Number(s.demanda_id), s);
  }
  const detalle = [];
  for (const [demandaId, s] of primero) {
    const registro = registros.get(demandaId);
    if (!registro || !esDe(meta, s.usuario_id) || !enPeriodo(meta, s.fecha_hora) || !deTienda(meta, registro.sucursal_id)) continue;
    const horas = (Date.parse(s.fecha_hora) - Date.parse(registro.fecha_registro)) / 3600000;
    if (horas >= 0 && horas <= HORAS_SEGUIMIENTO) {
      detalle.push({ clave: `radar:${demandaId}`, fecha: diaDe(s.fecha_hora), texto: `Seguimiento a la demanda #${demandaId}` });
    }
  }
  return resultado(detalle);
}

function crmCambios(DB, meta) {
  const tiendaDe = new Map((DB.crm?.clientes || []).map((c) => [Number(c.id), c.sucursal_id]));
  const detalle = (DB.crm?.estados_historial || [])
    .filter((h) => esDe(meta, h.usuario_id) && enPeriodo(meta, h.fecha_hora) && deTienda(meta, tiendaDe.get(Number(h.cliente_id))))
    .map((h) => ({ clave: `crm:${h.id}`, fecha: diaDe(h.fecha_hora), texto: `Cliente #${h.cliente_id}: ${cambio(h.anterior, h.nuevo)}` }));
  if (tablaExiste("sicar_estados_historial")) {
    const filas = conexion.prepare(`SELECT id, sucursal_id, cli_id, anterior, nuevo, fecha_hora
      FROM sicar_estados_historial WHERE usuario_id = ?`).all(Number(meta.usuario_id));
    for (const f of filas) {
      if (!enPeriodo(meta, f.fecha_hora) || !deTienda(meta, f.sucursal_id)) continue;
      detalle.push({ clave: `sicar:${f.id}`, fecha: diaDe(f.fecha_hora), texto: `Cliente SICAR ${f.cli_id}: ${cambio(f.anterior, f.nuevo)}` });
    }
  }
  return resultado(detalle);
}

function bandejaRespuestas(meta) {
  if (!["lead_interacciones", "lead_conversaciones", "lead_fuentes"].every(tablaExiste)) return resultado([], SIN_BANDEJA);
  const filas = conexion.prepare(`SELECT i.id, i.ocurrida_en, f.sucursal_responsable_id AS sucursal_id FROM lead_interacciones i
    JOIN lead_conversaciones c ON c.id = i.conversacion_id LEFT JOIN lead_fuentes f ON f.id = c.fuente_id
    WHERE i.direccion = 'saliente' AND i.usuario_id = ?`).all(Number(meta.usuario_id));
  return resultado(filas.filter((f) => enPeriodo(meta, f.ocurrida_en) && deTienda(meta, f.sucursal_id))
    .map((f) => ({ clave: `msg:${f.id}`, fecha: diaDe(f.ocurrida_en), texto: "Respuesta en la bandeja" })));
}

// Revisar o anular la misma captura cuenta una sola vez.
function revisiones(DB, meta) {
  const detalle = [];
  for (const c of DB.pos?.meta_capturas || []) {
    if (!deTienda(meta, c.sucursal_id)) continue;
    const marca = [c.revisada, c.anulada].find((m) => m && esDe(meta, m.por_id) && enPeriodo(meta, m.en));
    if (marca) detalle.push({ clave: `cap:${c.id}`, fecha: diaDe(marca.en), texto: `Captura #${c.id} revisada` });
  }
  return resultado(detalle);
}

// Una visita por tienda y por mes; sin ubicación comprobada no cuenta (spec §3).
function visitas(DB, meta) {
  const vistas = new Map();
  for (const v of DB.supervision?.visitas || []) {
    if (v.estado !== "terminada" || !v.ubicacion?.comprobada || !esDe(meta, v.supervisor_id)) continue;
    if (!enPeriodo(meta, v.terminada_en) || !deTienda(meta, v.sucursal_id)) continue;
    const clave = `visita:${v.sucursal_id}:${v.mes}`;
    if (!vistas.has(clave)) vistas.set(clave, { clave, fecha: diaDe(v.terminada_en), texto: `Visita a tienda ${v.sucursal_id} (${v.mes})` });
  }
  return resultado([...vistas.values()]);
}

const CONTADORES = {
  radar_seguimiento_a_tiempo: radarSeguimiento, crm_cambios_estado: crmCambios,
  bandeja_respuestas: (DB, meta) => bandejaRespuestas(meta), revisiones_metas_tienda: revisiones, visitas_tienda: visitas,
};

function contarFuente(DB, meta) {
  const contar = CONTADORES[meta.fuente];
  if (!contar) throw new Error(`Fuente de meta desconocida: ${meta.fuente}`);
  return contar(DB, meta);
}

module.exports = { FUENTES, DESCRIPCION_FUENTES, HORAS_SEGUIMIENTO, configurarFuentes, contarFuente };
