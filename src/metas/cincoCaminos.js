// Funciones puras de la pantalla "Cinco caminos": semáforo, flechas, formatos y semanas. Sin React ni red.

const AMBAR_HASTA = 0.95;
const esNumero = (v) => typeof v === "number" && Number.isFinite(v);

/** verde si alcanza la base, ámbar hasta 5% por debajo, rojo peor; null si falta el valor o la base. */
export function semaforo(valor, base) {
  if (!esNumero(valor) || !esNumero(base)) return null;
  if (valor >= base) return "verde";
  return valor >= base * AMBAR_HASTA ? "ambar" : "rojo";
}

export function flecha(actual, anterior) {
  if (!esNumero(actual) || !esNumero(anterior)) return null;
  if (actual > anterior) return "sube";
  return actual < anterior ? "baja" : "igual";
}

function pesos(centavos) {
  const total = Math.round(Math.abs(centavos));
  const enteros = String(Math.floor(total / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${centavos < 0 ? "-" : ""}$${enteros}.${String(total % 100).padStart(2, "0")}`;
}

/** Texto de un número del tablero. Lo que falta se dice con palabras, nunca como 0. */
export function formatoNumero(valor, tipo) {
  if (valor === "sin_configurar") return "sin configurar";
  if (!esNumero(valor)) return "sin dato";
  if (tipo === "pct") return `${valor.toFixed(1)}%`;
  if (tipo === "pesos") return pesos(valor);
  if (tipo === "decimal2") return valor.toFixed(2);
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(1);
}

export const NUMEROS = [
  { clave: "pct_con_cliente", etiqueta: "Tickets con cliente", camino: "Calidad del dato", tipo: "pct", leer: (s) => s.pct_con_cliente },
  { clave: "clientes_nuevos", etiqueta: "Clientes nuevos", camino: "Prospectos", tipo: "numero", leer: (s) => s.clientes_nuevos },
  { clave: "conversion", etiqueta: "Conversión del Radar", camino: "Conversión", tipo: "pct", radar: true, solo8: true,
    leer: (s) => s.radar?.conversion },
  { clave: "recompra_90", etiqueta: "Recompra a 90 días", camino: "Compras por cliente", tipo: "pct", leer: (s) => s.recompra_90 },
  { clave: "ticket_promedio_centavos", etiqueta: "Ticket promedio", camino: "Venta promedio", tipo: "pesos",
    leer: (s) => s.ticket_promedio_centavos },
  { clave: "articulos_por_ticket", etiqueta: "Artículos por ticket", camino: "Venta promedio", tipo: "decimal2",
    leer: (s) => s.articulos_por_ticket },
  { clave: "pct_instrumento_con_accesorio", etiqueta: "Instrumento con accesorio", camino: "Venta promedio", tipo: "pct",
    leer: (s) => s.pct_instrumento_con_accesorio },
];

// Lo que se muestra y lo que se puede calificar de un número en un periodo.
function celda(numero, periodo) {
  if (!periodo || periodo.sin_dato) return { texto: "sin dato", valor: null };
  if (numero.radar && periodo.radar?.no_confiable === true) return { texto: "no confiable", valor: null };
  const crudo = numero.leer(periodo);
  return { texto: formatoNumero(crudo, numero.tipo), valor: esNumero(crudo) ? crudo : null };
}

function tarjeta(numero, tablero) {
  const actual = celda(numero, tablero.actual);
  const anterior = celda(numero, tablero.anterior);
  const mismo = celda(numero, tablero.mismo_2025);
  const promedio = celda(numero, tablero.promedio_8);
  // Base: la misma semana de 2025; si no existe (Radar, tiendas nuevas), el promedio de 8 semanas.
  let base = null;
  let valorBase = null;
  if (!numero.solo8 && mismo.valor !== null) [base, valorBase] = ["2025", mismo.valor];
  else if (promedio.valor !== null) [base, valorBase] = ["promedio de 8 semanas", promedio.valor];
  const calificable = actual.valor !== null;
  return {
    clave: numero.clave,
    etiqueta: numero.etiqueta,
    camino: numero.camino,
    actual: actual.texto,
    anterior: anterior.texto,
    mismo_2025: mismo.texto,
    promedio_8: promedio.texto,
    flecha: calificable ? flecha(actual.valor, anterior.valor) : null,
    semaforo: calificable ? semaforo(actual.valor, valorBase) : null,
    base: calificable && valorBase !== null ? base : null,
    nota: numero.radar && calificable && tablero.actual.radar?.no_confiable === null ? "sin base" : null,
    detalle: numero.radar && !tablero.actual?.sin_dato ? tablero.actual?.radar?.conversion_detalle || null : null,
  };
}

export function tarjetasDelTablero(tablero) {
  const dinero = (periodo) => (!periodo || periodo.sin_dato ? "sin dato" : formatoNumero(periodo.venta_centavos, "pesos"));
  return {
    venta: { actual: dinero(tablero.actual), mismo_2025: dinero(tablero.mismo_2025), promedio_8: dinero(tablero.promedio_8) },
    tarjetas: NUMEROS.map((n) => tarjeta(n, tablero)),
  };
}

// --- Semanas (lunes a domingo, en días sueltos de la tienda) ---
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const aFecha = (dia) => { const [a, m, d] = dia.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };

export function sumarDias(dia, dias) {
  const d = aFecha(dia);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function lunesDe(dia) {
  return sumarDias(dia, -((aFecha(dia).getUTCDay() + 6) % 7));
}

/** Lunes de la última semana ya cerrada: la de `hoy` sigue abierta. */
export function ultimaSemanaCompleta(hoy) {
  return sumarDias(lunesDe(hoy), -7);
}

export function etiquetaSemana(lunes) {
  const a = aFecha(lunes);
  const b = aFecha(sumarDias(lunes, 6));
  const fin = `${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} al ${fin}`;
  return `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} al ${fin}`;
}

export function opcionesSemanas(hoy, cantidad = 26) {
  const ultima = ultimaSemanaCompleta(hoy);
  return Array.from({ length: cantidad }, (_, i) => {
    const lunes = sumarDias(ultima, -7 * i);
    return { lunes, etiqueta: etiquetaSemana(lunes) };
  });
}

// --- Categorías: qué es instrumento y qué es accesorio ---
const llaveFila = (departamento, categoria) => JSON.stringify([departamento, categoria ?? null]);

/** Una fila por departamento entero y por cada categoría disponible, más las reglas guardadas que ya no aparecen en SICAR. */
export function filasCategorias(disponibles = [], reglas = []) {
  const tipos = new Map(reglas.map((r) => [llaveFila(r.departamento, r.categoria), r.tipo]));
  const filas = new Map();
  const poner = (departamento, categoria, articulos) => {
    const llave = llaveFila(departamento, categoria);
    if (!filas.has(llave)) filas.set(llave, { departamento, categoria: categoria ?? null, articulos, tipo: tipos.get(llave) || "" });
  };
  for (const d of disponibles) {
    poner(d.departamento, null, null);
    if (d.categoria) poner(d.departamento, d.categoria, d.articulos);
  }
  for (const r of reglas) poner(r.departamento, r.categoria, null);
  const orden = (a, b) => a.departamento.localeCompare(b.departamento, "es")
    || (a.categoria === null ? -1 : b.categoria === null ? 1 : a.categoria.localeCompare(b.categoria, "es"));
  return [...filas.values()].sort(orden);
}

export function reglasDesdeFilas(filas) {
  return filas.filter((f) => f.tipo).map((f) => ({ departamento: f.departamento, categoria: f.categoria, tipo: f.tipo }));
}
