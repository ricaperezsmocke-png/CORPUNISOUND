/**
 * exportarCSV.js — Descarga un archivo delimitado por comas que abre
 * directo en Excel. Mismo mecanismo que ya usa ConsultasVentas.exportarCSV,
 * extraído aquí para reutilizarse en los 7 reportes.
 */
export function descargarCSV(nombreArchivo, encabezados, filas) {
  const csv = [encabezados, ...filas].map((f) => f.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
