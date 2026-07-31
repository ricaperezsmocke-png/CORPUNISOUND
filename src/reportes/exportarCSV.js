/**
 * exportarCSV.js — Descarga un archivo delimitado por comas que abre
 * directo en Excel. Usado por los 8 reportes y por Consultas de Ventas.
 */

/**
 * Prepara un campo para el CSV (RFC 4180): si trae coma, comilla o salto de
 * línea, se entrecomilla todo el campo y las comillas internas se duplican.
 *
 * Sin esto, un solo campo con coma corre TODAS las columnas siguientes de ese
 * renglón: una descripción como "Envío a Tuxtla, ida y vuelta" dejaba el
 * renglón con un campo extra, el monto caía en una columna sin encabezado y
 * SUMA() de la columna Monto devolvía 0 en Excel sin avisar de nada. Pasa con
 * cualquier texto libre: razones sociales ("Distribuidora Musical, S.A. de
 * C.V."), nombres de cliente y de producto, motivos de cancelación.
 */
/** Excel y Google Sheets tratan como FÓRMULA cualquier campo que empiece con
 *  = + - @ (o tabulador / retorno de carro). Como los reportes exportan texto
 *  que captura el usuario (descripción de un gasto, nombre de cliente, motivo
 *  de cancelación), alguien podría dejar ahí un `=HYPERLINK(...)` que se
 *  dispara al abrir el archivo, y basta un `=1+1` para que la celda muestre
 *  algo distinto de lo capturado. El prefijo `'` obliga a Excel a leerlo como
 *  texto.
 *
 *  OJO: los números se dejan intactos a propósito. Un monto negativo (-150)
 *  empieza con "-" y es un dato válido; prefijarlo lo volvería texto y
 *  rompería SUMA() en la columna, que es justo el bug que se acaba de
 *  arreglar. */
const ARRANQUE_DE_FORMULA = /^[=+\-@\t\r]/;

function neutralizarFormula(texto) {
  // Se evalúa sin los espacios de la izquierda: " =1+1" no lo alcanzaría el
  // regex, y aunque Excel trata esa celda como texto, algunas rutas de
  // importación de Google Sheets recortan el espacio y vuelven a exponerla.
  if (!ARRANQUE_DE_FORMULA.test(texto.trimStart())) return texto;
  if (texto.trim() !== "" && Number.isFinite(Number(texto))) return texto;
  return `'${texto}`;
}

function prepararCampo(valor) {
  const texto = neutralizarFormula(valor == null ? "" : String(valor));
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** BOM de UTF-8 (U+FEFF). Le dice a Excel en qué codificación viene el
 *  archivo; sin él, Excel en español lo abre como ANSI y los acentos salen
 *  como basura ("Reparación", "Yajalón", "Mínima", "Garantías"). Se construye
 *  con fromCharCode a propósito: escrito como carácter literal sería un byte
 *  invisible en el código fuente, fácil de borrar sin darse cuenta. */
const BOM_UTF8 = String.fromCharCode(0xfeff);

export function descargarCSV(nombreArchivo, encabezados, filas) {
  const csv = [encabezados, ...filas].map((f) => f.map(prepararCampo).join(",")).join("\n");
  const blob = new Blob([BOM_UTF8 + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
