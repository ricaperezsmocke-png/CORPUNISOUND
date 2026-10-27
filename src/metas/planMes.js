// Funciones puras de la pantalla "Plan del mes" de los cinco caminos (plan 2026-10-26 P4, Task 3).
// El servidor vuelve a validar todo: aquí solo se arma el cuerpo de "validar" y se escriben los textos de cada decisión.
import { enteroALegible, legibleAEntero, textoCifra } from "./avanceMetas.js";
import { NOMBRES_NUMERO } from "./manualTacticas.js";

export const PERMISO_PLANEADOR = "administrar_metas_personalizadas";
export const AVISO_CAMINO_FORZADO = "Sin dato de clientes o menos del 50 %: el camino es calidad del dato";

const CAMINOS = [
  { clave: "calidad_dato", nombre: "Calidad del dato" },
  { clave: "prospectos", nombre: "Prospectos" },
  { clave: "conversion", nombre: "Conversión" },
  { clave: "compras_por_cliente", nombre: "Compras por cliente" },
  { clave: "venta_promedio", nombre: "Venta promedio" },
];
export const CAMINOS_PLAN = CAMINOS;
export const ROLES = { vendedores: "Vendedores", encargado: "Encargado", compras: "Compras", gerente: "Gerente" };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DECISIONES = { aceptar: "Aceptada", cambiar: "Cambiada", rechazar: "Rechazada" };

const fuenteDe = (numero) => `cinco_caminos:${numero}`;
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export const nombreCamino = (clave) => CAMINOS.find((c) => c.clave === clave)?.nombre || clave;
export const nombreNumero = (numero) => NOMBRES_NUMERO[numero] || numero;
export const puedeProponer = (permisos) => Array.isArray(permisos) && permisos.includes(PERMISO_PLANEADOR);
export const resumenDecision = (punto) => DECISIONES[punto?.decision] || "";

// Una cifra legible (45.2) como texto con su unidad ("45.2 %"). Si no cabe en la escala se muestra tal cual.
function textoLegible(numero, valor) {
  const r = legibleAEntero(fuenteDe(numero), String(valor), { minimo: 0 });
  return r.ok ? textoCifra(fuenteDe(numero), r.valor) : String(valor);
}

export const cifraDeMeta = (meta) => textoLegible(meta.numero, meta.valor);
export const baseDeMeta = (meta) => textoLegible(meta.numero, meta.base);

export const textoRango = (meta) => `${textoLegible(meta.numero, meta.rango.minimo)} a ${textoLegible(meta.numero, meta.rango.maximo)}`;

export function textoAjuste(meta) {
  if (!meta.ajustada) return "";
  return `Ajustada por el servidor: la IA propuso ${textoLegible(meta.numero, meta.propuesta_ia)} y quedó en ${cifraDeMeta(meta)}`;
}

export const textoRechazoTactica = (t) => (t.rechazada ? `Rechazada por el servidor: ${t.motivo_rechazo}` : "");
export const textoDescartada = (d) => `${nombreNumero(d.numero)}: ${d.motivo}`;

// Cuando el servidor forzó el camino se dice; y si el gerente elige otro distinto del que quedó en la propuesta, también.
export function avisosDelCamino(propuesta, decision) {
  const avisos = [];
  if (propuesta.camino_forzado) avisos.push(AVISO_CAMINO_FORZADO);
  if (decision?.decision === "cambiar" && decision.camino && decision.camino !== propuesta.camino) {
    avisos.push(`Te apartaste del camino del sistema: ${nombreCamino(propuesta.camino)}. Elegiste: ${nombreCamino(decision.camino)}`);
  }
  return avisos;
}

export function estadoInicialPlan(propuesta) {
  return {
    camino: { decision: "aceptar", camino: propuesta.camino },
    // Una táctica con descuento en conversión ya viene rechazada por el servidor: arranca rechazada.
    tacticas: Object.fromEntries(propuesta.tacticas.map((t) => [t.id, { decision: t.rechazada ? "rechazar" : "aceptar", nuevo_id: "" }])),
    metas: Object.fromEntries(propuesta.metas.map((m) => [m.numero, { decision: "aceptar", valor: "" }])),
  };
}

function cuerpoCamino(estado) {
  const d = estado.camino;
  if (d.decision === "aceptar") return { ok: true, valor: { decision: "aceptar" } };
  if (!CAMINOS.some((c) => c.clave === d.camino)) return { ok: false, error: "Elige uno de los cinco caminos." };
  return { ok: true, valor: { decision: "cambiar", camino: d.camino } };
}

function cuerpoTacticas(propuesta, estado) {
  const usadas = new Set();
  const lista = [];
  for (const t of propuesta.tacticas) {
    const d = estado.tacticas[t.id] || { decision: "aceptar" };
    if (d.decision === "rechazar") { lista.push({ id: t.id, decision: "rechazar" }); continue; }
    const id = d.decision === "cambiar" ? Number(d.nuevo_id) : t.id;
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "Elige la táctica por la que vas a cambiar." };
    if (usadas.has(id)) return { ok: false, error: "No se puede repetir una táctica." };
    usadas.add(id);
    lista.push(d.decision === "cambiar" ? { id: t.id, decision: "cambiar", nuevo_id: id } : { id: t.id, decision: "aceptar" });
  }
  if (!usadas.size) return { ok: false, error: "Acepta al menos una táctica." };
  return { ok: true, valor: lista };
}

function cuerpoMetas(propuesta, estado) {
  let aceptadas = 0;
  const lista = [];
  for (const m of propuesta.metas) {
    const d = estado.metas[m.numero] || { decision: "aceptar" };
    if (d.decision === "rechazar") { lista.push({ numero: m.numero, decision: "rechazar" }); continue; }
    aceptadas += 1;
    if (d.decision === "aceptar") { lista.push({ numero: m.numero, decision: "aceptar" }); continue; }
    const fuente = fuenteDe(m.numero);
    const r = legibleAEntero(fuente, d.valor);
    if (!r.ok) return { ok: false, error: `${nombreNumero(m.numero)}: ${r.error}` };
    const minimo = legibleAEntero(fuente, String(m.rango.minimo), { minimo: 0 });
    const maximo = legibleAEntero(fuente, String(m.rango.maximo), { minimo: 0 });
    if (r.valor < minimo.valor || r.valor > maximo.valor) {
      const [desde, hasta] = [textoCifra(fuente, minimo.valor), textoCifra(fuente, maximo.valor)];
      return { ok: false, error: `${nombreNumero(m.numero)}: la cifra debe quedar entre ${desde} y ${hasta}.` };
    }
    lista.push({ numero: m.numero, decision: "cambiar", valor: Number(enteroALegible(fuente, r.valor)) });
  }
  if (!aceptadas) return { ok: false, error: "Acepta al menos una meta." };
  return { ok: true, valor: lista };
}

/** Del estado de la pantalla al cuerpo de POST .../validar. Devuelve { ok, cuerpo } o { ok: false, error }. */
export function cuerpoValidar(propuesta, estado) {
  const camino = cuerpoCamino(estado);
  if (!camino.ok) return camino;
  const tacticas = cuerpoTacticas(propuesta, estado);
  if (!tacticas.ok) return tacticas;
  const metas = cuerpoMetas(propuesta, estado);
  if (!metas.ok) return metas;
  return { ok: true, cuerpo: { camino: camino.valor, tacticas: tacticas.valor, metas: metas.valor } };
}

export const cuerpoProponer = (sucursal, mes) => ({ sucursal_id: Number(sucursal), mes });
export const cuerpoDescartar = (motivo) => ({ motivo: motivo.trim() });
export const motivoValido = (motivo) => typeof motivo === "string" && motivo.trim().length >= 3 && motivo.trim().length <= 300;

// El servidor solo planea el mes actual y el siguiente.
export function mesesPlanificables(hoy) {
  const [anio, mes] = hoy.split("-").map(Number);
  const siguiente = mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
  return [[anio, mes], siguiente].map(([a, m]) => ({ mes: `${a}-${String(m).padStart(2, "0")}`, etiqueta: `${MESES[m - 1]} ${a}` }));
}

// Solo las tácticas que el servidor deja elegir: activas y no de fase 2 o 3.
export function opcionesTacticas(manual) {
  return (Array.isArray(manual) ? manual : []).filter((t) => t.activa === true && t.como_se_mide !== "fase_2" && t.como_se_mide !== "fase_3");
}

export function textoAprobado(plan) {
  const quien = plan.aprobado_por_nombre ? ` por ${plan.aprobado_por_nombre}` : plan.aprobado_por_id ? ` por el usuario n.º ${plan.aprobado_por_id}` : "";
  const fecha = dia(plan.aprobado_en);
  return `Aprobado${quien}${fecha ? ` el ${fecha}` : ""}`;
}

// Las tácticas que se pueden elegir son las del manual de quien mira, filtradas como lo hace el servidor.
export function opcionesParaPlan(_propuesta, manual) {
  return opcionesTacticas(manual);
}

// El servidor rechaza (400) un descuento aceptado con camino final conversión: se avisa antes de enviar.
export function avisoDescuento(propuesta, estado) {
  const camino = estado.camino.decision === "cambiar" ? estado.camino.camino : propuesta.camino;
  if (camino !== "conversion") return "";
  const hay = propuesta.tacticas.some((t) => t.habla_de_descuento === true && estado.tacticas[t.id]?.decision === "aceptar");
  return hay ? "Con el camino de conversión no se acepta una táctica de descuento: recházala o cambia el camino. El servidor no la dejará pasar." : "";
}
