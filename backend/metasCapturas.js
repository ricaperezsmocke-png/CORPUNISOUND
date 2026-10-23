// Captura de metas personalizadas: la persona marca "Hecho" con su prueba y cuenta al momento
// (decisión de Victor 2026-10-08). La jefatura revisa y anula con motivo. Una liga o una foto
// solo cuenta una vez en todo el sistema (metas y actividades).
const { metaVigente, periodoSellado, motivoObligatorio, fuenteDe } = require("./metasPersonalizadas");
const { finDePeriodo } = require("./metasPeriodos");
const { clavePublicacion, prepararEvidencia, subidasEnCurso } = require("./objetivosActividades");
const { validarFechaYPlantilla, fechaValida } = require("./objetivosFechas");
const { fechaLocal } = require("./fechas");

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function validarEvidenciaUnica(DB, evidencia) {
  if (!evidencia) return;
  const enMetas = DB.pos.meta_capturas.filter((c) => !c.anulada && c.evidencia?.tipo === evidencia.tipo);
  const enActividades = (DB.pos.objetivo_actividades || []).filter((r) => r.vigente && r.evidencia?.tipo === evidencia.tipo);
  if (evidencia.tipo === "link") {
    const clave = clavePublicacion(evidencia.link);
    if ([...enMetas, ...enActividades].some((r) => clavePublicacion(r.evidencia.link) === clave)) {
      throw new Error("Esta liga ya se usó como prueba; no puede contar dos veces");
    }
    return;
  }
  const enInventarios = (DB.pos.objetivo_inventarios || []).some((r) => (r.evidencias || []).some((e) => e.huella === evidencia.huella));
  if (enInventarios || [...enMetas, ...enActividades].some((r) => r.evidencia.huella === evidencia.huella)) {
    throw new Error("Esta foto ya se usó como prueba; no puede contar dos veces");
  }
}

function validarParticipacion(DB, meta, vendedor_id, fecha, usuario_id = null) {
  // Meta del corporativo: solo la cuenta dueña, sin vendedor ni plantilla (spec 2026-10-22 §4.3).
  if (meta.alcance === "corporativo") {
    if (usuario_id === null || usuario_id === undefined || Number(usuario_id) !== meta.usuario_id) throw new Error("Esta meta no es tuya");
    const cuenta = (DB.admin?.usuarios || []).find((u) => u.id === meta.usuario_id);
    if (!cuenta || cuenta.activo === false) throw new Error("Tu cuenta no está activa; no puede capturar");
    return meta.sucursal_id;
  }
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
    const cuenta = meta.alcance === "corporativo" ? (DB.admin?.usuarios || []).find((u) => u.id === meta.usuario_id) : null;
    let carpetaId;
    if (cuenta && sucursal_id === null) carpetaId = await drive.asegurarCarpetaEmpleado(DB, cuenta);
    else carpetaId = await drive.asegurarCarpetaActividadesSucursal(DB, DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id });
    const quien = cuenta ? cuenta.nombre : DB.pos.vendedores.find((v) => v.id === vendedor_id)?.nombre || vendedor_id;
    const subido = await drive.subirArchivoADrive(DB, {
      nombre: `${datos.fecha} - ${quien} - meta ${meta.clave} - ${evidencia.nombre_archivo}`,
      mimeType: datos.archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
    });
    if (subido?.id) evidencia.drive_file_id = subido.id;
    if (!subido || !subido.id || !subido.webViewLink) throw new Error("Drive no confirmó la subida de la foto; inténtalo de nuevo");
    validarEvidenciaUnica(DB, evidencia);
    evidencia.drive_link = subido.webViewLink;
  } finally {
    subidasEnCurso.delete(evidencia.huella);
  }
}

// Cada ventana de "Hecho" manda un id de operación. Si la señal falla y la vendedora vuelve a guardar, el
// reintento devuelve la captura que ya quedó en vez de contarla dos veces. Es por persona: no tapa a nadie más.
// `dueno` = { vendedor_id, usuario_id }: las capturas del corporativo se buscan por cuenta, las demás por vendedor.
function operacionPrevia(DB, operacion_id, dueno, clave) {
  if (operacion_id === undefined || operacion_id === null) return null;
  if (typeof operacion_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(operacion_id)) throw new Error("El id de operación no es válido");
  const suya = (c) => (c.usuario_id != null ? c.usuario_id === dueno.usuario_id : c.vendedor_id === dueno.vendedor_id);
  const previa = DB.pos.meta_capturas.find((c) => c.operacion_id === operacion_id && suya(c));
  if (previa && previa.meta_clave !== Number(clave)) throw new Error("Esa operación ya se usó en otra meta; vuelve a abrir la ventana");
  if (previa?.anulada) throw new Error("Esa captura fue quitada mientras la registrabas; abre la ventana de nuevo si quieres registrar otra");
  return previa || null;
}

async function borrarFoto(drive, DB, id) {
  try { await drive.eliminarArchivoDeDrive(DB, id); }
  catch (fallo) { console.error("No se pudo borrar la foto de una captura rechazada", fallo); }
}

async function capturarMeta(DB, clave, datos, { usuario, vendedor_id, drive, antesDeGuardar, hoy = fechaLocal(new Date()) }) {
  const operacion_id = datos?.operacion_id ?? null;
  const dueno = { vendedor_id, usuario_id: usuario?.id ?? null };
  const yaGuardada = operacionPrevia(DB, operacion_id, dueno, clave);
  if (yaGuardada) return yaGuardada;
  const meta = metaVigente(DB, clave);
  if (!meta) throw new Error("La meta no existe o fue eliminada");
  if (fuenteDe(meta) !== "manual") throw new Error("Esta meta se cuenta sola");
  exigirAbierto(DB, meta);
  const fecha = datos?.fecha;
  if (!fechaValida(fecha)) throw new Error("La fecha debe tener formato AAAA-MM-DD y ser válida");
  if (fecha > hoy) throw new Error("No se puede capturar una fecha futura");
  if (fecha < meta.inicio || fecha > finDePeriodo(meta.periodo, meta.inicio)) {
    throw new Error("La fecha no cae dentro del periodo de la meta");
  }
  const sucursal_id = validarParticipacion(DB, meta, vendedor_id, fecha, dueno.usuario_id);
  const nota = normalizarNota(datos.nota);
  const { cantidad, evidencia, buffer } = cantidadYEvidencia(meta, datos);
  validarEvidenciaUnica(DB, evidencia);
  try {
    if (evidencia?.tipo === "foto") await subirFoto(DB, meta, datos, { evidencia, buffer, vendedor_id, sucursal_id, drive });
    if (antesDeGuardar) antesDeGuardar();
    const vigente = metaVigente(DB, meta.clave);
    if (!vigente) throw new Error("La meta fue eliminada mientras se subía la foto; no se registró");
    if (fecha < vigente.inicio || fecha > finDePeriodo(vigente.periodo, vigente.inicio)) {
      throw new Error("La fecha no cae dentro del periodo de la meta");
    }
    const sucursalVigente = validarParticipacion(DB, vigente, vendedor_id, fecha, dueno.usuario_id);
    exigirAbierto(DB, vigente);
    // Mientras subía la foto pudo entrar el reintento de la misma operación: se conserva la primera.
    const entretanto = operacionPrevia(DB, operacion_id, dueno, vigente.clave);
    if (entretanto) {
      if (evidencia?.drive_file_id) await borrarFoto(drive, DB, evidencia.drive_file_id);
      return entretanto;
    }
    const captura = {
      id: siguienteId(DB.pos.meta_capturas), meta_clave: vigente.clave, meta_id: vigente.id, periodo: vigente.periodo, inicio: vigente.inicio,
      fecha, vendedor_id: vigente.alcance === "corporativo" ? null : vendedor_id,
      usuario_id: vigente.alcance === "corporativo" ? vigente.usuario_id : null, sucursal_id: sucursalVigente, cantidad, evidencia, nota,
      operacion_id, creado_por_id: usuario?.id ?? null, creado_por: usuario?.nombre || "desconocido", creado_en: new Date().toISOString(),
      anulada: null, revisada: null,
    };
    DB.pos.meta_capturas.push(captura);
    return captura;
  } catch (error) {
    if (evidencia?.drive_file_id) await borrarFoto(drive, DB, evidencia.drive_file_id);
    // Si la falla fue porque la primera petición de esta misma ventana ya quedó (p.ej. "foto ya usada"), se devuelve esa.
    let primera = null;
    try { primera = operacionPrevia(DB, operacion_id, dueno, meta.clave); } catch { /* se reporta el error original */ }
    if (primera) return primera;
    throw error;
  }
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

// La jefatura deja constancia de que revisó una captura sin anularla; no cambia el avance de nadie.
function marcarRevisada(DB, id, usuario) {
  const captura = DB.pos.meta_capturas.find((c) => c.id === Number(id));
  if (!captura) throw new Error("La captura no existe");
  if (captura.revisada) throw new Error("La captura ya está revisada");
  if (captura.anulada) throw new Error("La captura está anulada; no se puede marcar revisada");
  if (periodoSellado(DB, captura.periodo, captura.inicio)) throw new Error("El periodo ya está sellado; no se puede revisar");
  captura.revisada = { por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido", en: new Date().toISOString() };
  return captura;
}

function capturaParaRespuesta(captura) {
  if (captura.evidencia?.tipo !== "foto") return { ...captura };
  const evidencia = { ...captura.evidencia };
  delete evidencia.drive_file_id;
  return { ...captura, evidencia };
}

module.exports = { capturarMeta, anularCaptura, marcarRevisada, capturaParaRespuesta, validarParticipacion };
