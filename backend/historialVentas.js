/**
 * historialVentas.js — Importa el "Reporte General de Ventas" de SICAR
 * (CSV, exportado por sucursal) para alimentar el motor de predicción de
 * demanda (backend/predicciones.js) con años de historial real.
 *
 * El reporte NO es una tabla plana: es un reporte jerárquico exportado
 * tal cual se vería impreso. Se repite un renglón de "ticket" (columna 0
 * = "Ticket" o "Nota de Venta", columna 3 = fecha) seguido de uno o más
 * renglones de "producto" (alguna columna con el patrón [CLAVE]
 * DESCRIPCION entre corchetes, columna 1 = cantidad).
 *
 * Este módulo agrega cantidades por (clave, mes) al leer el archivo y
 * NUNCA guarda tickets ni renglones individuales — ver
 * docs/superpowers/specs/2026-07-15-historial-ventas-prediccion-design.md.
 * El resultado agregado se guarda en DB.pos.historial_ventas_mensual,
 * una colección separada por completo de DB.pos.ventas/venta_detalle.
 */

const TIPOS_TICKET = new Set(["Ticket", "Nota de Venta"]);

function parsearLineaCsv(linea) {
  const campos = [];
  let actual = "";
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') { enComillas = !enComillas; continue; }
    if (c === "," && !enComillas) { campos.push(actual); actual = ""; continue; }
    actual += c;
  }
  campos.push(actual);
  return campos;
}

function parsearReporteVentasSicar(csvTexto) {
  const lineas = csvTexto.split(/\r?\n/);
  // El "Reporte General de Ventas" de SICAR siempre inicia con este título
  // como primera línea no vacía (ver encabezado confirmado en el fixture
  // de pruebas). Un reporte real puede no tener ningún ticket (p. ej. una
  // sucursal sin ventas en el rango exportado) y eso NO es un error; lo
  // que sí es un error es que el texto ni siquiera tenga la forma de un
  // reporte de SICAR.
  const primeraLineaNoVacia = lineas.find((l) => l.trim()) || "";
  const pareceReporteSicar = /reporte general de ventas/i.test(primeraLineaNoVacia);
  const mapaAgregado = new Map();
  let ticketsLeidos = 0;
  let renglonesLeidos = 0;
  let fechaActual = null;
  let fechaMin = null;
  let fechaMax = null;

  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const campos = parsearLineaCsv(linea);
    const primera = (campos[0] || "").trim();

    if (TIPOS_TICKET.has(primera)) {
      const fechaTexto = (campos[3] || "").trim();
      const m = fechaTexto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) {
        fechaActual = `${m[3]}-${m[2]}`;
        const fechaOrdenable = `${m[3]}-${m[2]}-${m[1]}`;
        if (!fechaMin || fechaOrdenable < fechaMin) fechaMin = fechaOrdenable;
        if (!fechaMax || fechaOrdenable > fechaMax) fechaMax = fechaOrdenable;
      } else {
        fechaActual = null;
      }
      ticketsLeidos++;
      continue;
    }

    if (!fechaActual) continue;

    let claveEncontrada = null;
    for (const campo of campos) {
      const m = campo.match(/^\s*\[([^\]]+)\]/);
      if (m) { claveEncontrada = m[1].trim(); break; }
    }
    if (!claveEncontrada) continue;

    const cantidad = Number((campos[1] || "").trim());
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

    renglonesLeidos++;
    const key = `${claveEncontrada}|${fechaActual}`;
    if (!mapaAgregado.has(key)) mapaAgregado.set(key, { clave: claveEncontrada, periodo: fechaActual, cantidad: 0 });
    mapaAgregado.get(key).cantidad += cantidad;
  }

  if (ticketsLeidos === 0 && !pareceReporteSicar) {
    throw new Error("El archivo no se pudo leer como reporte de ventas de SICAR (no se encontró ningún renglón de Ticket o Nota de Venta)");
  }

  return {
    agregados: [...mapaAgregado.values()],
    resumen: { tickets_leidos: ticketsLeidos, renglones_leidos: renglonesLeidos, fecha_min: fechaMin, fecha_max: fechaMax },
  };
}

module.exports = { parsearReporteVentasSicar };
