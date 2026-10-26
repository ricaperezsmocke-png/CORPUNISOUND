// Lógica pura de la pantalla "Manual de tácticas": agrupar, rotular y armar cuerpos de petición.
// La etiqueta de prueba NO se arma aquí ni en ningún cuerpo: solo la escribe el servidor (cierre del mes).
import { NUMEROS } from "./tableroCincoCaminos.js";

export const CAMINOS = [
  { clave: "calidad_dato", nombre: "Calidad del dato" },
  { clave: "prospectos", nombre: "Prospectos" },
  { clave: "conversion", nombre: "Conversión" },
  { clave: "compras_por_cliente", nombre: "Compras por cliente" },
  { clave: "venta_promedio", nombre: "Venta promedio" },
  { clave: "margen", nombre: "Margen" },
];

// Mismos nombres legibles que el tablero; margen y descuento son de la fase 3 y aún no tienen cálculo.
export const NOMBRES_NUMERO = {
  ...Object.fromEntries(NUMEROS.map((n) => [n.clave, n.etiqueta])),
  registros_por_10_tickets: "Registros al Radar por cada 10 tickets",
  margen: "Margen (fase 3)",
  descuento_promedio: "Descuento promedio (fase 3)",
};

export const QUIEN = [
  { clave: "cajera", nombre: "Cajera" },
  { clave: "vendedor", nombre: "Vendedor" },
  { clave: "encargado", nombre: "Encargado" },
  { clave: "gerente", nombre: "Gerente" },
  { clave: "compras", nombre: "Compras" },
];

export const MEDICIONES = [
  { clave: "sistema", nombre: "Lo mide el sistema" },
  { clave: "evidencia", nombre: "Con evidencia" },
  { clave: "sistema_y_evidencia", nombre: "Sistema y evidencia" },
  { clave: "fase_2", nombre: "Fase 2 (aún no)" },
  { clave: "fase_3", nombre: "Fase 3 (aún no)" },
];

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CAMPOS = ["nombre", "descripcion", "camino", "numero_que_mueve", "candado", "quien", "como_se_mide", "referencia_pdf"];
const NOMBRES_CAMPO = {
  numero_v1: "Número en el manual v1", nombre: "Nombre", descripcion: "Descripción", camino: "Camino", numero_que_mueve: "Número que mueve", candado: "Candado",
  quien: "Quién", como_se_mide: "Cómo se mide", referencia_pdf: "Referencia PDF", activa: "Activa", motivo_retiro: "Motivo del retiro",
};
const ACCIONES = { alta: "Alta", cambio: "Cambio", retiro: "Retiro", reactivacion: "Reactivación", etiqueta: "Etiqueta de prueba" };

const nombreDe = (lista, clave) => lista.find((x) => x.clave === clave)?.nombre || String(clave);
export const nombreCamino = (clave) => nombreDe(CAMINOS, clave);
export const nombreNumero = (clave) => NOMBRES_NUMERO[clave] || String(clave);
export const nombreMedicion = (clave) => nombreDe(MEDICIONES, clave);
export const nombreQuien = (lista) => (Array.isArray(lista) ? lista.map((q) => nombreDe(QUIEN, q)).join(", ") : "");

/** Mes "AAAA-MM" a "septiembre 2026"; si no tiene esa forma, tal cual. */
export function textoMes(mes) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes || "");
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : mes || "";
}

/** Etiqueta de la tienda: "Por probar", "Probada (mes, resultado)", "No funcionó (mes)" o "Sin dato". */
export function textoEtiqueta(etiqueta) {
  const e = etiqueta || {};
  if (e.estado === "probada") {
    const d = [textoMes(e.mes), e.resultado].filter(Boolean).join(", ");
    return d ? `Probada (${d})` : "Probada";
  }
  if (e.estado === "no_funciono") return e.mes ? `No funcionó (${textoMes(e.mes)})` : "No funcionó";
  if (e.estado === "sin_dato") return "Sin dato";
  return "Por probar";
}

export function textoProbadaEn(n) {
  const k = Number.isInteger(n) && n > 0 ? n : 0;
  return `Probada en ${k} ${k === 1 ? "tienda" : "tiendas"}`;
}

/** Tácticas agrupadas por camino en el orden fijo; los caminos sin tácticas visibles no salen. Retiradas ocultas por defecto. */
export function agruparPorCamino(tacticas, { camino = "", retiradas = false } = {}) {
  const visibles = (Array.isArray(tacticas) ? tacticas : []).filter((t) => (retiradas || t.activa) && (!camino || t.camino === camino));
  return CAMINOS.map((c) => ({ camino: c.clave, nombre: c.nombre, tacticas: visibles.filter((t) => t.camino === c.clave) }))
    .filter((g) => g.tacticas.length > 0);
}

export function formularioVacio() {
  // Nada viene escogido: lo que se elige lo decide la persona, no el sistema.
  return { nombre: "", descripcion: "", camino: "", numero_que_mueve: "", candado: "", quien: [], como_se_mide: "", referencia_pdf: "" };
}

export function formularioDeTactica(t) {
  return { nombre: t.nombre, descripcion: t.descripcion || "", camino: t.camino, numero_que_mueve: t.numero_que_mueve, candado: t.candado || "",
    quien: [...(t.quien || [])], como_se_mide: t.como_se_mide, referencia_pdf: t.referencia_pdf || "" };
}

function datosDelFormulario(f) {
  return { nombre: f.nombre.trim(), descripcion: f.descripcion.trim(), camino: f.camino, numero_que_mueve: f.numero_que_mueve,
    candado: f.candado || null, quien: QUIEN.map((q) => q.clave).filter((q) => f.quien.includes(q)), como_se_mide: f.como_se_mide,
    referencia_pdf: f.referencia_pdf.trim() };
}

/** Cuerpo del alta: solo los campos permitidos. Nunca lleva `etiquetas`. */
export function cuerpoAlta(f) {
  return datosDelFormulario(f);
}

/** Cuerpo del PUT: solo lo que cambió contra la táctica original. Nunca lleva `etiquetas`. */
export function cuerpoCambio(original, f) {
  const nuevo = datosDelFormulario(f);
  const cuerpo = {};
  for (const campo of CAMPOS) {
    const antes = campo === "quien" ? [...(original.quien || [])].sort() : (original[campo] ?? (campo === "candado" ? null : ""));
    const ahora = campo === "quien" ? [...nuevo.quien].sort() : nuevo[campo];
    if (JSON.stringify(antes) !== JSON.stringify(ahora)) cuerpo[campo] = nuevo[campo];
  }
  return cuerpo;
}

/** Validación de pantalla (la de verdad es la del servidor): devuelve el mensaje o "". */
export function errorDelFormulario(f) {
  const n = f.nombre.trim().length;
  if (n < 3 || n > 120) return "El nombre debe tener de 3 a 120 caracteres.";
  if (f.descripcion.trim().length > 600) return "La descripción puede tener hasta 600 caracteres.";
  if (f.referencia_pdf.trim().length > 60) return "La referencia al PDF puede tener hasta 60 caracteres.";
  if (!f.camino) return "Elige el camino.";
  if (!f.numero_que_mueve) return "Elige el número que mueve.";
  if (f.quien.length === 0) return "Elige al menos un responsable.";
  if (!f.como_se_mide) return "Elige cómo se mide.";
  if (f.candado && f.candado === f.numero_que_mueve) return "El candado debe ser un número distinto al que mueve.";
  return "";
}

function textoValor(campo, valor) {
  if (valor === null || valor === undefined || valor === "") return "(vacío)";
  if (campo === "camino") return nombreCamino(valor);
  if (campo === "numero_que_mueve" || campo === "candado") return nombreNumero(valor);
  if (campo === "quien") return nombreQuien(valor);
  if (campo === "como_se_mide") return nombreMedicion(valor);
  if (campo === "activa") return valor ? "sí" : "no";
  return String(valor);
}

function cambioDeCampo(h, antes, despues, campo) {
  const nuevo = textoValor(campo, despues[campo]);
  const previo = h.accion === "alta" ? "" : `${textoValor(campo, antes[campo])} → `;
  return `${NOMBRES_CAMPO[campo] || "Otro dato"}: ${previo}${nuevo}`;
}

/** Entrada del historial lista para mostrar: quién (nombre que manda el servidor), cuándo, qué acción y qué cambió. */
export function entradaHistorial(h) {
  const id = h.usuario_id;
  const quien = id === null || id === undefined ? "El sistema" : h.usuario_nombre || `Usuario #${id}`;
  const despues = h.despues && typeof h.despues === "object" ? h.despues : {};
  const antes = h.antes && typeof h.antes === "object" ? h.antes : {};
  const cambios = h.accion === "etiqueta"
    ? [`Tienda ${despues.sucursal_id}: ${textoEtiqueta(despues.etiqueta)}`]
    : Object.keys(despues).map((c) => cambioDeCampo(h, antes, despues, c));
  return { fecha_hora: h.fecha_hora, accion: ACCIONES[h.accion] || String(h.accion), quien, cambios };
}
