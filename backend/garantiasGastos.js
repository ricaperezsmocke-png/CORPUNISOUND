/**
 * garantiasGastos.js — Gastos asociados a una garantía (traslado, reparación
 * u otro), cada uno con monto y un comprobante OPCIONAL (PDF/JPG/PNG) que se
 * guarda en Google Drive. Mismo patrón que documentosPersonal.js: recibe el
 * módulo `drive` como parámetro para poder probar sin la API real.
 *
 * Reutiliza el guard de alcance y la bitácora de garantias.js.
 */

const { buscarConGuardia, pushMovimiento } = require("./garantias");

const TIPOS_GASTO = ["traslado", "reparacion", "otro"];
const ETIQUETA_TIPO = { traslado: "Traslado", reparacion: "Reparación", otro: "Otro" };
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

async function agregarGasto(DB, garantiaId, datos, usuario, alcance, drive) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);

  const tipo = datos.tipo;
  if (!TIPOS_GASTO.includes(tipo)) throw new Error("Tipo de gasto inválido");
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número mayor que cero");

  let nombre_archivo = null, drive_file_id = null, drive_link = null;
  if (datos.archivo && datos.archivo.contenido_base64) {
    const { nombre_archivo: nom, tipo_mime, contenido_base64 } = datos.archivo;
    if (!MIME_VALIDOS.includes(tipo_mime)) throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
    const buffer = Buffer.from(contenido_base64, "base64");
    if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");
    const carpetaId = await drive.asegurarCarpetaGarantia(DB, garantia);
    const subido = await drive.subirArchivoADrive(DB, {
      nombre: `${garantia.folio} - ${ETIQUETA_TIPO[tipo]} - ${nom}`,
      mimeType: tipo_mime,
      contenidoBuffer: buffer,
      carpetaId,
    });
    nombre_archivo = nom;
    drive_file_id = subido.id;
    drive_link = subido.webViewLink;
  }

  const gasto = {
    id: siguienteId(DB.inventario.garantia_gastos),
    garantia_id: garantia.id,
    tipo,
    monto,
    descripcion: datos.descripcion || "",
    nombre_archivo,
    drive_file_id,
    drive_link,
    usuario: usuario?.nombre || "—",
    fecha: new Date().toISOString(),
  };
  DB.inventario.garantia_gastos.push(gasto);

  const compTxt = nombre_archivo ? ` (comprobante: ${nombre_archivo})` : "";
  const descTxt = datos.descripcion ? ` — ${datos.descripcion}` : "";
  pushMovimiento(DB, garantia, "gasto",
    `Gasto de ${ETIQUETA_TIPO[tipo].toLowerCase()}: $${monto.toFixed(2)}${descTxt}${compTxt}`, usuario);
  return gasto;
}

function listarGastos(DB, garantiaId, alcance) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  return DB.inventario.garantia_gastos.filter((g) => g.garantia_id === garantia.id);
}

function totalGastos(DB, garantiaId) {
  return DB.inventario.garantia_gastos
    .filter((g) => g.garantia_id === Number(garantiaId))
    .reduce((s, g) => s + Number(g.monto || 0), 0);
}

async function eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  const idx = DB.inventario.garantia_gastos.findIndex(
    (g) => g.id === Number(gastoId) && g.garantia_id === garantia.id
  );
  if (idx === -1) throw new Error("Gasto no encontrado");
  const gasto = DB.inventario.garantia_gastos[idx];
  if (gasto.drive_file_id) await drive.eliminarArchivoDeDrive(DB, gasto.drive_file_id);
  DB.inventario.garantia_gastos.splice(idx, 1);
  pushMovimiento(DB, garantia, "gasto_eliminado",
    `Gasto eliminado: ${ETIQUETA_TIPO[gasto.tipo]} $${Number(gasto.monto).toFixed(2)}`, usuario);
  return { ok: true };
}

module.exports = {
  agregarGasto, listarGastos, totalGastos, eliminarGasto,
  TIPOS_GASTO, ETIQUETA_TIPO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
