import { apiFetch } from "../api";

export const MOTIVOS = [
  ["SIN_EXISTENCIA", "Sin existencia"],
  ["NO_MANEJAMOS", "No lo manejamos"],
  ["OTRA_MARCA", "Otra marca"],
  ["OTRA_VARIANTE", "Otra variante"],
  ["PRECIO", "Precio"],
  ["TIEMPO_ENTREGA", "Tiempo de entrega"],
  ["OTRO", "Otro"],
];

export const ESTADOS_TERMINALES = new Set(["CONVERTIDA", "NO_CONVERTIDA", "CANCELADA"]);

async function leerRespuesta(respuesta, mensajeGenerico) {
  let cuerpo = null;
  try { cuerpo = await respuesta.json(); } catch { /* respuesta sin JSON */ }
  if (!respuesta.ok) {
    const error = new Error(cuerpo?.error || mensajeGenerico);
    error.status = respuesta.status;
    throw error;
  }
  return cuerpo;
}

export function mensajeErrorRadar(error, accion = "guardar") {
  if (error?.status === 403) return "No tienes permiso para realizar esta acción.";
  if (error?.status === 404) return "La demanda ya no existe o pertenece a otra sucursal.";
  if (error?.status === 409) return error.message || "Ese cambio de estado ya no está permitido.";
  if (error?.status === 500) return "Ocurrió un error interno. Intenta nuevamente.";
  const texto = String(error?.message || "");
  if (/motivo/i.test(texto)) return "Selecciona el motivo por el que no se realizó la venta.";
  if (/producto|describe/i.test(texto)) return "Indica qué producto pidió el cliente.";
  if (/cantidad/i.test(texto)) return "La cantidad debe ser mayor que cero.";
  if (/obligatorio/i.test(texto)) return texto;
  if (/sucursal|venta|estado|fecha|campo/i.test(texto)) return texto;
  return accion === "ver"
    ? "No fue posible cargar las demandas. Intenta nuevamente."
    : "No fue posible completar la acción. Intenta nuevamente.";
}

export async function cargarMetaRadar() {
  return leerRespuesta(await apiFetch("/radar-demanda/meta"), "No fue posible cargar las acciones de Radar");
}

export async function obtenerDemanda(id) {
  return leerRespuesta(await apiFetch(`/radar-demanda/${id}`), "No fue posible cargar la demanda");
}

export async function obtenerHistorialDemanda(id) {
  return leerRespuesta(await apiFetch(`/radar-demanda/${id}/historial`), "No fue posible cargar el historial");
}

export async function registrarSeguimiento(id, comentario) {
  return leerRespuesta(await apiFetch(`/radar-demanda/${id}/seguimientos`, {
    method: "POST", body: JSON.stringify({ comentario }),
  }), "No fue posible registrar el seguimiento");
}

export async function actualizarDemanda(id, cambios) {
  return leerRespuesta(await apiFetch(`/radar-demanda/${id}`, {
    method: "PATCH", body: JSON.stringify(cambios),
  }), "No fue posible actualizar la demanda");
}

export async function cambiarEstadoDemanda(id, estado, comentario, ventaRecuperadaId) {
  const body = { estado, comentario };
  if (ventaRecuperadaId !== undefined) body.venta_recuperada_id = ventaRecuperadaId;
  return leerRespuesta(await apiFetch(`/radar-demanda/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
  }), "No fue posible cambiar el estado");
}

export async function listarVentasCandidatas(id, filtros = {}) {
  const query = new URLSearchParams();
  Object.entries(filtros).forEach(([clave, valor]) => { if (valor !== "" && valor != null) query.set(clave, valor); });
  const sufijo = query.size ? `?${query}` : "";
  return leerRespuesta(await apiFetch(`/radar-demanda/${id}/ventas-candidatas${sufijo}`), "No fue posible cargar las ventas candidatas");
}

export async function listarDemandas() {
  return leerRespuesta(await apiFetch("/radar-demanda"), "No fue posible cargar las demandas");
}

export async function registrarDemanda(datos) {
  return leerRespuesta(await apiFetch("/radar-demanda", {
    method: "POST",
    body: JSON.stringify(datos),
  }), "No fue posible registrar la demanda");
}

export async function cargarCatalogosRadar() {
  const [productosRespuesta, clientesRespuesta] = await Promise.all([
    apiFetch("/productos"), apiFetch("/clientes"),
  ]);
  const productos = productosRespuesta.ok ? await productosRespuesta.json() : [];
  const clientes = clientesRespuesta.ok ? await clientesRespuesta.json() : [];
  return { productos, clientes };
}
