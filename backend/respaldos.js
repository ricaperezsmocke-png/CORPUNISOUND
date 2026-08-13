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

const crypto = require("crypto");
const { empaquetar } = require("./respaldoCifrado");
const { fechaLocal, ahora, momentoLocal } = require("./fechas");
const mantenimiento = require("./mantenimiento");

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

const DIAS_RETENCION_DIA = 30;   // los puntos del día y los pre_restauracion
const DIAS_RETENCION_HORA = 7;   // el detalle fino
const DIA_MS = 24 * 60 * 60 * 1000;

function diasDeVida(tipo) {
  return tipo === "hora" ? DIAS_RETENCION_HORA : DIAS_RETENCION_DIA;
}

/**
 * Rueda de retención: 30 días de puntos del día, 7 días de detalle por hora.
 *
 * Dos reglas que no se negocian:
 *  1) La copia UTILIZABLE MÁS RECIENTE nunca se borra, aunque su fecha diga que
 *     ya venció. Es la última red contra un reloj mal puesto o una fecha
 *     corrupta: mejor un archivo de más que quedarse sin ninguno.
 *
 *     "Utilizable" = estado "ok" con drive_file_id, es decir que SÍ hay un byte
 *     real en Drive detrás. `crearRespaldo` mete el renglón con estado
 *     "fallido" y drive_file_id null ANTES de intentar subir, y solo lo pasa a
 *     "ok" cuando Drive confirmó. Si se protegiera por fecha_hora a secas, un
 *     intento fallido reciente (Drive caído, token vencido) se volvería el
 *     "protegido" sin representar ningún respaldo real, mientras el último
 *     respaldo bueno —ahora sin protección— se lo comería la retención por
 *     edad en cuanto cruzara su umbral: la carpeta de Drive quedaría vacía con
 *     el índice mostrando un renglón sobreviviente que no sirve para nada.
 *     Si NUNCA hubo un respaldo exitoso, cae al caso degenerado: se protege
 *     el renglón más nuevo que haya, sea cual sea su estado.
 *  2) Si Drive falla al borrar, el renglón se CONSERVA en el índice. Quitarlo
 *     dejaría un archivo huérfano en Drive que nadie volvería a mirar; dejarlo
 *     hace que el siguiente ciclo lo reintente.
 */
async function limpiarViejos(DB, drive, ahoraMs = Date.now()) {
  const copias = DB.respaldos.copias;
  if (copias.length <= 1) return { borradas: 0, conservadas: copias.length };

  const exitosas = copias.filter((c) => c.estado === "ok" && c.drive_file_id);
  const candidatas = exitosas.length ? exitosas : copias;
  const masReciente = candidatas.reduce((a, b) =>
    Date.parse(a.fecha_hora) >= Date.parse(b.fecha_hora) ? a : b
  );

  const vencidas = copias.filter((c) => {
    if (c === masReciente) return false;
    const nacida = Date.parse(c.fecha_hora);
    if (!Number.isFinite(nacida)) return false; // fecha corrupta: no se toca
    return ahoraMs - nacida > diasDeVida(c.tipo) * DIA_MS;
  });

  let borradas = 0;
  for (const c of vencidas) {
    if (c.drive_file_id) {
      try {
        await drive.eliminarArchivoDeDrive(DB, c.drive_file_id);
      } catch (_) {
        continue; // se conserva el renglón; el próximo ciclo reintenta
      }
    }
    const i = DB.respaldos.copias.indexOf(c);
    if (i !== -1) DB.respaldos.copias.splice(i, 1);
    pushMovimiento(DB, c.id, "borrado", `Retención: ${c.nombre_archivo}`, null);
    borradas++;
  }
  return { borradas, conservadas: DB.respaldos.copias.length };
}

const { desempaquetar } = require("./respaldoCifrado");

function buscarCopia(DB, copiaId) {
  const c = DB.respaldos.copias.find((x) => x.id === Number(copiaId));
  if (!c) throw new Error("Respaldo no encontrado");
  return c;
}

/**
 * Baja el archivo de Drive, lo descifra y lo VALIDA ENTERO antes de devolverlo.
 *
 * Se valida todo antes de que nadie pueda usarlo: es el mismo principio que
 * salvó a la migración de SICAR de dejar datos a medias. Un archivo que no pasa
 * se rechaza completo, nunca se aprovecha "la parte buena".
 */
async function leerRespaldo(DB, drive, copiaId, llave) {
  if (!llave) throw new Error("RESPALDO_LLAVE no está configurada — no se puede leer el respaldo");
  const copia = buscarCopia(DB, copiaId);
  if (!copia.drive_file_id) throw new Error("Ese respaldo no llegó a subirse a Drive");

  const bytes = await drive.descargarArchivoDeDrive(DB, copia.drive_file_id);
  const foto = desempaquetar(bytes, llave); // lanza si está alterado o corrupto

  if (foto.version_formato !== VERSION_FORMATO) {
    throw new Error(
      `Ese respaldo usa la versión de formato ${foto.version_formato} y este sistema entiende la ${VERSION_FORMATO}. No se puede aplicar.`
    );
  }
  if (!foto.datos || typeof foto.datos !== "object") {
    throw new Error("El respaldo está incompleto: no trae datos");
  }
  const faltantes = COLECCIONES_RESPALDADAS.filter((k) => foto.datos[k] === undefined);
  if (faltantes.length) {
    throw new Error(`El respaldo está incompleto: le falta ${faltantes.join(", ")}`);
  }
  return { copia, foto };
}

/**
 * La verificación que de verdad cuenta: baja de Drive y comprueba que lo
 * guardado sirve. Cifrar bien no garantiza que Drive guardó los bytes correctos.
 * NUNCA lanza — un respaldo roto es un dato que reportar, no una excepción que
 * tumbe el ciclo.
 */
async function verificarRespaldo(DB, drive, copiaId, llave) {
  // Se busca la copia ANTES de leerRespaldo (no se toma de su retorno):
  // leerRespaldo puede lanzar en cualquiera de sus validaciones (descifrado,
  // versión, colecciones faltantes) sin llegar a devolver nada. Si copia solo
  // se supiera por su retorno, el catch de abajo no tendría a quién limpiarle
  // verificado_en justo en los casos de archivo roto — que son el motivo de
  // ser de esta función.
  let copia = null;
  try {
    copia = buscarCopia(DB, copiaId);
    const leido = await leerRespaldo(DB, drive, copiaId, llave);
    const reales = contarRegistros(leido.foto.datos);
    const diferencias = Object.keys(copia.conteos || {}).filter(
      (k) => Number(copia.conteos[k]) !== Number(reales[k])
    ).map((k) => `${k}: el índice dice ${copia.conteos[k]} y el archivo trae ${reales[k]}`);

    if (diferencias.length) {
      copia.verificado_en = null;
      pushMovimiento(DB, copia.id, "verificacion_fallida", diferencias.join("; "), null);
      return { ok: false, verificado_en: null, diferencias };
    }
    copia.verificado_en = ahora();
    pushMovimiento(DB, copia.id, "verificacion", "Descargado de Drive y comprobado", null);
    return { ok: true, verificado_en: copia.verificado_en, diferencias: [] };
  } catch (e) {
    if (copia) {
      copia.verificado_en = null;
      pushMovimiento(DB, copia.id, "verificacion_fallida", e.message, null);
    }
    return { ok: false, verificado_en: null, diferencias: [e.message] };
  }
}

const PALABRA_CONFIRMACION = "RESTAURAR";

/** ¿Está puesta la clave en Render? Si no, restaurar NO EXISTE. Falla cerrado:
 *  mientras Victor no la ponga a propósito, nadie puede restaurar nada. */
function claveRestauracionConfigurada(env = process.env) {
  return typeof env.CLAVE_RESTAURACION === "string" && env.CLAVE_RESTAURACION.length > 0;
}

/** Comparación de TIEMPO CONSTANTE. Con `===` el tiempo de respuesta filtra
 *  cuántos caracteres iniciales acertaste, y la clave se adivina letra por
 *  letra. Se comparan hashes de largo fijo para que dos claves de distinto
 *  tamaño no revienten timingSafeEqual. */
function claveCorrecta(dada, env = process.env) {
  if (!claveRestauracionConfigurada(env)) return false;
  if (typeof dada !== "string" || dada.length === 0) return false;
  const a = crypto.createHash("sha256").update(dada, "utf8").digest();
  const b = crypto.createHash("sha256").update(env.CLAVE_RESTAURACION, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/** Qué se pierde al volver a esta foto. Es una ESTIMACIÓN POR CONTEO, no un
 *  listado — así se dice en la pantalla, para no prometer precisión que no da. */
function compararConEstadoActual(DB, copia) {
  const ahoraConteos = contarRegistros(DB);
  const perdidas = {};
  for (const clave of Object.keys(ahoraConteos)) {
    const diferencia = ahoraConteos[clave] - Number(copia.conteos?.[clave] ?? 0);
    if (diferencia > 0) perdidas[clave] = diferencia;
  }
  const ETIQUETAS = {
    ventas: "ventas", apartados: "apartados", cortes: "cortes de caja",
    productos: "productos", garantias: "garantías", clientes: "clientes",
    gastos: "gastos", depositos: "depósitos", usuarios: "usuarios",
  };
  const partes = Object.entries(perdidas).map(([k, n]) => `${n} ${ETIQUETAS[k] || k}`);
  return {
    perdidas,
    resumen: partes.length
      ? `Se perderán ${partes.join(", ")} capturados después de esa hora.`
      : "No se pierde ningún registro: la foto está al día.",
  };
}

/**
 * Restaurar. La operación más destructiva del sistema.
 *
 * ORDEN DE LOS CANDADOS, y el orden importa:
 *   1. ¿Está configurada la clave?      -> si no, esto no existe
 *   2. ¿La clave es correcta?           -> tiempo constante
 *   3. ¿Escribió RESTAURAR?             -> nadie lo aprieta por accidente
 *   4. Bajar y VALIDAR la foto ENTERA   -> antes de tocar un solo dato
 *   5. Respaldo pre_restauracion        -> si falla, se CANCELA
 *   6. Recién entonces, reemplazar
 *
 * El candado 5 es el más importante: vuelve reversible el peor error posible.
 * Si Victor restaura el día equivocado, se restaura de vuelta y no se perdió
 * nada.
 *
 * DB.respaldos NO se restaura: el índice viejo borraría de la vista los
 * respaldos hechos después de esa foto, incluido el pre_restauracion que acaba
 * de salvarle el pellejo.
 */
async function restaurar(DB, drive, {
  copiaId, llave, clave, confirmacion, usuario = null, env = process.env,
} = {}) {
  // Candado 0 — alcance, DENTRO del módulo (restricción global #5, agregado por
  // el escaneo previo del 2026-08-12). La ruta ya lleva `requiereAlcanceGlobal`,
  // y aun así este chequeo va aquí: exactamente eso era lo que hacía "segura" la
  // ruta de Apartados antes del bug de alcance de julio. Es la operación más
  // destructiva del sistema; si mañana alguien llama `restaurar()` desde un
  // script, una tarea programada, o reordena por accidente los middlewares, esto
  // es lo único que queda de pie. Un usuario amarrado a una sucursal trae
  // `sucursal_id` en su token; quien ve todas trae `null`. Falla CERRADO: sin
  // `usuario` (ausente, `null` o `undefined`) no se restaura — no hay alcance
  // global implícito por default.
  if (!usuario || usuario.sucursal_id != null) {
    throw new Error("Restaurar requiere una cuenta con alcance global (todas las sucursales).");
  }

  if (!claveRestauracionConfigurada(env)) {
    throw new Error(
      "La restauración no está habilitada: falta configurar CLAVE_RESTAURACION en el servidor."
    );
  }
  if (!claveCorrecta(clave, env)) {
    throw new Error("La clave de restauración no es correcta.");
  }
  if (confirmacion !== PALABRA_CONFIRMACION) {
    throw new Error(`Escribe ${PALABRA_CONFIRMACION} para confirmar.`);
  }

  // Se baja y valida ENTERA antes de tocar nada. Si el archivo está corrupto,
  // incompleto o de otra versión, se rechaza aquí y la base ni se enteró.
  // Esto va ANTES de bloquear el sistema a propósito: un archivo dañado no debe
  // dejar la tienda cerrada ni un segundo.
  const { copia, foto } = await leerRespaldo(DB, drive, copiaId, llave);

  // A partir de aquí el sistema queda BLOQUEADO para escrituras, y no se
  // desbloquea pase lo que pase (el `finally` de más abajo).
  //
  // El bloqueo va ANTES del respaldo previo, no después, y esa diferencia es
  // justo el punto: una venta capturada ENTRE el respaldo previo y el reemplazo
  // se perdería dos veces — no estaría en los datos restaurados (son más viejos)
  // ni en el respaldo previo (se tomó antes de esa venta). Sería dinero cobrado
  // que no existe en ningún archivo. Con el bloqueo aquí, esa ventana no existe.
  mantenimiento.activar(
    `Restaurando el respaldo del ${copia.fecha} ${copia.hora_local}. ` +
    "El sistema vuelve solo en cuanto termine."
  );

  try {
    // La red de seguridad. Si esto falla, NO se restaura: mejor no restaurar que
    // restaurar sin poder deshacerlo.
    let pre;
    try {
      pre = await crearRespaldo(DB, drive, { tipo: "pre_restauracion", llave, usuario });
    } catch (e) {
      throw new Error(
        "No se pudo crear el respaldo de seguridad previo, así que la restauración se canceló " +
        "(no se tocó ningún dato). Revisa la conexión con Google Drive. Detalle: " + e.message
      );
    }

    const comparacion = compararConEstadoActual(DB, copia);

    // Recién ahora se muta. Colección por colección, solo las respaldadas.
    for (const nombre of COLECCIONES_RESPALDADAS) {
      if (foto.datos[nombre] !== undefined) DB[nombre] = foto.datos[nombre];
    }

    pushMovimiento(
      DB, copia.id, "restauracion",
      `Restaurado al estado del ${copia.fecha} ${copia.hora_local}. ${comparacion.resumen} ` +
      `Respaldo previo: ${pre.nombre_archivo}`,
      usuario
    );

    return { copia, pre_restauracion: pre, aplicado: true, comparacion };
  } finally {
    // SIEMPRE se desbloquea: si algo revienta a media restauración, la tienda no
    // se queda cerrada esperando a que alguien reinicie el servidor. Un `finally`
    // y no un `desactivar()` al final del camino feliz — ese es el error que deja
    // negocios parados.
    mantenimiento.desactivar();
  }
}

module.exports = {
  nuevoEstadoRespaldos, contarRegistros, armarFoto, crearRespaldo, estadoRespaldos,
  pushMovimiento, siguienteId, limpiarViejos,
  leerRespaldo, verificarRespaldo, buscarCopia,
  COLECCIONES_RESPALDADAS, VERSION_FORMATO, MINUTOS_PARA_ALERTA,
  DIAS_RETENCION_DIA, DIAS_RETENCION_HORA,
  restaurar, claveRestauracionConfigurada, claveCorrecta, compararConEstadoActual,
  PALABRA_CONFIRMACION,
};
