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

/** Los cinco tramos de la barra. El ancho sale del dinero; si no es calculable, de las piezas. */
export function tramosDeFactura(f) {
  const totalDinero = f.dinero ? TRAMOS.reduce((a, t) => a + BigInt(f.dinero[t.id]), 0n) : 0n;
  return TRAMOS.map((t) => ({
    id: t.id, etiqueta: t.etiqueta, color: t.color,
    piezas: piezasTexto(f.piezas[t.pieza]),
    dinero: f.dinero ? pesosTexto(f.dinero[t.id]) : "No calculable",
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
  const gris = BigInt(f.piezas?.sin_agente ?? "0");
  if (f.agotada && !f.aviso) return gris > 0n ? "Pendiente de comprobación" : "Agotada";
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

export function validarPosponer({ motivo, fecha }, hoy) {
  const malMotivo = validarMotivo(motivo);
  if (malMotivo) return malMotivo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "") || fecha <= hoy) return "Elige una fecha futura para posponer.";
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
};
export const textoMotivo = (motivo) => MOTIVOS[motivo] || motivo;
