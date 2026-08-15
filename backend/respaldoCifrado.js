/**
 * respaldoCifrado.js — El FORMATO del archivo de respaldo, y nada más.
 *
 * No sabe qué se respalda, ni cuándo, ni a dónde se sube. Solo convierte un
 * objeto en un Buffer ilegible y de regreso.
 *
 * Orden: JSON -> gzip -> AES-256-GCM. Se comprime ANTES de cifrar porque lo
 * cifrado ya no se comprime (parece ruido).
 *
 * GCM y no CBC porque GCM AUTENTICA: si el archivo fue alterado o llegó
 * corrupto, descifrar FALLA en vez de devolver basura que parezca válida. Ese
 * es justo el desastre que se quiere atrapar — datos corrompidos sin que nadie
 * note. Un respaldo que se "restaura" con basura adentro es peor que no tener
 * respaldo.
 *
 * Formato del Buffer: [ IV (12 bytes) | tag de autenticación (16) | datos ]
 */

const crypto = require("crypto");
const zlib = require("zlib");

const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12;   // el recomendado para GCM
const LARGO_TAG = 16;
const LARGO_LLAVE_HEX = 64; // 32 bytes

/** Lee RESPALDO_LLAVE del entorno.
 *  - Ausente o vacía -> null (el sistema decide qué hacer y AVISA).
 *  - Presente pero mal formada -> LANZA. Una llave a medias es un error de
 *    configuración que hay que ver de inmediato: aceptarla en silencio dejaría
 *    respaldos ilegibles el día que se necesiten. */
function llaveDesdeEnv(env = process.env) {
  // El nombre lleva "llave" a propósito: con `includeLocalVariables` de Sentry,
  // las variables locales de este frame viajan en el stack trace de cualquier
  // excepción, y el depurador de instrument.js filtra por nombre. Llamarla `hex`
  // mandaba la llave maestra en claro.
  const llaveHex = env.RESPALDO_LLAVE;
  if (!llaveHex) return null;
  if (!new RegExp(`^[0-9a-fA-F]{${LARGO_LLAVE_HEX}}$`).test(llaveHex)) {
    throw new Error(
      `RESPALDO_LLAVE debe ser ${LARGO_LLAVE_HEX} caracteres hexadecimales (32 bytes). ` +
      "Genera una nueva con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(llaveHex, "hex");
}

function generarLlaveNueva() {
  return crypto.randomBytes(32).toString("hex");
}

function empaquetar(objeto, llave) {
  const comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(objeto), "utf8"));
  const iv = crypto.randomBytes(LARGO_IV); // uno NUEVO por archivo, no reutilizable
  const cifrador = crypto.createCipheriv(ALGORITMO, llave, iv);
  const datos = Buffer.concat([cifrador.update(comprimido), cifrador.final()]);
  return Buffer.concat([iv, cifrador.getAuthTag(), datos]);
}

function desempaquetar(buffer, llave) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= LARGO_IV + LARGO_TAG) {
    throw new Error("El archivo de respaldo está incompleto o dañado");
  }
  const iv = buffer.subarray(0, LARGO_IV);
  const tag = buffer.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const datos = buffer.subarray(LARGO_IV + LARGO_TAG);

  try {
    const descifrador = crypto.createDecipheriv(ALGORITMO, llave, iv);
    descifrador.setAuthTag(tag);
    const comprimido = Buffer.concat([descifrador.update(datos), descifrador.final()]);
    return JSON.parse(zlib.gunzipSync(comprimido).toString("utf8"));
  } catch (_) {
    // Se traga el error original A PROPÓSITO: su texto puede filtrar detalles
    // del criptosistema. Para quien lo lee, las tres causas se ven igual —
    // llave equivocada, archivo alterado, archivo corrupto — y la acción es la
    // misma: ese respaldo no sirve, usa otro.
    throw new Error("El respaldo no se pudo descifrar — llave incorrecta o archivo dañado");
  }
}

module.exports = {
  llaveDesdeEnv, generarLlaveNueva, empaquetar, desempaquetar,
  ALGORITMO, LARGO_IV, LARGO_TAG,
};
