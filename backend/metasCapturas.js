// Captura de metas personalizadas: la persona marca "Hecho" con su prueba y cuenta al momento
// (decisión de Victor 2026-10-08). La jefatura revisa y anula con motivo. Una liga o una foto
// solo cuenta una vez en todo el sistema (metas y actividades).
const { metaVigente, periodoSellado, motivoObligatorio } = require("./metasPersonalizadas");
const { finDePeriodo } = require("./metasPeriodos");
const { normalizarLink, prepararEvidencia, subidasEnCurso } = require("./objetivosActividades");
const { validarFechaYPlantilla, fechaValida } = require("./objetivosFechas");
const { fechaLocal } = require("./fechas");

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function linkGuardado(link) {
  try { return normalizarLink(link); } catch { return link; }
}

function validarEvidenciaUnica(DB, evidencia) {
  if (!evidencia) return;
  const enMetas = DB.pos.meta_capturas.filter((c) => !c.anulada && c.evidencia?.tipo === evidencia.tipo);
  const enActividades = (DB.pos.objetivo_actividades || []).filter((r) => r.vigente && r.evidencia?.tipo === evidencia.tipo);
  if (evidencia.tipo === "link") {
    if ([...enMetas, ...enActividades].some((r) => linkGuardado(r.evidencia.link) === evidencia.link)) {
      throw new Error("Esta liga ya se usó como prueba; no puede contar dos veces");
    }
    return;
  }
  const enInventarios = (DB.pos.objetivo_inventarios || []).some((r) => (r.evidencias || []).some((e) => e.huella === evidencia.huella));
  if (enInventarios || [...enMetas, ...enActividades].some((r) => r.evidencia.huella === evidencia.huella)) {
    throw new Error("Esta foto ya se usó como prueba; no puede contar dos veces");
  }
}

function validarParticipacion(DB, meta, vendedor_id, fecha) {
  if (vendedor_id === null || vendedor_id === undefined) throw new Error("Tu cuenta no está ligada a un vendedor");
  if (meta.alcance === "persona") {
    if (vendedor_id !== meta.vendedor_id) throw new Error("Esta meta no es tuya");
    return meta.sucursal_id;
  }
  if (meta.alcance === "empresa") {
    if (!meta.participantes.includes(vendedor_id)) throw new Error("No participas en esta meta");
    const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
    if (!vendedor) throw new Error("El vendedor no existe");
    return vendedor.sucursal_id;
  }
  // Meta de tienda: solo quien ese día está en esa tienda (plantilla del mes o tienda del vendedor).
  validarFechaYPlantilla(DB, { mes: fecha.slice(0, 7), fecha, sucursal_id: meta.sucursal_id, vendedor_id });
  return meta.sucursal_id;
}

function cantidadYEvidencia(meta, datos) {
  if (meta.prueba === "ninguna") {
    if ((datos.link !== undefined && datos.link !== null) || (datos.archivo !== undefined && datos.archivo !== null)) {
      throw new Error("Esta meta no lleva prueba; captura solo la cantidad");
    }
    if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1 || datos.cantidad > 1000) {
      throw new Error("La cantidad debe ser un entero entre 1 y 1000");
    }
    return { cantidad: datos.cantidad, evidencia: null, buffer: null };
  }
  if (datos.cantidad !== undefined && datos.cantidad !== null && datos.cantidad !== 1) {
    throw new Error("Con prueba, cada captura cuenta 1; la cantidad no se puede cambiar");
  }
  const { evidencia, buffer } = prepararEvidencia({ evidencia: meta.prueba === "liga" ? "link" : "foto" }, datos);
  return { cantidad: 1, evidencia, buffer: buffer || null };
}

function normalizarNota(nota) {
  if (nota === undefined || nota === null) return null;
  if (typeof nota !== "string") throw new Error("La nota debe ser texto");
  const limpio = nota.trim();
  if (limpio.length > 300) throw new Error("La nota no puede tener más de 300 caracteres");
  return limpio || null;
}

function exigirAbierto(DB, meta) {
  if (periodoSellado(DB, meta.periodo, meta.inicio)) throw new Error("El periodo ya está sellado; no se puede capturar");
}

async function subirFoto(DB, meta, datos, { evidencia, buffer, vendedor_id, sucursal_id, drive }) {
  if (subidasEnCurso.has(evidencia.huella)) throw new Error("Ya se está subiendo esta foto; inténtalo de nuevo al terminar");
  subidasEnCurso.add(evidencia.huella);
  try {
    const sucursal = DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id };
    const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
    const carpetaId = await drive.asegurarCarpetaActividadesSucursal(DB, sucursal);
    const subido = await drive.subirArchivoADrive(DB, {
      nombre: `${datos.fecha} - ${vendedor?.nombre || vendedor_id} - meta ${meta.clave} - ${evidencia.nombre_archivo}`,
      mimeType: datos.archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
    });
    if (!subido || !subido.id || !subido.webViewLink) throw new Error("Drive no confirmó la subida de la foto; inténtalo de nuevo");
    // Durante Drive pudo entrar la misma foto por otro lado: se rechaza aquí y solo queda un
    // archivo huérfano en Drive, nunca una captura guardada a medias.
    validarEvidenciaUnica(DB, evidencia);
    evidencia.drive_file_id = subido.id;
    evidencia.drive_link = subido.webViewLink;
  } finally {
    subidasEnCurso.delete(evidencia.huella);
  }
}

async function capturarMeta(DB, clave, datos, { usuario, vendedor_id, drive, antesDeGuardar, hoy = fechaLocal(new Date()) }) {
  const meta = metaVigente(DB, clave);
  if (!meta) throw new Error("La meta no existe o fue eliminada");
  exigirAbierto(DB, meta);
  const fecha = datos?.fecha;
  if (!fechaValida(fecha)) throw new Error("La fecha debe tener formato AAAA-MM-DD y ser válida");
  if (fecha > hoy) throw new Error("No se puede capturar una fecha futura");
  if (fecha < meta.inicio || fecha > finDePeriodo(meta.periodo, meta.inicio)) {
    throw new Error("La fecha no cae dentro del periodo de la meta");
  }
  const sucursal_id = validarParticipacion(DB, meta, vendedor_id, fecha);
  const nota = normalizarNota(datos.nota);
  const { cantidad, evidencia, buffer } = cantidadYEvidencia(meta, datos);
  validarEvidenciaUnica(DB, evidencia);
  if (evidencia?.tipo === "foto") await subirFoto(DB, meta, datos, { evidencia, buffer, vendedor_id, sucursal_id, drive });
  if (antesDeGuardar) antesDeGuardar();
  // El periodo pudo sellarse mientras subía la foto.
  exigirAbierto(DB, meta);
  const captura = {
    id: siguienteId(DB.pos.meta_capturas), meta_clave: meta.clave, meta_id: meta.id, periodo: meta.periodo, inicio: meta.inicio,
    fecha, vendedor_id, sucursal_id, cantidad, evidencia, nota,
    creado_por_id: usuario?.id ?? null, creado_por: usuario?.nombre || "desconocido", creado_en: new Date().toISOString(),
    anulada: null,
  };
  DB.pos.meta_capturas.push(captura);
  return captura;
}

function anularCaptura(DB, id, motivo, usuario) {
  const captura = DB.pos.meta_capturas.find((c) => c.id === Number(id));
  if (!captura) throw new Error("La captura no existe");
  if (captura.anulada) throw new Error("La captura ya está anulada");
  if (periodoSellado(DB, captura.periodo, captura.inicio)) throw new Error("El periodo ya está sellado; no se puede anular");
  captura.anulada = { por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido",
    en: new Date().toISOString(), motivo: motivoObligatorio(motivo, "Anular una captura") };
  return captura;
}

function capturaParaRespuesta(captura) {
  if (captura.evidencia?.tipo !== "foto") return { ...captura };
  const { drive_file_id: _oculto, ...evidencia } = captura.evidencia;
  return { ...captura, evidencia };
}

module.exports = { capturarMeta, anularCaptura, capturaParaRespuesta };
