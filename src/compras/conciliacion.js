import { fechaCorta, formatoCentavos } from "./facturasPorLlegar.js";

export const puedeConciliar = (permisos) => (permisos || []).includes("conciliar_facturas");
export const motivoConciliacionValido = (motivo) => typeof motivo === "string" && motivo.trim().length > 0;
export const textoAutor = (compra) => compra.modo === "automatica" ? "Unida sola" : `Confirmada por ${compra.actor_nombre}`;
export const textoViejas = (n) => `${n} compras anteriores sin factura (no se marcan en rojo)`;

export function textoUnion(compra) {
  return `Llegó · compra SICAR ${compra.folio || "—"} del ${fechaCorta(compra.fecha)} · ${formatoCentavos(compra.total_centavos)}`;
}

// Solo calcula el texto de antigüedad: qué filas son rojas lo decide el servidor.
export function avisosRojos(resumen, ahora = new Date()) {
  if (!resumen) return [];
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(ahora);
  const parte = (tipo) => partes.find(p => p.type === tipo).value;
  const hoy = Date.parse(`${parte("year")}-${parte("month")}-${parte("day")}T00:00:00Z`);
  const dia = 86400000;
  const facturas = (resumen.facturas_sin_compra_15 || []).map(f => {
    const dias = Math.floor((ahora.getTime() - Date.parse(f.creada_en)) / dia);
    return { tipo: "factura", fila: f, dias, texto: `Factura sin compra en SICAR desde hace ${dias} días` };
  });
  const compras = (resumen.compras_sin_factura_15 || []).map(c => {
    const dias = Math.floor((hoy - Date.parse(c.fecha.slice(0, 10) + "T00:00:00Z")) / dia);
    return { tipo: "compra", fila: c, dias, texto: `Compra de SICAR sin factura desde hace ${dias} días` };
  });
  const canceladas = (resumen.canceladas_despues || []).map(c => ({
    tipo: "cancelada", fila: c, dias: 0, texto: "La compra se canceló en SICAR después de unida",
  }));
  const cambiaron = (resumen.cambiaron || []).map(c => ({
    tipo: "cambio", fila: c, dias: 0,
    texto: `La compra cambió en SICAR después de unida: antes ${formatoCentavos(c.total_al_unir_centavos)}, ahora ${formatoCentavos(c.total_centavos)}`,
  }));
  return [...facturas, ...compras, ...canceladas, ...cambiaron].sort((a, b) => b.dias - a.dias);
}
