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
  if (error?.status === 403) return accion === "ver"
    ? "No tienes permiso para consultar demandas."
    : "No tienes permiso para registrar demandas.";
  const texto = String(error?.message || "");
  if (/motivo/i.test(texto)) return "Selecciona el motivo por el que no se realizó la venta.";
  if (/producto|describe/i.test(texto)) return "Indica qué producto pidió el cliente.";
  if (/cantidad/i.test(texto)) return "La cantidad debe ser mayor que cero.";
  if (/sucursal/i.test(texto)) return texto;
  return accion === "ver"
    ? "No fue posible cargar las demandas. Intenta nuevamente."
    : "No fue posible registrar la demanda. Intenta nuevamente.";
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

