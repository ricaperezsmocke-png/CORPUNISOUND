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

/**
 * Construye un índice clave -> producto (por sku y por clave_alterna) para
 * evitar un `.find()` de recorrido lineal sobre todo el catálogo por cada
 * agregado. Se arma UNA vez por llamada (no por agregado) — con catálogos
 * reales de cientos/miles de productos y decenas de miles de agregados, la
 * búsqueda lineal repetida es el cuello de botella real (ver hallazgo de
 * revisión de rendimiento).
 */
function construirIndiceProductosPorClave(DB) {
  const indice = new Map();
  for (const p of DB["catalogo-productos"].productos) {
    if (p.sku) indice.set(p.sku, p);
    if (p.clave_alterna) indice.set(p.clave_alterna, p);
  }
  return indice;
}

function previsualizarHistorialVentas(DB, agregados) {
  const indice = construirIndiceProductosPorClave(DB);
  const clavesReconocidas = new Set();
  const clavesIgnoradas = new Set();
  for (const a of agregados) {
    const producto = indice.get(a.clave) || null;
    (producto ? clavesReconocidas : clavesIgnoradas).add(a.clave);
  }
  return {
    claves_reconocidas: clavesReconocidas.size,
    claves_ignoradas: clavesIgnoradas.size,
    total_renglones_agregados: agregados.length,
  };
}

function aplicarHistorialVentas(DB, agregados, sucursal_id) {
  if (!Array.isArray(DB.pos.historial_ventas_mensual)) DB.pos.historial_ventas_mensual = [];
  const indiceProductos = construirIndiceProductosPorClave(DB);

  // Índice de renglones existentes por (producto_id, sucursal_id, periodo)
  // para que "encontrar el renglón a reemplazar" sea O(1) en vez de una
  // búsqueda lineal sobre un arreglo que crece con cada renglón aplicado
  // (lo que volvía a este paso O(A²) sobre todo el import). Se actualiza
  // al vuelo cuando se agrega un renglón nuevo, para que un agregado
  // posterior en la MISMA llamada que apunte a la misma clave lo encuentre.
  const indiceExistentes = new Map();
  for (const h of DB.pos.historial_ventas_mensual) {
    indiceExistentes.set(`${h.producto_id}|${h.sucursal_id}|${h.periodo}`, h);
  }

  const productosActualizados = new Set();
  let renglonesAplicados = 0;

  for (const a of agregados) {
    const producto = indiceProductos.get(a.clave) || null;
    if (!producto) continue;

    const sucursalIdNum = Number(sucursal_id);
    const llave = `${producto.id}|${sucursalIdNum}|${a.periodo}`;
    const existente = indiceExistentes.get(llave);
    if (existente) {
      existente.cantidad = a.cantidad;
    } else {
      const nuevo = { producto_id: producto.id, sucursal_id: sucursalIdNum, periodo: a.periodo, cantidad: a.cantidad };
      DB.pos.historial_ventas_mensual.push(nuevo);
      indiceExistentes.set(llave, nuevo);
    }
    productosActualizados.add(producto.id);
    renglonesAplicados++;
  }

  return { producto_id_actualizados: productosActualizados.size, renglones_aplicados: renglonesAplicados };
}

module.exports = { parsearReporteVentasSicar, previsualizarHistorialVentas, aplicarHistorialVentas };
