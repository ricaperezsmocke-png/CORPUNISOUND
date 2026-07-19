/**
 * documentosPersonal.js — Expedientes de Personal (curriculum, acta de
 * nacimiento, comprobante de domicilio, INE, contrato) guardados en
 * Google Drive. Este módulo solo valida y orquesta; las llamadas reales
 * a Drive se reciben como parámetro `drive` (ver backend/drive.js) para
 * poder probar esta lógica sin llamar a la API real de Google.
 */

const CATEGORIAS_VALIDAS = ["curriculum", "acta_nacimiento", "comprobante_domicilio", "ine", "contrato"];

const ETIQUETAS_CATEGORIA = {
  curriculum: "Curriculum",
  acta_nacimiento: "Acta de Nacimiento",
  comprobante_domicilio: "Comprobante de Domicilio",
  ine: "INE",
  contrato: "Contrato",
};

const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

async function subirDocumento(DB, usuarioId, datos, subidoPorId, drive) {
  const { categoria, nombre_archivo, tipo_mime, contenido_base64 } = datos;

  if (!CATEGORIAS_VALIDAS.includes(categoria)) throw new Error("Categoría de documento inválida");
  if (!MIME_VALIDOS.includes(tipo_mime)) throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");

  const buffer = Buffer.from(contenido_base64, "base64");
  if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");

  const usuario = DB.admin.usuarios.find((u) => u.id === Number(usuarioId));
  if (!usuario) throw new Error("Empleado no encontrado");

  const carpetaId = await drive.asegurarCarpetaEmpleado(DB, usuario);
  const nombreEnDrive = `${ETIQUETAS_CATEGORIA[categoria]} - ${nombre_archivo}`;
  const subido = await drive.subirArchivoADrive(DB, { nombre: nombreEnDrive, mimeType: tipo_mime, contenidoBuffer: buffer, carpetaId });

  const registro = {
    id: siguienteId(DB.admin.documentos_personal),
    usuario_id: Number(usuarioId),
    categoria,
    nombre_archivo,
    drive_file_id: subido.id,
    drive_link: subido.webViewLink,
    subido_por: subidoPorId,
    fecha: new Date().toISOString(),
  };
  DB.admin.documentos_personal.push(registro);
  return registro;
}

function listarDocumentos(DB, usuarioId) {
  return DB.admin.documentos_personal.filter((d) => d.usuario_id === Number(usuarioId));
}

async function eliminarDocumento(DB, usuarioId, documentoId, drive) {
  const idx = DB.admin.documentos_personal.findIndex(
    (d) => d.id === Number(documentoId) && d.usuario_id === Number(usuarioId)
  );
  if (idx === -1) throw new Error("Documento no encontrado");
  const doc = DB.admin.documentos_personal[idx];
  await drive.eliminarArchivoDeDrive(DB, doc.drive_file_id);
  DB.admin.documentos_personal.splice(idx, 1);
  return { ok: true };
}

module.exports = {
  subirDocumento, listarDocumentos, eliminarDocumento,
  CATEGORIAS_VALIDAS, ETIQUETAS_CATEGORIA, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
