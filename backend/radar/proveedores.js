/**
 * proveedores.js — Con qué proveedor se consigue lo que pidió el cliente.
 *
 * Decisión de Victor (2026-10-23): al registrar una demanda el vendedor dice
 * el proveedor, de la lista que manda SICAR o escribiéndolo en "Otro
 * proveedor". Compras ve lo pendiente agrupado por proveedor para armar el
 * pedido de un jalón.
 *
 * El proveedor que manda el navegador no es de fiar: aquí se valida contra la
 * lista real y se guarda una copia del nombre en la demanda, para que siga
 * leyéndose aunque el proveedor cambie de nombre o desaparezca de SICAR.
 *
 * Proyección pura: no lee ni escribe persistencia, catálogo ni inventario.
 */

const { ErrorRadar } = require("./errores");
const { clasificarEstadoDemanda } = require("./metricas");
const { diaDeRegistro } = require("./fechaRegistro");

const MINIMO_OTRO = 2;
const MAXIMO_OTRO = 120;
const CONTROLES = /[\u0000-\u001f\u007f�]/u;

const limpiar = (valor) => String(valor ?? "").replace(/\s+/g, " ").trim();

/** Clave de un proveedor: minúsculas, sin acentos y con los espacios colapsados. */
function normalizarNombreProveedor(valor) {
  return limpiar(valor).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

/**
 * Los proveedores de todas las tiendas juntos, una sola entrada por nombre
 * normalizado. Gana el primero que llega (las filas vienen por tienda y por id).
 */
function listaProveedoresRadar(filas = []) {
  const porClave = new Map();
  for (const fila of filas) {
    if (typeof fila?.nombre !== "string") continue;
    const nombre = limpiar(fila.nombre);
    const clave = normalizarNombreProveedor(nombre);
    if (clave && !porClave.has(clave)) porClave.set(clave, { clave, nombre });
  }
  return [...porClave.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

const viene = (valor) => valor !== undefined && valor !== null && valor !== "";

/**
 * Lo que se guarda en la demanda. Falla cerrando: sin proveedor, con una clave
 * que no está en la lista o con un "otro" fuera de 2 a 120 caracteres, no hay
 * demanda.
 */
function resolverProveedor(datos, proveedores = []) {
  const clave = datos?.proveedor_clave;
  const otro = datos?.proveedor_texto;
  if (viene(clave) && viene(otro)) {
    throw new ErrorRadar("Elige un proveedor de la lista o escribe otro proveedor, no los dos", 400);
  }
  if (viene(clave)) {
    if (typeof clave !== "string") throw new ErrorRadar("El proveedor no es válido", 400);
    const encontrado = proveedores.find((p) => p.clave === clave);
    if (!encontrado) throw new ErrorRadar("El proveedor no está en la lista de SICAR: elige otro o escríbelo en Otro proveedor", 400);
    return { proveedor_clave: encontrado.clave, proveedor_nombre: encontrado.nombre, proveedor_por_revisar: false };
  }
  if (viene(otro)) {
    if (typeof otro !== "string" || CONTROLES.test(otro)) throw new ErrorRadar("El nombre del otro proveedor no es válido", 400);
    const nombre = limpiar(otro);
    if (nombre.length < MINIMO_OTRO || nombre.length > MAXIMO_OTRO) {
      throw new ErrorRadar(`El otro proveedor debe tener entre ${MINIMO_OTRO} y ${MAXIMO_OTRO} caracteres`, 400);
    }
    const normalizado = normalizarNombreProveedor(nombre);
    // Si lo escribió a mano pero sí está en la lista, se toma de la lista: no hay nada que revisar.
    const conocido = proveedores.find((p) => p.clave === normalizado);
    if (conocido) return { proveedor_clave: conocido.clave, proveedor_nombre: conocido.nombre, proveedor_por_revisar: false };
    return { proveedor_clave: normalizado, proveedor_nombre: nombre, proveedor_por_revisar: true };
  }
  throw new ErrorRadar("Indica con qué proveedor se consigue el producto", 400);
}

function diasEntre(desde, hasta) {
  if (!desde || !hasta) return null;
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
}

const masVieja = (actual, dia) => (dia && (!actual || dia < actual) ? dia : actual);

function nombresSucursales(ids, sucursalPorId) {
  return [...ids].map((id) => sucursalPorId.get(id)?.nombre || `Sucursal ${id}`).sort((a, b) => a.localeCompare(b, "es"));
}

function acumular(destino, registro) {
  destino.solicitudes += 1;
  destino.piezas += Number(registro.cantidad) || 0;
  destino.sucursales.add(Number(registro.sucursal_id));
  destino.vieja = masVieja(destino.vieja, diaDeRegistro(registro.fecha_registro));
}

function nuevoGrupo(clave, registro) {
  return { clave, nombre: clave ? limpiar(registro.proveedor_nombre) || clave : "Sin proveedor", sin_proveedor: !clave,
    por_revisar: false, solicitudes: 0, solicitudes_por_revisar: 0, piezas: 0, sucursales: new Set(), vieja: null, articulos: new Map() };
}

/** El mismo artículo: por producto del catálogo, o por lo escrito (descripción, marca y modelo). */
function articuloDe(registro, productoPorId) {
  const productoId = registro.producto_id == null ? null : Number(registro.producto_id);
  const producto = productoId == null ? null : productoPorId.get(productoId);
  const descripcion = limpiar(producto?.nombre) || limpiar(registro.producto_nombre_registrado) || limpiar(registro.producto_buscado);
  const marca = limpiar(registro.marca_solicitada);
  const modelo = limpiar(registro.modelo_solicitado);
  const llave = productoId != null ? `p:${productoId}` : `t:${[descripcion, marca, modelo].map(normalizarNombreProveedor).join("|")}`;
  return { llave, base: { producto_id: productoId, descripcion: descripcion || "Sin descripción", marca, modelo } };
}

/**
 * Sección "Por proveedor" de Inteligencia de compras. Solo demanda pendiente
 * (los mismos estados que los faltantes). Las demandas viejas sin proveedor
 * caen en "Sin proveedor", al final; no se migra ni se borra nada.
 */
function agruparPorProveedor(registros, { fechaFin, sucursales = [], productos = [] } = {}) {
  const sucursalPorId = new Map(sucursales.map((s) => [Number(s.id), s]));
  const productoPorId = new Map(productos.map((p) => [Number(p.id), p]));
  const grupos = new Map();
  const ordenados = [...registros].sort((a, b) => String(b.fecha_registro || "").localeCompare(String(a.fecha_registro || "")));
  for (const registro of ordenados) {
    if (clasificarEstadoDemanda(registro?.estado) !== "PENDIENTE") continue;
    const clave = limpiar(registro.proveedor_clave) || normalizarNombreProveedor(registro.proveedor_nombre) || null;
    const llave = clave ?? "";
    if (!grupos.has(llave)) grupos.set(llave, nuevoGrupo(clave, registro));
    const grupo = grupos.get(llave);
    acumular(grupo, registro);
    if (registro.proveedor_por_revisar === true) { grupo.por_revisar = true; grupo.solicitudes_por_revisar += 1; }
    const { llave: llaveArticulo, base } = articuloDe(registro, productoPorId);
    if (!grupo.articulos.has(llaveArticulo)) {
      grupo.articulos.set(llaveArticulo, { ...base, solicitudes: 0, piezas: 0, sucursales: new Set(), vieja: null });
    }
    acumular(grupo.articulos.get(llaveArticulo), registro);
  }
  const porPiezas = (a, b) => b.piezas - a.piezas || a.nombre.localeCompare(b.nombre, "es");
  return [...grupos.values()].map((g) => ({
    clave: g.clave, nombre: g.nombre, sin_proveedor: g.sin_proveedor, por_revisar: g.por_revisar,
    solicitudes: g.solicitudes, solicitudes_por_revisar: g.solicitudes_por_revisar, piezas: g.piezas,
    sucursales: nombresSucursales(g.sucursales, sucursalPorId), dias_mas_vieja: diasEntre(g.vieja, fechaFin),
    articulos: [...g.articulos.values()].map((a) => ({
      producto_id: a.producto_id, descripcion: a.descripcion, marca: a.marca, modelo: a.modelo, solicitudes: a.solicitudes,
      piezas: a.piezas, sucursales: nombresSucursales(a.sucursales, sucursalPorId), dias_mas_vieja: diasEntre(a.vieja, fechaFin),
    })).sort((a, b) => b.piezas - a.piezas || a.descripcion.localeCompare(b.descripcion, "es")),
  })).sort((a, b) => Number(a.sin_proveedor) - Number(b.sin_proveedor) || porPiezas(a, b));
}

module.exports = {
  normalizarNombreProveedor, listaProveedoresRadar, resolverProveedor, agruparPorProveedor, MINIMO_OTRO, MAXIMO_OTRO,
};
