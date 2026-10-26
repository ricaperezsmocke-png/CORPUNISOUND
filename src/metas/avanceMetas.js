// Funciones puras del avance de las metas de Objetivos: "sin dato" y las metas de los cinco caminos.
// La escala es la MISMA que usa el servidor (backend/cincoCaminos/metaNumero.js): la cifra meta y el resultado son
// enteros (452 = 45.2 %, 85000 = $850.00, 185 = 1.85) y aquí se muestran y se capturan en su unidad legible.
const PREFIJO = "cinco_caminos:";
const MAX_ENTERO = 1000000;
const SIN_DATO = "Sin dato";

const ESCALAS = {
  pct_con_cliente: { tipo: "pct", decimales: 1, maximo: 1000 },
  recompra_90: { tipo: "pct", decimales: 1, maximo: 1000 },
  pct_instrumento_con_accesorio: { tipo: "pct", decimales: 1, maximo: 1000 },
  conversion: { tipo: "pct", decimales: 1, maximo: 1000 },
  ticket_promedio_centavos: { tipo: "pesos", decimales: 2, maximo: MAX_ENTERO },
  clientes_nuevos: { tipo: "clientes", decimales: 0, maximo: MAX_ENTERO },
  articulos_por_ticket: { tipo: "articulos", decimales: 2, maximo: MAX_ENTERO },
};

const escalaDe = (fuente) => (typeof fuente === "string" && fuente.startsWith(PREFIJO) ? ESCALAS[fuente.slice(PREFIJO.length)] : undefined);
const esDato = (n) => typeof n === "number" && Number.isFinite(n);

export const esMetaNumero = (fuente) => Boolean(escalaDe(fuente));

/** De lo que se escribe (45.2, "$850.5") al entero que guarda el servidor. Rechaza lo que no cabe exacto en la escala. */
export function legibleAEntero(fuente, texto, { minimo = 1 } = {}) {
  const escala = escalaDe(fuente);
  if (!escala) return { ok: false, error: "Esta meta no es de los cinco caminos." };
  const sinSimbolos = String(texto ?? "").trim().replace(/^\$/, "").replace(/%$/, "").trim();
  // Una sola coma y ningún punto: coma decimal (45,2).
  const limpio = /^\d+,\d+$/.test(sinSimbolos) ? sinSimbolos.replace(",", ".") : sinSimbolos;
  if (!/^\d{1,9}(\.\d+)?$/.test(limpio)) return { ok: false, error: "Escribe un número, por ejemplo 45.2." };
  const [entera, cruda = ""] = limpio.split(".");
  // Ceros de sobra no cambian la cifra (45.20 = 45.2); un dígito distinto de cero fuera de la escala sí se rechaza.
  const fraccion = cruda.length > escala.decimales && /^0*$/.test(cruda.slice(escala.decimales)) ? cruda.slice(0, escala.decimales) : cruda;
  if (fraccion.length > escala.decimales) {
    const dec = escala.decimales === 1 ? "1 decimal" : `${escala.decimales} decimales`;
    return { ok: false, error: escala.decimales ? `Usa máximo ${dec}.` : "Usa un número entero." };
  }
  const valor = Number(entera + fraccion.padEnd(escala.decimales, "0"));
  if (valor < minimo || valor > escala.maximo) return { ok: false, error: "La cifra está fuera del rango permitido." };
  return { ok: true, valor };
}

/** Del entero guardado a su texto legible, sin unidad: 452 -> "45.2". */
export function enteroALegible(fuente, entero) {
  const escala = escalaDe(fuente);
  if (!escala || !esDato(entero)) return esDato(entero) ? String(entero) : SIN_DATO;
  if (!escala.decimales) return String(entero);
  const factor = 10 ** escala.decimales;
  const signo = entero < 0 ? "-" : "";
  const abs = Math.abs(Math.round(entero));
  return `${signo}${Math.floor(abs / factor)}.${String(abs % factor).padStart(escala.decimales, "0")}`;
}

const conComas = (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Sin el sufijo largo de clientes y artículos: "12 de 15 clientes por semana".
function textoCorto(fuente, entero) {
  const escala = escalaDe(fuente);
  if (!esDato(entero)) return SIN_DATO;
  if (!escala) return String(entero);
  const legible = enteroALegible(fuente, entero);
  if (escala.tipo === "pct") return `${legible} %`;
  if (escala.tipo === "pesos") {
    const [enteros, centavos] = legible.split(".");
    return `$${conComas(enteros)}.${centavos}`;
  }
  return legible;
}

const SUFIJO = { clientes: " clientes por semana", articulos: " artículos por ticket" };

/** Una cifra de meta en su unidad: "45.2 %", "$850.00", "12 clientes por semana", "1.85 artículos por ticket". */
export function textoCifra(fuente, entero) {
  if (!esDato(entero)) return SIN_DATO;
  return `${textoCorto(fuente, entero)}${SUFIJO[escalaDe(fuente)?.tipo] || ""}`;
}

/** Etiqueta del campo donde se escribe la cifra de una meta de los cinco caminos. */
export function etiquetaCapturaCifra(fuente) {
  const tipo = escalaDe(fuente)?.tipo;
  if (tipo === "pct") return "Cifra meta (%, ej. 45.2)";
  if (tipo === "pesos") return "Cifra meta ($, ej. 850.00)";
  if (tipo === "clientes") return "Cifra meta (clientes por semana)";
  if (tipo === "articulos") return "Cifra meta (artículos por ticket, ej. 1.85)";
  return "Cifra meta";
}

const conUnidad = (meta, n) => (meta.unidad ? `${n} ${meta.unidad}` : String(n));

/** Lo que falta para la meta, en su unidad: "5.2 %" o "4 videos". */
export function textoFaltante(meta, faltan) {
  return esMetaNumero(meta.fuente) ? textoCifra(meta.fuente, faltan) : conUnidad(meta, faltan);
}

/** "3 de 10 videos", "45.2 % de 45.0 %" o, sin semanas con dato, "Sin dato (meta 45.0 %)": nunca un 0 inventado. */
export function textoResultadoMeta(meta) {
  const numero = esMetaNumero(meta.fuente);
  const sinDato = meta.sin_dato === true || !esDato(meta.resultado);
  if (sinDato) return `${SIN_DATO} (meta ${numero ? textoCifra(meta.fuente, meta.valor_meta) : conUnidad(meta, meta.valor_meta)})`;
  if (numero) return `${textoCorto(meta.fuente, meta.resultado)} de ${textoCifra(meta.fuente, meta.valor_meta)}`;
  return `${meta.resultado} de ${conUnidad(meta, meta.valor_meta)}`;
}

/** Hay avance que pintar: porcentaje numérico y la meta no está marcada sin dato. */
export const hayAvance = (meta) => esDato(meta.porcentaje) && meta.sin_dato !== true;
export const hayBarra = hayAvance;

/** "83.5%" o "Sin dato": la barra roja y el "%" suelto desaparecen. */
export const textoPorcentajeMeta = (meta) => (hayAvance(meta) ? `${meta.porcentaje}%` : SIN_DATO);

// "Tú llevas N" cuenta capturas propias: solo tiene sentido en una meta manual de tienda o empresa.
export const mostrarMias = (meta) => (meta.fuente ?? "manual") === "manual" && !["persona", "corporativo"].includes(meta.alcance);
