/**
 * respaldos.js — Foto completa del negocio, cifrada, en Google Drive.
 *
 * Patrón de gastos.js / depositos.js: funciones planas que reciben DB, bitácora
 * propia, contador SÍNCRONO. Aquí NO hay alcance por sucursal: un respaldo es de
 * toda la empresa. Lo que protege estas operaciones es requiereAlcanceGlobal en
 * la capa de rutas más la clave de restauración.
 *
 * Lo que se respalda es el JSON completo del DB (que es como ya vive en SQLite,
 * ver persistencia.js), MENOS DB.respaldos: el índice no se respalda a sí mismo.
 * Restaurar un índice viejo borraría de la vista los respaldos hechos después de
 * esa foto — incluido el pre_restauracion que acaba de salvar el pellejo.
 *
 * El catálogo del SAT NO entra: vive en su propia tabla de SQLite (claves_sat),
 * es público y se reimporta solo al arrancar. Meterlo multiplicaría por diez el
 * peso de cada archivo sin ganar nada.
 */

const { empaquetar } = require("./respaldoCifrado");
const { fechaLocal, ahora, momentoLocal } = require("./fechas");

const VERSION_FORMATO = 1;

/** Las llaves de primer nivel de DB que SÍ se respaldan. Ver server.js:107. */
const COLECCIONES_RESPALDADAS = [
  "pos", "crm", "inventario", "admin", "ml", "drive", "gastos", "cuenta_comun",
];

/** Sin respaldo en este tiempo, la pantalla se pone roja. Dos horas y no una:
 *  el ciclo es de una hora y un reintento no debe pintar alarma. */
const MINUTOS_PARA_ALERTA = 120;

function nuevoEstadoRespaldos() {
  return {
    copias: [], movimientos: [], ultimo_id: 0,
    ultimo_exitoso: null, ultimo_intento: null, carpeta_drive_id: null,
  };
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

/** Contador SÍNCRONO. Se reserva ANTES de cualquier await — la lección del bug
 *  CRITICAL de Gastos, donde dos capturas concurrentes recibieron el mismo folio
 *  porque el push ocurría después del await de Drive. */
function reservarSiguienteId(DB) {
  const maxExistente = DB.respaldos.copias.reduce((m, c) => Math.max(m, c.id), 0);
  DB.respaldos.ultimo_id = Math.max(DB.respaldos.ultimo_id || 0, maxExistente) + 1;
  return DB.respaldos.ultimo_id;
}

function pushMovimiento(DB, copiaId, tipo, descripcion, usuario) {
  DB.respaldos.movimientos.push({
    id: siguienteId(DB.respaldos.movimientos),
    respaldo_id: copiaId, fecha: ahora(),
    usuario: usuario?.nombre || "sistema",
    tipo, descripcion: descripcion || "",
  });
}

/** Los conteos que van en la etiqueta del archivo. Sirven para dos cosas
 *  concretas: detectar un archivo corrupto sin abrirlo entero, y decirle a
 *  Victor QUÉ va a restaurar antes de que apriete. */
function contarRegistros(DB) {
  const ventas = DB?.pos?.ventas || [];
  return {
    ventas: ventas.length,
    // Los apartados no son colección propia: son ventas marcadas.
    apartados: ventas.filter((v) => v && v.tipo_documento === "Apartado").length,
    cortes: DB?.pos?.cortes_caja?.length || 0,
    productos: DB?.inventario?.productos?.length || 0,
    garantias: DB?.inventario?.garantias?.length || 0,
    clientes: DB?.crm?.clientes?.length || 0,
    gastos: DB?.gastos?.gastos?.length || 0,
    depositos: DB?.cuenta_comun?.depositos?.length || 0,
    usuarios: DB?.admin?.usuarios?.length || 0,
  };
}

function armarFoto(DB, tipo) {
  const datos = {};
  for (const clave of COLECCIONES_RESPALDADAS) {
    if (DB[clave] !== undefined) datos[clave] = DB[clave];
  }
  const instante = ahora();
  return {
    version_formato: VERSION_FORMATO,
    generado_en: instante,
    fecha_local: fechaLocal(instante),
    tipo,
    conteos: contarRegistros(DB),
    datos,
  };
}

/**
 * Arma, cifra, VERIFICA, sube y registra. En ese orden.
 *
 * La copia se registra ANTES de subir (con estado "fallido") para que una caída
 * de Drive deje rastro visible en la pantalla en vez de desaparecer sin ruido.
 * Solo pasa a "ok" cuando Drive confirmó.
 */
async function crearRespaldo(DB, drive, { tipo = "hora", llave, usuario = null } = {}) {
  if (!llave) throw new Error("RESPALDO_LLAVE no está configurada — no se puede respaldar");

  const foto = armarFoto(DB, tipo);
  const paquete = empaquetar(foto, llave); // si esto revienta, no se toca Drive

  const m = momentoLocal(foto.generado_en);
  // Reserva SÍNCRONA, antes del primer await.
  const id = reservarSiguienteId(DB);
  const nombre_archivo = `unisound-${m.fecha}-${m.hhmm.replace(":", "")}-${id}.respaldo`;

  const copia = {
    id, tipo,
    fecha: m.fecha, fecha_hora: foto.generado_en, hora_local: m.hhmm,
    nombre_archivo, drive_file_id: null, drive_link: null,
    bytes: paquete.length, conteos: foto.conteos,
    verificado_en: null, estado: "fallido",
  };
  DB.respaldos.copias.push(copia);
  DB.respaldos.ultimo_intento = foto.generado_en;

  const carpetaId = await drive.asegurarCarpetaRespaldos(DB);
  const subido = await drive.subirArchivoADrive(DB, {
    nombre: nombre_archivo,
    mimeType: "application/octet-stream",
    contenidoBuffer: paquete,
    carpetaId,
  });
  if (!subido || !subido.id) throw new Error("Drive no confirmó la subida del respaldo");

  copia.drive_file_id = subido.id;
  copia.drive_link = subido.webViewLink || null;
  copia.estado = "ok";
  DB.respaldos.ultimo_exitoso = copia.fecha_hora;
  pushMovimiento(DB, id, "creacion", `Respaldo ${tipo} (${paquete.length} bytes)`, usuario);
  return copia;
}

/** Lo que ve la pantalla de vigilancia. */
function estadoRespaldos(DB, ahoraMs = Date.now()) {
  const r = DB.respaldos || nuevoEstadoRespaldos();
  const ultimoMs = r.ultimo_exitoso ? Date.parse(r.ultimo_exitoso) : NaN;
  const minutos = Number.isFinite(ultimoMs)
    ? Math.floor((ahoraMs - ultimoMs) / 60000)
    : null;
  return {
    ultimo_exitoso: r.ultimo_exitoso,
    ultimo_intento: r.ultimo_intento,
    minutos_desde_ultimo: minutos,
    // Sin ningún respaldo la alerta está ENCENDIDA. "Nunca he respaldado" es
    // el peor estado posible, no un estado neutro.
    alerta: minutos === null || minutos > MINUTOS_PARA_ALERTA,
    total_copias: r.copias.length,
  };
}

module.exports = {
  nuevoEstadoRespaldos, contarRegistros, armarFoto, crearRespaldo, estadoRespaldos,
  pushMovimiento, siguienteId,
  COLECCIONES_RESPALDADAS, VERSION_FORMATO, MINUTOS_PARA_ALERTA,
};
