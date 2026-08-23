const MOTIVOS_DEMANDA = Object.freeze([
  "SIN_EXISTENCIA",
  "NO_MANEJAMOS",
  "OTRA_MARCA",
  "OTRA_VARIANTE",
  "PRECIO",
  "TIEMPO_ENTREGA",
  "OTRO",
]);

const ESTADOS_DEMANDA = Object.freeze([
  "REGISTRADA",
  "EN_SEGUIMIENTO",
  "PRODUCTO_DISPONIBLE",
  "CLIENTE_CONTACTADO",
  "CONVERTIDA",
  "NO_CONVERTIDA",
  "CANCELADA",
]);

const TRANSICIONES_PERMITIDAS = Object.freeze({
  REGISTRADA: Object.freeze([
    "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO",
    "CONVERTIDA", "NO_CONVERTIDA", "CANCELADA",
  ]),
  EN_SEGUIMIENTO: Object.freeze([
    "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO", "CONVERTIDA",
    "NO_CONVERTIDA", "CANCELADA",
  ]),
  PRODUCTO_DISPONIBLE: Object.freeze([
    "EN_SEGUIMIENTO", "CLIENTE_CONTACTADO", "CONVERTIDA",
    "NO_CONVERTIDA", "CANCELADA",
  ]),
  CLIENTE_CONTACTADO: Object.freeze([
    "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CONVERTIDA",
    "NO_CONVERTIDA", "CANCELADA",
  ]),
  CONVERTIDA: Object.freeze([]),
  NO_CONVERTIDA: Object.freeze([]),
  CANCELADA: Object.freeze([]),
});

const CAMPOS_INMUTABLES = new Set([
  "id", "usuario_id", "vendedor_id", "sucursal_id", "fecha_registro",
  "producto_nombre_registrado", "producto_sku_registrado", "estado",
]);

const CAMPOS_EDITABLES = new Set([
  "cliente_id", "producto_id", "producto_buscado", "marca_solicitada",
  "modelo_solicitado", "variante_solicitada", "categoria_solicitada",
  "cantidad", "motivo_no_venta", "notas", "requiere_seguimiento",
  "nombre_contacto", "telefono_contacto", "fecha_seguimiento",
  "venta_recuperada_id",
]);

function normalizarRadarDemanda(DB) {
  if (!DB.radar_demanda || typeof DB.radar_demanda !== "object") {
    DB.radar_demanda = {};
  }
  if (!Array.isArray(DB.radar_demanda.registros)) DB.radar_demanda.registros = [];
  if (!Array.isArray(DB.radar_demanda.seguimientos)) DB.radar_demanda.seguimientos = [];
  const ahora = new Date().toISOString();
  DB.radar_demanda.registros = DB.radar_demanda.registros
    .filter((item) => item && typeof item === "object");
  DB.radar_demanda.registros.forEach((item) => {
    Object.assign(item, {
      cliente_id: null, producto_id: null,
      producto_nombre_registrado: "", producto_sku_registrado: "",
      producto_buscado: "", marca_solicitada: "", modelo_solicitado: "",
      variante_solicitada: "", categoria_solicitada: "", cantidad: 1,
      motivo_no_venta: "OTRO", notas: "", requiere_seguimiento: false,
      intencion_compra: false, consentimiento_aviso: false, fecha_vinculacion_crm: null,
      nombre_contacto: "", telefono_contacto: "", estado: "REGISTRADA",
      fecha_seguimiento: null, fecha_registro: ahora,
      fecha_actualizacion: item.fecha_registro || ahora,
      venta_recuperada_id: null, vendedor_id: null,
      ...item,
    });
  });
  DB.radar_demanda.seguimientos = DB.radar_demanda.seguimientos
    .filter((item) => item && typeof item === "object");
  DB.radar_demanda.seguimientos.forEach((item) => {
    Object.assign(item, {
      usuario_id: null, fecha_hora: ahora, tipo: "SEGUIMIENTO", comentario: "",
      estado_anterior: null, estado_nuevo: null, ...item,
    });
  });
  const ultimoRegistro = DB.radar_demanda.registros.reduce(
    (max, item) => Math.max(max, Number(item.id) || 0), 0
  );
  const ultimoSeguimiento = DB.radar_demanda.seguimientos.reduce(
    (max, item) => Math.max(max, Number(item.id) || 0), 0
  );
  DB.radar_demanda.ultimo_id = Math.max(
    Number.isInteger(DB.radar_demanda.ultimo_id) ? DB.radar_demanda.ultimo_id : 0,
    ultimoRegistro
  );
  DB.radar_demanda.ultimo_seguimiento_id = Math.max(
    Number.isInteger(DB.radar_demanda.ultimo_seguimiento_id)
      ? DB.radar_demanda.ultimo_seguimiento_id : 0,
    ultimoSeguimiento
  );
  return DB.radar_demanda;
}

function copiar(valor) {
  if (valor === undefined) return undefined;
  return JSON.parse(JSON.stringify(valor));
}

function texto(valor) {
  return valor == null ? "" : String(valor).trim();
}

function siguienteId(radar, campo, lista) {
  const maximoReal = lista.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  radar[campo] = Math.max(Number(radar[campo]) || 0, maximoReal) + 1;
  return radar[campo];
}

module.exports = {
  MOTIVOS_DEMANDA,
  ESTADOS_DEMANDA,
  TRANSICIONES_PERMITIDAS,
  CAMPOS_INMUTABLES,
  CAMPOS_EDITABLES,
  normalizarRadarDemanda,
  copiar,
  texto,
  siguienteId,
};
