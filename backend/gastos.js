/**
 * gastos.js — Salidas de dinero que NO son mercancía (la mercancía vive en
 * Recepción de Compras). Cada gasto se clasifica en una subcategoría, se
 * respalda con un comprobante OBLIGATORIO en Drive, y si se pagó con efectivo
 * de la caja de la tienda se descuenta del Corte de Caja (ver cortes.js).
 *
 * Mismo patrón que garantias.js: funciones planas que reciben DB, con
 * bitácora (gasto_movimientos) y el guard de alcance por sucursal DENTRO del
 * módulo — no en la capa de rutas, que es donde se olvidó en Apartados.
 *
 * `drive` se recibe como parámetro (patrón de garantiasGastos.js) para poder
 * probar sin llamar a la API real de Google.
 */

const { dentroDeAlcance } = require("./auth");
const { buscarHojaActiva, listarCategorias } = require("./gastosCategorias");
const { fechaLocal } = require("./fechas");

const FORMAS_PAGO_GASTO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA"];
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

/**
 * Reserva el siguiente id/folio de forma SÍNCRONA — sin ningún `await` entre
 * leer y escribir `DB.gastos.ultimo_id`. Node ejecuta este cuerpo de un
 * tirón (no hay await dentro), así que dos `crearGasto` que entren casi al
 * mismo tiempo NUNCA pueden intercalarse aquí y sacar el mismo número, sin
 * importar cuánto tarde después la subida a Drive.
 *
 * Se toma el máximo entre el contador guardado y el mayor id que ya exista
 * en `DB.gastos.gastos`, para convivir con bases persistidas ANTES de que
 * `ultimo_id` existiera (ese campo llega en 0/undefined y sin este máximo se
 * repetirían ids ya usados).
 */
function reservarSiguienteId(DB) {
  const maxExistente = DB.gastos.gastos.reduce((m, g) => Math.max(m, g.id), 0);
  const base = Math.max(DB.gastos.ultimo_id || 0, maxExistente);
  DB.gastos.ultimo_id = base + 1;
  return DB.gastos.ultimo_id;
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pushMovimiento(DB, gasto, tipo, descripcion, usuario) {
  DB.gastos.gasto_movimientos.push({
    id: siguienteId(DB.gastos.gasto_movimientos),
    gasto_id: gasto.id,
    fecha: new Date().toISOString(),
    usuario: usuario?.nombre || "—",
    tipo,
    descripcion: descripcion || "",
  });
}

/** Busca el gasto y aplica el guard de alcance. Lanza "Gasto no encontrado"
 *  tanto si no existe como si es de otra sucursal — no revela su existencia. */
function buscarConGuardia(DB, id, alcance) {
  const gasto = DB.gastos.gastos.find((g) => g.id === Number(id));
  if (!gasto) throw new Error("Gasto no encontrado");
  if (!dentroDeAlcance(gasto.sucursal_id, alcance)) throw new Error("Gasto no encontrado");
  return gasto;
}

/**
 * Crea un gasto. El comprobante es OBLIGATORIO: se sube a Drive ANTES de
 * tocar DB, para que una falla de Drive no deje un gasto sin respaldo ni un
 * renglón de bitácora huérfano.
 *
 * `sucursalId` viene del token del usuario — nunca del cuerpo de la petición.
 */
async function crearGasto(DB, datos, sucursalId, usuario, drive) {
  const categoria = buscarHojaActiva(DB, datos.categoria_id);

  const concepto = (datos.concepto || "").trim();
  if (!concepto) throw new Error("Escribe el concepto del gasto");

  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número mayor que cero");

  const forma_pago = (datos.forma_pago || "").toUpperCase();
  if (!FORMAS_PAGO_GASTO.includes(forma_pago)) throw new Error("Elige una forma de pago válida");

  const archivo = datos.archivo;
  if (!archivo || !archivo.contenido_base64) {
    throw new Error("El comprobante es obligatorio — adjunta la foto del ticket o la factura");
  }
  if (!MIME_VALIDOS.includes(archivo.tipo_mime)) {
    throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
  }
  const buffer = Buffer.from(archivo.contenido_base64, "base64");
  if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");

  // Debe venir del token de sesión. Si el usuario tiene sucursal_id vacía o
  // inválida (p. ej. quedó en "" tras un PUT /api/usuarios/:id mal formado),
  // NO se asume la sucursal 1: eso cargaría el gasto a la tienda equivocada
  // en silencio y lo dejaría invisible para quien lo creó.
  const sucursal_id = Number(sucursalId);
  if (!Number.isFinite(sucursal_id) || sucursal_id <= 0) {
    throw new Error("No se pudo determinar tu sucursal — vuelve a iniciar sesión antes de registrar el gasto");
  }
  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id };

  // Reserva el id/folio de forma SÍNCRONA, antes de cualquier `await`: es lo
  // único que evita que dos capturas casi simultáneas (de sucursales
  // distintas o no) saquen el mismo número mientras ambas esperan a Drive.
  const nuevoId = reservarSiguienteId(DB);
  const folio = `GA-${String(nuevoId).padStart(4, "0")}`;

  // Se sube ANTES de crear el registro: si Drive falla, no queda nada a medias.
  const carpetaId = await drive.asegurarCarpetaGastosSucursal(DB, sucursal);
  const subido = await drive.subirArchivoADrive(DB, {
    nombre: `${folio} - ${concepto} - ${archivo.nombre_archivo}`,
    mimeType: archivo.tipo_mime,
    contenidoBuffer: buffer,
    carpetaId,
  });
  if (!subido || !subido.id || !subido.webViewLink) {
    throw new Error("Drive no confirmó la subida del comprobante — inténtalo de nuevo");
  }

  const ahora = new Date().toISOString();
  const gasto = {
    id: nuevoId,
    folio,
    fecha: fechaLocal(ahora),
    fecha_hora: ahora,
    sucursal_id,
    categoria_id: categoria.id,
    concepto,
    descripcion: (datos.descripcion || "").trim(),
    monto: redondear(monto),
    forma_pago,
    proveedor_id: datos.proveedor_id != null && datos.proveedor_id !== "" ? Number(datos.proveedor_id) : null,
    numero_factura: (datos.numero_factura || "").trim(),
    nombre_archivo: archivo.nombre_archivo,
    drive_file_id: subido.id,
    drive_link: subido.webViewLink,
    usuario: usuario?.nombre || "—",
    estatus: "activo",
    motivo_cancelacion: null,
    corte_id: null,
  };
  DB.gastos.gastos.push(gasto);

  pushMovimiento(DB, gasto, "creacion",
    `Registrado: ${categoria.nombre} — $${gasto.monto.toFixed(2)} (${forma_pago})`, usuario);
  return gasto;
}

/** Cancela SIN borrar: el registro y su comprobante en Drive se conservan. */
function cancelarGasto(DB, id, motivo, usuario, alcance) {
  const gasto = buscarConGuardia(DB, id, alcance);
  if (gasto.estatus === "cancelado") throw new Error("Ese gasto ya está cancelado");

  const limpio = (motivo || "").trim();
  if (!limpio) throw new Error("Escribe el motivo de la cancelación");

  gasto.estatus = "cancelado";
  gasto.motivo_cancelacion = limpio;
  pushMovimiento(DB, gasto, "cancelacion", `Cancelado: ${limpio}`, usuario);
  return gasto;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function listarGastos(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, estatus } = filtros || {};
  const categorias = listarCategorias(DB, {});
  const nombreCategoria = (id) => categorias.find((c) => c.id === id) || null;
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  const nombreProveedor = (id) =>
    id == null ? null : (DB["catalogo-productos"].proveedores.find((p) => p.id === id) || {}).nombre || null;

  let lista = DB.gastos.gastos.filter((g) => dentroDeAlcance(g.sucursal_id, alcance));
  lista = lista.filter((g) => enRango(g.fecha, fecha_inicio, fecha_fin));
  if (categoria_id) lista = lista.filter((g) => g.categoria_id === Number(categoria_id));
  if (forma_pago) lista = lista.filter((g) => g.forma_pago === String(forma_pago).toUpperCase());
  if (estatus) lista = lista.filter((g) => g.estatus === estatus);

  return lista
    .map((g) => {
      const categoria = nombreCategoria(g.categoria_id);
      const grupo = categoria ? nombreCategoria(categoria.categoria_padre_id) : null;
      return {
        ...g,
        categoria_nombre: categoria ? categoria.nombre : "—",
        grupo_nombre: grupo ? grupo.nombre : "—",
        sucursal_nombre: nombreSucursal(g.sucursal_id),
        proveedor_nombre: nombreProveedor(g.proveedor_id),
      };
    })
    .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
}

function movimientosDeGasto(DB, id, alcance) {
  const gasto = buscarConGuardia(DB, id, alcance);
  return DB.gastos.gasto_movimientos
    .filter((m) => m.gasto_id === gasto.id)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Lista de los gastos que SALIERON DE LA CAJA en el turno en curso — única
 * fuente de verdad, usada tanto para el monto (gastosEfectivoDelTurno) como
 * para el conteo (gastos_incluidos en cortes.js), para que nunca puedan
 * desincronizarse.
 *
 * Las condiciones son deliberadas y cada una tiene prueba propia en
 * gastos.test.js (bloque "gastosEfectivoDelTurno: ...") y en
 * gastosCorteCaja.test.js:
 *   - estatus activo  : un gasto cancelado no salió de la caja
 *   - EFECTIVO        : una transferencia o tarjeta no toca la caja de la tienda
 *   - misma sucursal  : el gasto de otra tienda no descuadra ésta
 *   - transición histórica: hasta corte_epoca conserva fecha_hora > desde
 *   - era sellada: después de corte_epoca solo entra corte_id null
 *   - caja predeterminada: los gastos nuevos no tienen caja propia y deben
 *     tener una sola dueña mientras esperan corte
 */
function gastosEfectivoDelTurnoLista(DB, sucursal_id, desde, caja) {
  const epoca = DB.pos.corte_epoca || null;
  return DB.gastos.gastos
    .filter((g) => g.estatus === "activo")
    .filter((g) => g.forma_pago === "EFECTIVO")
    .filter((g) => g.sucursal_id === Number(sucursal_id))
    .filter((g) => {
      const esPosteriorAEpoca = epoca && g.fecha_hora > epoca;
      if (esPosteriorAEpoca) return (!caja || caja.predeterminada) && g.corte_id == null;
      return g.corte_id == null && (!desde || g.fecha_hora > desde);
    });
}

/** Suma de los gastos que SALIERON DE LA CAJA en el turno en curso. Es lo que
 *  el Corte de Caja resta del efectivo esperado. Deriva de
 *  gastosEfectivoDelTurnoLista — ver ahí las cuatro condiciones. */
function gastosEfectivoDelTurno(DB, sucursal_id, desde, caja) {
  return redondear(
    gastosEfectivoDelTurnoLista(DB, sucursal_id, desde, caja)
      .reduce((suma, g) => suma + Number(g.monto || 0), 0)
  );
}

module.exports = {
  crearGasto, cancelarGasto, listarGastos, movimientosDeGasto,
  gastosEfectivoDelTurno, gastosEfectivoDelTurnoLista,
  buscarConGuardia, FORMAS_PAGO_GASTO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
