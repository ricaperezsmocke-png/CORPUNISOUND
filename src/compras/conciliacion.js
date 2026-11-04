import { fechaCorta, formatoCentavos } from "./facturasPorLlegar.js";

export const puedeConciliar = (permisos) => (permisos || []).includes("conciliar_facturas");
// Decisión de Victor: marcar a mano "Ya llegó" es conciliar; quien solo registra facturas no lo ve.
export const puedeMarcarLlego = (permisos) => puedeConciliar(permisos);
export function textoCerrada(c) {
  return `Compra SICAR ${c.folio || "—"} del ${fechaCorta(c.fecha)} · ${formatoCentavos(c.total_centavos)}`
    + ` · cerrada por ${c.actor_nombre}: ${c.motivo}`;
}
export const motivoConciliacionValido = (motivo) => typeof motivo === "string" && motivo.trim().length > 0;
export function textoAutor(compra) {
  if (compra.modo === "automatica") return "Unida sola";
  const nombre = typeof compra.actor_nombre === "string" ? compra.actor_nombre.trim() : "";
  return nombre ? `Confirmada por ${nombre}` : "Confirmada manualmente";
}
// En avisos de unión, `fecha` es el día de la unión: la fecha de la compra en SICAR viene en `fecha_compra`.
export const fechaDeCompra = (compra) => compra.fecha_compra || compra.fecha;

export function textoUnion(compra) {
  return `Llegó · compra SICAR ${compra.folio || "—"} del ${fechaCorta(compra.fecha)} · ${formatoCentavos(compra.total_centavos)}`;
}

// Solo calcula el texto de antigüedad: qué filas son rojas lo decide el servidor.
export function avisosRojos(resumen, ahora = new Date()) {
  if (!resumen) return [];
  const dia = 86400000;
  const facturas = (resumen.facturas_sin_compra_15 || []).map(f => {
    const dias = Math.floor((ahora.getTime() - Date.parse(f.creada_en)) / dia);
    return { tipo: "factura", fila: f, dias, texto: `Factura sin compra en SICAR desde hace ${dias} días` };
  });
  const canceladas = (resumen.canceladas_despues || []).map(c => ({
    tipo: "cancelada", fila: c, dias: 0, texto: "La compra se canceló en SICAR después de unida",
  }));
  const cambiaron = (resumen.cambiaron || []).map(c => ({
    tipo: "cambio", fila: c, dias: 0,
    texto: `La compra cambió en SICAR después de unida: antes ${formatoCentavos(c.total_al_unir_centavos)}, ahora ${formatoCentavos(c.total_centavos)}`,
  }));
  return [...facturas, ...canceladas, ...cambiaron].sort((a, b) => b.dias - a.dias);
}

// Compras que el agente no pudo leer: no entran a la conciliación, pero alguien tiene que revisarlas en SICAR.
export function avisosOmitidas(resumen) {
  return (resumen?.compras_omitidas || []).map(o => ({
    clave: `${o.sucursal_id}:${o.com_id}`,
    texto: `Compra de SICAR ${o.com_id} no se pudo leer (${o.codigo}); revísala en SICAR de CEDIS.`,
  }));
}

// Lista y resumen se piden por separado: si uno falla, el otro se ve igual y cada uno muestra su error.
export async function cargarConciliacion(pedir, estado) {
  const leer = async (ruta, mensaje) => {
    const r = await pedir(ruta);
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) throw new Error(cuerpo?.error || mensaje);
    return cuerpo;
  };
  const [lista, resumen] = await Promise.allSettled([
    leer(`/facturas-por-llegar${estado ? `?estado=${estado}` : ""}`, "No se pudieron cargar las facturas."),
    leer("/facturas-compras/resumen", "No se pudo cargar la conciliación con compras de SICAR."),
  ]);
  const motivo = (r, mensaje) => (r.status === "rejected" ? r.reason?.message || mensaje : "");
  return {
    datos: lista.status === "fulfilled" ? lista.value : null,
    error: motivo(lista, "No se pudieron cargar las facturas."),
    resumen: resumen.status === "fulfilled" ? resumen.value : null,
    errorResumen: motivo(resumen, "No se pudo cargar la conciliación con compras de SICAR."),
  };
}
