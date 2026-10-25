/**
 * traspasosSicar.js — Funciones puras de la pantalla "Traspasos SICAR".
 * Sin React: se prueban con `node --test`. Las cifras son las de cada SICAR; aquí solo se presentan.
 */

const ESTADOS = { enviado: "Enviado", recibido: "Recibido", cancelado: "Cancelado" };

export const nombreEstado = (estado) => ESTADOS[estado] || String(estado ?? "—");

export const llaveTraspaso = (t) => `${t.sucursal_id}-${t.tra_id}`;

/** `sucursal_id` va SIEMPRE (vacío = todas): el selector del encabezado no recorta el resultado en silencio. */
export function parametrosTraspasos({ sucursal, desde, hasta, estado }) {
  const p = new URLSearchParams();
  p.set("sucursal_id", sucursal || "");
  if (desde) p.set("desde", desde);
  if (hasta) p.set("hasta", hasta);
  if (estado) p.set("estado", estado);
  return p.toString();
}

const TIPOS_ALERTA = [
  { clave: "sin_recibir_3_dias", resumen: "enviados sin recibir por más de 3 días" },
  { clave: "cancelado", resumen: "cancelados" },
  { clave: "sin_conciliar", resumen: "sin poder compararse: falta asignar la tienda en el mapa" },
  { clave: "puntas_ambiguas", resumen: "con dos registros posibles de la otra tienda" },
  { clave: "con_diferencias", resumen: "con piezas enviadas y recibidas que no cuadran" },
];

function textoAlerta(clave, t) {
  switch (clave) {
    case "sin_recibir_3_dias": {
      const d = Number(t.dias_en_transito);
      return `Enviado hace ${d} ${d === 1 ? "día" : "días"} y no recibido`;
    }
    case "cancelado": return "Cancelado";
    case "sin_conciliar": return "No se pudo comparar: falta asignar la tienda en el mapa";
    case "puntas_ambiguas": return "Dos registros posibles de la otra tienda: revisar";
    default: return "Piezas enviadas vs recibidas no cuadran";
  }
}

/** Las alertas de un renglón con texto claro. */
export function alertasDeTraspaso(t) {
  return TIPOS_ALERTA.filter((a) => t?.alertas?.[a.clave]).map((a) => ({ clave: a.clave, texto: textoAlerta(a.clave, t) }));
}

/** Cuántos renglones hay por tipo de alerta (los tipos sin renglones no salen). */
export function resumenDeAlertas(traspasos) {
  return TIPOS_ALERTA
    .map((a) => ({ clave: a.clave, texto: a.resumen, cantidad: (traspasos || []).filter((t) => t?.alertas?.[a.clave]).length }))
    .filter((a) => a.cantidad > 0);
}

/** Los enviados viejos sin recibir entran aunque caigan fuera de las fechas: se avisa para que no parezca error del filtro. */
export function etiquetaFueraDeRango(t, desde, hasta) {
  const dia = String(t?.fecha ?? "").slice(0, 10);
  if (!dia || (!desde && !hasta)) return "";
  const fuera = (desde && dia < desde) || (hasta && dia > hasta);
  return fuera ? "Pendiente de fechas anteriores" : "";
}

export function textoComparacion(t) {
  switch (t?.conciliacion) {
    case "dos_puntas": return "Comparado con la otra tienda";
    case "una_punta": return "Solo una tienda: todavía no llega el registro de la otra tienda";
    case "sin_mapa": return "No se pudo comparar: falta asignar la tienda en el mapa";
    case "mapa_no_coincide": return "No se pudo comparar: el mapa no coincide con este traspaso";
    case "ambigua": return "Dos registros posibles de la otra tienda: revisar";
    default: return "—";
  }
}

/** "12.0000" -> "12"; "0.0050" -> "0.005". Solo quita ceros de la derecha. */
export function formatoCantidad(texto) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(texto ?? ""));
  if (!m) return "—";
  const frac = (m[3] || "").replace(/0+$/, "");
  return `${m[1]}${m[2]}${frac ? `.${frac}` : ""}`;
}

/** El servidor exige las dos cosas para cambiar el mapa; sin ellas la pantalla solo lo muestra. */
export function puedeEditarMapa(permisos) {
  const lista = permisos || [];
  return lista.includes("administrar_sucursales") && lista.includes("ver_todas_las_sucursales");
}

export function textoSinAsignar(lista) {
  const l = lista || [];
  if (l.length === 0) return "";
  if (l.length === 1) return `El número SICAR ${l[0]} todavía no tiene tienda asignada.`;
  return `Los números SICAR ${l.join(", ")} todavía no tienen tienda asignada.`;
}
