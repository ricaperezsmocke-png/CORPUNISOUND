// Funciones puras de la pantalla "Seguimiento de facturas CEDIS". Piezas llegan en diezmilésimas y dinero en
// centavos, ambos como texto: se convierten con BigInt para no perder precisión.

const PIEZA = 10000n;
const miles = (texto) => texto.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const esEntero = (v) => typeof v === "string" && /^-?\d+$/.test(v);

export const TEXTOS = {
  fifo: "Asignación estimada en orden de llegada (FIFO) según SICAR.",
  gris: "Enviado, venta no comprobada",
  por_aclarar: "Movimientos por aclarar",
  insuficiente: "Información insuficiente",
  comentario: "El comentario de la compra se muestra como referencia, no como destino real.",
  sin_traslado: "Sin traslado sugerido: ninguna tienda cumple las reglas (vender al menos el doble, en 2 semanas distintas "
    + "y con menos de 4 semanas de mercancía).",
};

const FORMATO_LOCAL = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Marca ISO (UTC) a fecha y hora de Chiapas: "AAAA-MM-DD HH:MM", o solo la fecha. */
export function fechaHoraLocal(iso, { soloFecha = false } = {}) {
  const d = new Date(iso ?? "");
  if (!iso || !Number.isFinite(d.getTime())) return "—";
  const p = Object.fromEntries(FORMATO_LOCAL.formatToParts(d).map((x) => [x.type, x.value]));
  const fecha = `${p.year}-${p.month}-${p.day}`;
  return soloFecha ? fecha : `${fecha} ${p.hour}:${p.minute}`;
}

export function piezasTexto(diezmilesimas) {
  if (!esEntero(diezmilesimas)) return "—";
  const v = BigInt(diezmilesimas), signo = v < 0n ? "-" : "", abs = v < 0n ? -v : v;
  const fraccion = String(abs % PIEZA).padStart(4, "0").replace(/0+$/, "");
  return `${signo}${miles(String(abs / PIEZA))}${fraccion ? `.${fraccion}` : ""}`;
}

export function pesosTexto(centavos) {
  if (!esEntero(centavos)) return "—";
  const v = BigInt(centavos), signo = v < 0n ? "-" : "", abs = v < 0n ? -v : v;
  return `${signo}$${miles(String(abs / 100n))}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Porcentaje con un decimal, redondeado a la mitad hacia arriba. Total cero = null. */
export function porcentaje(parte, total) {
  const t = BigInt(total ?? 0), p = BigInt(parte ?? 0);
  if (t <= 0n) return null;
  return Number((p * 2000n + t) / (2n * t)) / 10;
}

const TRAMOS = [
  { id: "vendido", etiqueta: "Vendido", pieza: "vendido", color: "bg-emerald-600" },
  { id: "queda", etiqueta: "Queda", pieza: "queda", color: "bg-blue-600" },
  { id: "transito", etiqueta: "En tránsito", pieza: "transito", color: "bg-sky-300" },
  { id: "gris", etiqueta: TEXTOS.gris, pieza: "sin_agente", color: "bg-slate-400" },
  { id: "por_aclarar", etiqueta: TEXTOS.por_aclarar, pieza: "por_aclarar", color: "bg-amber-400" },
];

/** Valor con IVA y sin IVA. Sin dato con IVA se muestra solo el sin IVA, siempre con su leyenda. */
export function valorConIvaTexto(sinIva, conIva) {
  const sin = `${pesosTexto(sinIva)} sin IVA`;
  return esEntero(conIva) ? `${pesosTexto(conIva)} con IVA · ${sin}` : sin;
}

export function totalFacturaTexto(f) {
  if (!f.dinero || !esEntero(f.total_sin_iva_centavos)) return "Total factura: No calculable";
  return `Total factura: ${valorConIvaTexto(f.total_sin_iva_centavos, f.dinero_con_iva ? f.total_con_iva_centavos : null)}`;
}

/** Montos de un tramo: con IVA de principal y sin IVA de secundario; sin dato con IVA, solo sin IVA con su leyenda. */
function montosTramo(f, id) {
  if (!f.dinero) return { principal: "No calculable", secundario: null };
  const sin = `${pesosTexto(f.dinero[id])} sin IVA`;
  return f.dinero_con_iva ? { principal: pesosTexto(f.dinero_con_iva[id]), secundario: sin } : { principal: sin, secundario: null };
}

/**
 * Los cinco tramos de la barra. El ancho sale del dinero sin IVA (el mismo reparto que con IVA); si no es calculable,
 * de las piezas. `dinero` es el sin IVA; `principal`/`secundario` son lo que se muestra.
 */
export function tramosDeFactura(f) {
  const totalDinero = f.dinero ? TRAMOS.reduce((a, t) => a + BigInt(f.dinero[t.id]), 0n) : 0n;
  return TRAMOS.map((t) => ({
    id: t.id, etiqueta: t.etiqueta, color: t.color,
    piezas: piezasTexto(f.piezas[t.pieza]),
    dinero: f.dinero ? pesosTexto(f.dinero[t.id]) : "No calculable",
    ...montosTramo(f, t.id),
    porcentaje: (f.dinero ? porcentaje(f.dinero[t.id], totalDinero) : porcentaje(f.piezas[t.pieza], f.piezas.comprado)) ?? 0,
  }));
}

const ETAPAS = {
  traslado: "Revisar traslado",
  margen_75: "Bajar precio (conservar 75 % de la ganancia)",
  margen_50: "Bajar precio (conservar 50 % de la ganancia)",
  liquidar: "Liquidar a costo",
};
export const etiquetaEtapa = (etapa) => ETAPAS[etapa] || "Sin aviso";

export function siguienteAccion(f) {
  const faltan = f.renglones_sin_seguimiento || 0;
  if (faltan > 0) {
    return `${TEXTOS.insuficiente}: ${faltan} ${faltan === 1 ? "renglón" : "renglones"} sin clave en el catálogo de CEDIS`;
  }
  const p = f.piezas || {};
  const saldo = BigInt(p.queda ?? "0") + BigInt(p.transito ?? "0");
  if (!f.aviso && saldo === 0n) {
    // Sin saldo para avisos, pero lo gris o por aclarar sigue pendiente: nunca se presenta como agotada.
    if (BigInt(p.sin_agente ?? "0") > 0n) return "Pendiente de comprobación";
    if (BigInt(p.por_aclarar ?? "0") > 0n) return TEXTOS.por_aclarar;
    return "Agotada";
  }
  if (f.aviso?.estado === "pospuesto") return `Pospuesto hasta ${f.aviso.pospuesto_hasta}`;
  if (f.aviso?.estado === "revisado") return `Revisado: ${etiquetaEtapa(f.aviso.etapa)}`;
  return etiquetaEtapa(f.etapa);
}

export const puedeGestionar = (permisos) => (permisos || []).includes("gestionar_seguimiento_facturas");

export function parametrosLista(filtros) {
  const p = new URLSearchParams();
  for (const campo of ["proveedor", "folio", "clave", "desde", "hasta", "tienda", "etapa"]) {
    const v = typeof filtros[campo] === "string" ? filtros[campo].trim() : filtros[campo];
    if (v !== undefined && v !== null && v !== "") p.set(campo, String(v));
  }
  if (filtros.solo_aviso) p.set("solo_aviso", "1");
  if (filtros.ocultar_agotadas) p.set("ocultar_agotadas", "1");
  if (filtros.pagina && filtros.pagina > 1) p.set("pagina", String(filtros.pagina));
  return p.toString();
}

const nombre = (nombres, id) => nombres[id] || `Tienda ${id}`;

/**
 * Nota del detalle cuando alguna clave se reconstruyó con el rescate: es un cálculo con las ventas de SICAR desde el inicio
 * del sistema, no una foto tomada ese día. Sin rescate en ningún renglón, null.
 */
export function notaRescate(renglones, nombres) {
  const conRescate = (renglones || []).filter((r) => r?.rescate && Array.isArray(r.rescate.tiendas));
  // Solo las tiendas rescatadas donde este renglón tiene piezas (queda o vendido); sin desglose, todas las del rescate.
  const conPiezas = (r, id) => {
    if (!r.por_sucursal) return true;
    const s = r.por_sucursal[id];
    return !!s && (BigInt(s.queda ?? "0") > 0n || BigInt(s.vendido ?? "0") > 0n);
  };
  const ids = conRescate.flatMap((r) => r.rescate.tiendas.map(Number).filter((id) => conPiezas(r, id)));
  const tiendas = [...new Set(ids)].sort((a, b) => a - b);
  if (!tiendas.length) return null;
  const desde = String(conRescate[0].rescate.desde || "").slice(0, 10);
  return `Reconstruido desde el ${desde} con las ventas de SICAR en: ${tiendas.map((id) => nombre(nombres, id)).join(", ")}`;
}

export function textoTraslado(s, nombres, clave, descripcion) {
  if (s.razon === "informacion_insuficiente") {
    return `${TEXTOS.insuficiente} para sugerir cantidad desde ${nombre(nombres, s.de)}: revisar.`;
  }
  const n = piezasTexto(s.piezas);
  const articulo = [clave, descripcion].filter(Boolean).join(" ");
  return `Revisar traslado de ${n} ${n === "1" ? "pieza" : "piezas"} de ${articulo}: ${nombre(nombres, s.de)} → `
    + `${nombre(nombres, s.a)}. Confirmar antes de mover en SICAR.`;
}

export function validarMotivo(motivo) {
  const limpio = (motivo || "").trim();
  return limpio.length < 3 || limpio.length > 200 ? "El motivo debe tener de 3 a 200 caracteres." : null;
}

export function limitePosponer(hoy, dias) {
  return new Date(Date.parse(`${hoy}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

export function validarPosponer({ motivo, fecha }, hoy, dias = 30) {
  const malMotivo = validarMotivo(motivo);
  if (malMotivo) return malMotivo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "") || fecha <= hoy) return "Elige una fecha futura para posponer.";
  if (fecha > limitePosponer(hoy, dias)) return `No se puede posponer más de ${dias} días.`;
  return null;
}

export function botonIncorporar(tienda, permisos) {
  if (!puedeGestionar(permisos)) return { visible: false, deshabilitado: true, razon: "" };
  if (tienda.vieja) {
    return { visible: true, deshabilitado: true, razon: "La foto de existencias es vieja: espera a que el agente mande datos nuevos." };
  }
  return { visible: true, deshabilitado: false, razon: "" };
}

const MOTIVOS = {
  sin_movimiento_desde_revision: "Volvió solo: sin movimiento desde la revisión",
  recepcion_menor: "Llegaron menos piezas de las enviadas",
  recepcion_mayor: "Llegaron más piezas de las enviadas",
  venta_sin_existencia: "Venta sin existencia registrada",
  salida_sin_existencia: "Salida sin existencia registrada",
  recepcion_sin_salida: "Recepción sin salida registrada",
  clave_con_problema: "Clave con problema en la foto de existencias",
  cantidad_fraccionaria: "Cantidad de compra fraccionaria",
  dia_del_corte: "Traspaso del mismo día de la foto",
  sin_mapa: "Sucursal SICAR sin asignar en el mapa",
  mapa_contradictorio: "Mapa de sucursales contradictorio",
  folio_ambiguo: "Folio de traspaso con varias coincidencias",
  origen_cancelado_destino_recibido: "Origen cancelado pero destino recibido",
  estados_contradictorios: "Estados del traspaso contradictorios",
  sin_fecha_aplicado: "Recepción sin fecha",
  recepcion_anterior_salida: "Recepción anterior a la salida",
  catalogo_incompleto: "Catálogo incompleto en una tienda",
  fuente_sin_fecha: "Datos sin fecha de actualización",
  cuenta_interna: "Salida a cuenta interna (no cuenta como venta)",
  origen_no_incorporado: "Devolución desde una tienda sin agente (entra sin factura)",
  sin_punta_origen: "Recepción sin registro de salida en el origen",
};
export const textoMotivo = (motivo) => MOTIVOS[motivo] || motivo;

export const textoPorArticulo = (n) => (n > 1
  ? `Sugerencia por artículo: cuenta las ${n} facturas en aviso de esta clave. Es la misma en cada una; no la sumes.` : null);

const SIN_SICAR = {
  clave_repetida: "clave repetida en SICAR", existencia_atrasada: "existencia de SICAR atrasada",
  sin_existencia: "SICAR no reporta existencia", catalogo_incompleto: "catálogo de SICAR incompleto en esa tienda",
};

/** Saldo calculado contra existencia SICAR de una tienda. Una diferencia nunca se presenta como faltante. */
export function textoComparacion(c, nombres) {
  const tienda = nombres[c.sucursal_id] || `Tienda ${c.sucursal_id}`;
  const calculado = c.calculado === null ? "calculado pendiente de recálculo" : `calculado ${piezasTexto(c.calculado)}`;
  if (c.sicar === null) return `${tienda}: ${SIN_SICAR[c.motivo_sicar] || "existencia SICAR desconocida"}, no se puede comparar · ${calculado}`;
  const base = `${tienda}: SICAR ${piezasTexto(c.sicar)} · ${calculado}`;
  if (c.diferencia === null) return base;
  return c.diferencia === "0" ? `${base} · cuadra` : `${base} · diferencia ${piezasTexto(c.diferencia)} (movimientos por aclarar)`;
}
