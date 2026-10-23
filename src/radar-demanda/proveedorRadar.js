/**
 * proveedorRadar.js — Lo que la pantalla del Radar necesita saber del
 * proveedor, sin React para poder probarlo.
 *
 * El servidor es quien decide: valida la clave contra la lista de SICAR y el
 * "otro proveedor" de 2 a 120 caracteres. Aquí solo se avisa antes de mandar,
 * para que el vendedor no tenga que esperar la respuesta para corregir.
 */

export const PROVEEDOR_VACIO = Object.freeze({ modo: "lista", clave: "", texto: "" });
export const MINIMO_OTRO = 2;
export const MAXIMO_OTRO = 120;
export const RESULTADOS_PROVEEDOR = 8;

/** Igual que en el servidor: minúsculas, sin acentos y espacios colapsados. */
export function normalizarProveedor(valor) {
  return String(valor ?? "").replace(/\s+/g, " ").trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

/** Buscador de la lista: cada palabra escrita tiene que aparecer en el nombre. */
export function filtrarProveedores(lista = [], busqueda = "", limite = RESULTADOS_PROVEEDOR) {
  const palabras = normalizarProveedor(busqueda).split(" ").filter(Boolean);
  return lista.filter((p) => palabras.every((palabra) => normalizarProveedor(p.nombre).includes(palabra))).slice(0, limite);
}

/** Mensaje para el vendedor, o "" si se puede mandar. */
export function validarProveedorFormulario(seleccion = PROVEEDOR_VACIO) {
  if (seleccion.modo === "otro") {
    const largo = String(seleccion.texto || "").replace(/\s+/g, " ").trim().length;
    if (!largo) return "Escribe el nombre del otro proveedor.";
    if (largo < MINIMO_OTRO || largo > MAXIMO_OTRO) return `El otro proveedor debe tener entre ${MINIMO_OTRO} y ${MAXIMO_OTRO} caracteres.`;
    return "";
  }
  return seleccion.clave ? "" : "Elige con qué proveedor se consigue, o escríbelo en Otro proveedor.";
}

/** Solo uno de los dos campos viaja: el servidor rechaza los dos juntos. */
export function datosProveedor(seleccion = PROVEEDOR_VACIO) {
  return seleccion.modo === "otro" ? { proveedor_texto: String(seleccion.texto || "").trim() } : { proveedor_clave: seleccion.clave };
}

/** Cómo se lee el proveedor de una demanda ya guardada. Las viejas no tienen. */
export function etiquetaProveedor(demanda) {
  const nombre = String(demanda?.proveedor_nombre || "").trim();
  if (!nombre) return "Sin proveedor";
  return demanda.proveedor_por_revisar ? `${nombre} (otro proveedor, por revisar)` : nombre;
}

export function textoDias(dias) {
  if (dias == null || !Number.isFinite(Number(dias))) return "—";
  const n = Number(dias);
  if (n <= 0) return "hoy";
  return n === 1 ? "hace 1 día" : `hace ${n} días`;
}
