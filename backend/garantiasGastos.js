/**
 * garantiasGastos.js — Gastos asociados a una garantía (traslado, reparación
 * u otro), cada uno con monto y un comprobante OPCIONAL (PDF/JPG/PNG) que se
 * guarda en Google Drive. Mismo patrón que documentosPersonal.js: recibe el
 * módulo `drive` como parámetro para poder probar sin la API real.
 *
 * Reutiliza el guard de alcance y la bitácora de garantias.js.
 */

const { buscarConGuardia, pushMovimiento } = require("./garantias");
const { resolverCajaDeSucursal, esDeEstaCaja } = require("./cajas");

const TIPOS_GASTO = ["traslado", "reparacion", "otro"];
// Las formas con las que el dinero de una garantía entra al corte (ver
// dineroGarantiasDelTurno en cortes.js).
const FORMAS_PAGO = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"];
const ETIQUETA_TIPO = { traslado: "Traslado", reparacion: "Reparación", otro: "Otro" };
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function datosDeDinero(DB, garantia, datos) {
  const monto = Number(datos.monto);
  if (!["number", "string"].includes(typeof datos.monto) || !Number.isFinite(monto) || monto <= 0) {
    throw new Error("El monto debe ser un número mayor que cero");
  }
  const forma_pago = typeof datos.forma_pago === "string" ? datos.forma_pago.toUpperCase() : "";
  if (!FORMAS_PAGO.includes(forma_pago)) throw new Error("Forma de pago inválida");
  const sucursal_id = garantia.sucursal_origen_id;
  const caja = resolverCajaDeSucursal(DB, sucursal_id, datos.caja_id);
  return { monto, forma_pago, sucursal_id, caja_id: caja?.id ?? null, corte_id: null };
}

async function agregarGasto(DB, garantiaId, datos, usuario, alcance, drive) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);

  const tipo = datos.tipo;
  if (!TIPOS_GASTO.includes(tipo)) throw new Error("Tipo de gasto inválido");
  const dinero = datosDeDinero(DB, garantia, datos);
  const { monto } = dinero;

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
    ...dinero,
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

function crearCobroGarantia(DB, garantiaId, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  const dinero = datosDeDinero(DB, garantia, datos);
  // La base anterior no tiene esta colección; no se reescriben gastos viejos.
  if (!DB.inventario.garantia_cobros) DB.inventario.garantia_cobros = [];
  const cobro = {
    id: siguienteId(DB.inventario.garantia_cobros),
    garantia_id: garantia.id,
    ...dinero,
    descripcion: datos.descripcion || "",
    usuario: usuario?.nombre || "—",
    fecha: new Date().toISOString(),
  };
  DB.inventario.garantia_cobros.push(cobro);
  const descTxt = cobro.descripcion ? ` — ${cobro.descripcion}` : "";
  pushMovimiento(DB, garantia, "cobro", `Cobro al cliente: $${cobro.monto.toFixed(2)}${descTxt}`, usuario);
  return cobro;
}

function listarCobros(DB, garantiaId, alcance) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  return (DB.inventario.garantia_cobros || []).filter((c) => c.garantia_id === garantia.id);
}

function totalGastos(DB, garantiaId) {
  return DB.inventario.garantia_gastos
    .filter((g) => g.garantia_id === Number(garantiaId))
    .reduce((s, g) => s + Number(g.monto || 0), 0);
}

/**
 * ¿Ya contó este gasto un corte? "Ya lo contó un corte" es la misma frontera
 * que usa corregirOrigenGasto: con sello lo dice el sello; sin sello, un gasto
 * que declaraba dinero y es anterior a un corte de su caja lo contó la ventana
 * de tiempo de la era histórica. Uno viejo sin forma de pago nunca entró a un
 * corte, y bloquearlo solo le quitaría la herramienta a quien lo capturó mal.
 */
function yaLoContoUnCorte(DB, gasto) {
  if (gasto.corte_id != null) return true;
  if (!FORMAS_PAGO.includes(gasto.forma_pago) || !Number(gasto.sucursal_id)) return false;
  const caja = resolverCajaDeSucursal(DB, gasto.sucursal_id, gasto.caja_id);
  return DB.pos.cortes_caja.some((corte) =>
    Number(corte.sucursal_id) === Number(gasto.sucursal_id) &&
    esDeEstaCaja(corte, caja) && corte.fecha_hora > gasto.fecha
  );
}

async function eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  const idx = DB.inventario.garantia_gastos.findIndex(
    (g) => g.id === Number(gastoId) && g.garantia_id === garantia.id
  );
  if (idx === -1) throw new Error("Gasto no encontrado");
  const gasto = DB.inventario.garantia_gastos[idx];
  if (yaLoContoUnCorte(DB, gasto)) {
    throw new Error("No se puede eliminar un gasto incluido en un corte cerrado: ese corte ya descontó este dinero");
  }
  // Revisar y quitar el registro van juntos, SIN ningún await en medio. Con la
  // espera a Drive entre los dos, un corte podía cerrarse ahí y sellar un gasto
  // que un instante después desaparecía, y un segundo borrado simultáneo usaba
  // un índice viejo y quitaba otro gasto.
  DB.inventario.garantia_gastos.splice(idx, 1);
  pushMovimiento(DB, garantia, "gasto_eliminado",
    `Gasto eliminado: ${ETIQUETA_TIPO[gasto.tipo]} $${Number(gasto.monto).toFixed(2)}`, usuario);
  if (gasto.drive_file_id) {
    try {
      await drive.eliminarArchivoDeDrive(DB, gasto.drive_file_id);
    } catch (e) {
      // El registro ya no está. El comprobante sobra en Drive, pero no se
      // pierde, y la bitácora deja dicho dónde quedó.
      pushMovimiento(DB, garantia, "gasto_eliminado",
        `El comprobante ${gasto.nombre_archivo || gasto.drive_file_id} quedó en Drive: no se pudo borrar (${e.message})`, usuario);
    }
  }
  return { ok: true };
}

module.exports = {
  agregarGasto, listarGastos, totalGastos, eliminarGasto, crearCobroGarantia, listarCobros,
  TIPOS_GASTO, ETIQUETA_TIPO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
