/**
 * depositos.js — Depósitos de cada tienda a la cuenta común (el CEDIS compra y
 * reparte). Mismo patrón que gastos.js: funciones planas, bitácora, guard de
 * alcance DENTRO del módulo, folio SÍNCRONO. El comprobante es OPCIONAL: el
 * depósito se registra ANTES de tocar Drive, así que una falla de Drive no
 * bloquea el registro (el monto es lo importante).
 */

const { dentroDeAlcance } = require("./auth");
const { fechaLocal } = require("./fechas");

const FORMAS_PAGO_DEPOSITO = ["EFECTIVO", "TRANSFERENCIA"];
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}
function reservarSiguienteId(DB) {
  const maxExistente = DB.cuenta_comun.depositos.reduce((m, d) => Math.max(m, d.id), 0);
  DB.cuenta_comun.ultimo_id = Math.max(DB.cuenta_comun.ultimo_id || 0, maxExistente) + 1;
  return DB.cuenta_comun.ultimo_id;
}
function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function pushMovimiento(DB, deposito, tipo, descripcion, usuario) {
  DB.cuenta_comun.deposito_movimientos.push({
    id: siguienteId(DB.cuenta_comun.deposito_movimientos),
    deposito_id: deposito.id,
    fecha: new Date().toISOString(),
    usuario: usuario?.nombre || "—",
    tipo, descripcion: descripcion || "",
  });
}

function buscarConGuardia(DB, id, alcance) {
  const d = DB.cuenta_comun.depositos.find((x) => x.id === Number(id));
  if (!d) throw new Error("Depósito no encontrado");
  if (!dentroDeAlcance(d.sucursal_id, alcance)) throw new Error("Depósito no encontrado");
  return d;
}

async function crearDeposito(DB, datos, sucursalId, usuario, drive) {
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número mayor que cero");

  const forma_pago = (datos.forma_pago || "").toUpperCase();
  if (!FORMAS_PAGO_DEPOSITO.includes(forma_pago)) throw new Error("Elige una forma de pago válida");

  const sucursal_id = Number(sucursalId);
  if (!Number.isFinite(sucursal_id) || sucursal_id <= 0) {
    throw new Error("No se pudo determinar tu sucursal — vuelve a iniciar sesión antes de registrar el depósito");
  }
  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id };

  // Validación SÍNCRONA del archivo (si viene), ANTES de crear nada: un archivo
  // inválido rechaza todo limpio. La subida (red) sí se deja fallar sin bloquear.
  const archivo = datos.archivo;
  let buffer = null;
  if (archivo && archivo.contenido_base64) {
    if (!MIME_VALIDOS.includes(archivo.tipo_mime)) throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
    buffer = Buffer.from(archivo.contenido_base64, "base64");
    if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");
  }

  // Folio SÍNCRONO + push ANTES de cualquier await (ver Global Constraints).
  const nuevoId = reservarSiguienteId(DB);
  const folio = `DEP-${String(nuevoId).padStart(4, "0")}`;
  const ahora = new Date().toISOString();
  const deposito = {
    id: nuevoId, folio,
    fecha: fechaLocal(ahora), fecha_hora: ahora,
    sucursal_id, monto: redondear(monto), forma_pago,
    referencia: (datos.referencia || "").trim(),
    nota: (datos.nota || "").trim(),
    nombre_archivo: null, drive_file_id: null, drive_link: null,
    usuario_id: usuario?.id ?? null, usuario_nombre: usuario?.nombre || "—",
    estatus: "activo", motivo_cancelacion: null,
  };
  DB.cuenta_comun.depositos.push(deposito);
  pushMovimiento(DB, deposito, "creacion", `Depósito: $${deposito.monto.toFixed(2)} (${forma_pago})`, usuario);

  // Comprobante OPCIONAL: si Drive falla, el depósito ya quedó registrado.
  if (buffer) {
    try {
      const carpetaId = await drive.asegurarCarpetaDepositosSucursal(DB, sucursal);
      const subido = await drive.subirArchivoADrive(DB, {
        nombre: `${folio} - ${archivo.nombre_archivo}`,
        mimeType: archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
      });
      if (subido && subido.id && subido.webViewLink) {
        deposito.nombre_archivo = archivo.nombre_archivo;
        deposito.drive_file_id = subido.id;
        deposito.drive_link = subido.webViewLink;
      }
    } catch (_) {
      // Drive caído: se conserva el depósito sin comprobante. No se bloquea.
    }
  }
  return deposito;
}

/** Cancela SIN borrar. Se conserva el comprobante en Drive a propósito: la
 *  cancelación nunca debe fallar por que Drive esté caído, y el comprobante es
 *  evidencia de lo que se canceló. (Deliberadamente distinto de la nota del
 *  spec: robustez sobre limpieza.) */
function cancelarDeposito(DB, id, motivo, usuario, alcance) {
  const d = buscarConGuardia(DB, id, alcance);
  if (d.estatus === "cancelado") throw new Error("Ese depósito ya está cancelado");
  const limpio = (motivo || "").trim();
  if (!limpio) throw new Error("Escribe el motivo de la cancelación");
  d.estatus = "cancelado";
  d.motivo_cancelacion = limpio;
  pushMovimiento(DB, d, "cancelacion", `Cancelado: ${limpio}`, usuario);
  return d;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function listarDepositos(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, estatus } = filtros || {};
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  let lista = DB.cuenta_comun.depositos.filter((d) => dentroDeAlcance(d.sucursal_id, alcance));
  lista = lista.filter((d) => enRango(d.fecha, fecha_inicio, fecha_fin));
  if (estatus) lista = lista.filter((d) => d.estatus === estatus);
  return lista
    .map((d) => ({ ...d, sucursal_nombre: nombreSucursal(d.sucursal_id) }))
    .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
}

module.exports = {
  crearDeposito, cancelarDeposito, listarDepositos, buscarConGuardia,
  FORMAS_PAGO_DEPOSITO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
