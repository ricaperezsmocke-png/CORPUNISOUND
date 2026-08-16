/**
 * gerenteVentasIA.js — La capa de redacción de las sugerencias de meta.
 *
 * REPARTO DE RESPONSABILIDADES, y no es negociable: la CIFRA la calcula
 * `gerenteVentas.sugerirMeta` a partir de las ventas reales del vendedor. Este
 * archivo solo le pide a Claude que la EXPLIQUE en lenguaje llano y le dé un
 * consejo corto a quien va a fijar la meta.
 *
 * El motivo es concreto: una meta se usa para evaluar a una persona. Un número
 * inventado por una IA —aunque suene razonable— puede costarle su comisión a
 * una cajera. Por eso el prompt lleva el JSON ya calculado como única fuente de
 * verdad, con instrucción explícita de no inventar cifras, y la respuesta se
 * valida contra ese JSON antes de mostrarse.
 *
 * CAÍDA ELEGANTE: si Claude falla, tarda, se niega, o devuelve algo que no
 * cuadra, la sugerencia se muestra igual con el texto determinista que ya trae
 * `sugerirMeta`. La pantalla nunca se queda sin sugerencia por culpa de la IA.
 */

const { sugerirMeta } = require("./gerenteVentas");

/**
 * Modelo y parámetros de una llamada corta.
 *
 * - `claude-opus-5` es el modelo actual recomendado. El resto del sistema (el
 *   Asistente de IA) todavía usa `claude-sonnet-4-6`; se dejó así a propósito
 *   para no cambiar el comportamiento de un módulo que ya funciona en
 *   producción. Si Victor prefiere un solo modelo para todo, es una línea.
 * - NADA de `temperature`/`top_p`: en este modelo esos parámetros ya no existen
 *   y devuelven error 400.
 * - `effort: "low"` porque esto es redacción de dos frases sobre datos ya
 *   masticados, no un problema que requiera razonar.
 * - `max_tokens` cubre el pensamiento MÁS el texto, así que se deja holgado
 *   aunque la respuesta esperada sea corta: quedarse corto trunca la frase a
 *   media palabra.
 */
const MODELO = "claude-opus-5";
const MAX_TOKENS = 1024;
/** Si Claude tarda más que esto, se usa el texto determinista. Quien está
 *  fijando metas no debe esperar a una pantalla colgada. */
const TIMEOUT_MS = 12_000;

const INSTRUCCIONES = `Eres el asistente de un dueño de una cadena de tiendas de instrumentos musicales en Chiapas, México, que está por fijarle la meta mensual de ventas a una persona de su equipo.

Te paso un JSON con el cálculo YA HECHO a partir de las ventas reales de esa persona.

Reglas que no puedes romper:
- La cifra sugerida es la del JSON. NO propongas otra, no la redondees distinto, no la "ajustes".
- No menciones ninguna cantidad, porcentaje ni mes que no esté en el JSON.
- Si la confianza es "baja", dilo claramente: es poco historial.

No conoces el nombre de la persona y no debes inventarlo: refiérete a ella como "esta vendedora".

Escribe en español de México, hablándole de tú al dueño, en máximo 3 frases cortas:
1. Qué meta sugieres y de dónde sale.
2. Si la venta viene subiendo, bajando o pareja.
3. Un consejo práctico de una línea (por ejemplo, si conviene subirla poco a poco, o esperar más historial).

Sin saludos, sin despedidas, sin viñetas. Solo el texto.`;

/** Debajo de esto, un número del texto no es una cantidad de dinero: es un
 *  conteo de meses, un porcentaje, un día. No tiene caso compararlo con la meta. */
const MINIMO_PARA_SER_DINERO = 1000;

/**
 * Saca del texto los números que podrían leerse como una cantidad de dinero.
 *
 * Normaliza el formato mexicano: "$30,000.50" → 30000.5. Se ignoran los
 * decimales al comparar porque la meta siempre es un entero redondeado a
 * centenas.
 */
function cantidadesEn(texto) {
  const crudos = texto.match(/\d[\d.,\s]*\d|\d/g) || [];
  const numeros = [];
  let hayIlegible = false;
  for (const s of crudos) {
    // Coma y espacio = separadores de miles; punto = decimal (formato de México).
    const n = Number(s.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) numeros.push(Math.round(n));
    // Un token numérico que no parsea ("1.000.000") NO se descarta en silencio:
    // se marca, y el texto entero se rechaza. Tirarlo era el hueco por el que
    // pasaba una cifra inventada escrita con puntos de millar.
    else hayIlegible = true;
  }
  return { numeros, hayIlegible };
}

/** Números escritos con letras. No se pretende cubrir el idioma entero: basta
 *  con que un texto que diga "cuarenta mil" o "treinta mil pesos" se rechace,
 *  porque es la forma más natural de escribir una cantidad en español de
 *  México y era por donde se colaba una cifra que nadie calculó. */
const NUMERO_EN_PALABRAS = /\b(mil|millon|millón|millones)\b/i;

/**
 * ¿La redacción respeta la cifra calculada?
 *
 * LA VERSIÓN ANTERIOR NO SERVÍA, y la revisión independiente lo demostró
 * ejecutándola: comparaba `texto.replace(/[^\d]/g,"")` contra la meta como
 * SUBCADENA, así que dejaba pasar todo esto con una meta real de $30,000:
 *   "Ponle $300,000"                        → los dígitos "30000" están dentro de "300000"
 *   "Ponle $300.00"                          → igual, tras quitar el punto
 *   "En 5 meses vendió 23,000"               → "52300" se forma cruzando dos números
 *   "da $30,000 pero te sugiero $85,000"     → la correcta estaba, la inventada también
 * y, peor, con `if (!sugerencia) return true` la verificación se APAGABA ENTERA
 * justo cuando no hay historial — el único caso donde no existe ninguna cifra
 * legítima y la IA quedaba libre de inventar una que Victor leería como buena.
 *
 * Ahora se comparan NÚMEROS contra una LISTA BLANCA: la meta calculada más las
 * demás cifras que el sistema le pasó a la IA (el promedio y el monto de cada
 * mes). Cualquier número fuera de esa lista invalida el texto.
 *
 * La lista blanca importa tanto como el rechazo: el prompt le pide a la IA que
 * diga "de dónde sale" la meta, y el JSON que recibe incluye el promedio. Una
 * versión que solo aceptara la meta rechazaba "Ponle $30,000; su promedio fue
 * de $28,450" — o sea, casi toda explicación legítima, dejando la llamada a
 * Claude pagada y sin usar.
 *
 * Se rechaza además cuando:
 *  - un token numérico no parsea ("1.000.000"): antes se tiraba en silencio y
 *    por ahí se colaba una cifra inventada con puntos de millar;
 *  - el texto escribe una cantidad con letras ("cuarenta mil"), que es la forma
 *    más natural en español de México y no la ve ningún regex de dígitos.
 *
 * Sin cifra calculada (sin historial), el texto no puede mencionar NINGUNA
 * cantidad de dinero, ni en dígitos ni en palabras.
 */
function laCifraCuadra(texto, sugerencia, cifrasPermitidas = []) {
  if (!texto || typeof texto !== "string") return false;

  // Un año dentro de una fecha AAAA-MM no es una cantidad: "no vende desde
  // 2026-02" es información legítima, no una meta inventada.
  const sinFechas = texto.replace(/\b(19|20)\d\d-\d\d\b/g, " ");
  if (NUMERO_EN_PALABRAS.test(sinFechas)) return false;

  const { numeros, hayIlegible } = cantidadesEn(sinFechas);
  if (hayIlegible) return false;

  const permitidas = new Set(
    [sugerencia, ...cifrasPermitidas]
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0)
  );

  // La meta se busca ANTES del filtro de "esto es dinero": una meta de $800 es
  // legítima (sugerirMeta redondea a centenas) y el filtro la habría escondido,
  // haciendo imposible que ninguna redacción pasara.
  if (sugerencia && sugerencia > 0 && !numeros.includes(Math.round(sugerencia))) return false;

  const montos = numeros.filter((n) => n >= MINIMO_PARA_SER_DINERO);

  // Sin cifra calculada: la IA no puede nombrar ninguna cantidad de dinero.
  if (!sugerencia || sugerencia <= 0) return montos.length === 0;

  return montos.every((n) => permitidas.has(n));
}

/**
 * Sugerencia de meta con explicación redactada.
 *
 * @param anthropic cliente ya inicializado (se inyecta para poder probar sin red)
 * @returns el objeto de `sugerirMeta` más `redaccion` y `redactado_por_ia`
 */
async function sugerirMetaConExplicacion(DB, anthropic, vendedorId, instante) {
  const base = sugerirMeta(DB, vendedorId, instante);

  // Sin cliente de IA configurado (ANTHROPIC_API_KEY ausente en Render, por
  // ejemplo) la pantalla sigue funcionando con el texto calculado.
  if (!anthropic) {
    return { ...base, redaccion: base.motivo, redactado_por_ia: false };
  }

  // El temporizador se guarda para poder apagarlo, y el AbortController corta
  // la petición HTTP del otro lado: sin esto, una respuesta rápida dejaba 12 s
  // de temporizador armado retrasando el apagado, y un timeout dejaba viva la
  // llamada a Claude.
  const corte = new AbortController();
  let temporizador;
  try {
    const respuesta = await Promise.race([
      anthropic.messages.create({
        model: MODELO,
        max_tokens: MAX_TOKENS,
        output_config: { effort: "low" },
        system: INSTRUCCIONES,
        messages: [{
          role: "user",
          content: JSON.stringify({
            // El NOMBRE no se manda: la explicacion no mejora por saberlo, y el
            // nombre del personal de Victor no tiene por que salir del sistema.
            // La pantalla sigue mostrando el nombre real -- lo pone el codigo,
            // no la IA. Decision de Victor (2026-08-16).
            vendedor: "la vendedora",
            meta_sugerida: base.sugerencia,
            promedio_mensual: base.detalle.promedio,
            tendencia_pct: base.detalle.tendencia_pct,
            meses_de_historial: base.meses_de_historial,
            confianza: base.confianza,
            meses: base.detalle.meses,
          }),
        }],
      }, { signal: corte.signal }),
      new Promise((_, rechazar) => {
        temporizador = setTimeout(() => {
          corte.abort();
          rechazar(new Error("La IA tardó demasiado"));
        }, TIMEOUT_MS);
      }),
    ]);

    // Una negativa del clasificador llega como respuesta exitosa con
    // stop_reason "refusal" y contenido vacío: hay que mirarlo ANTES de leer
    // el texto, o esto revienta con un error confuso.
    if (respuesta?.stop_reason === "refusal") {
      return { ...base, redaccion: base.motivo, redactado_por_ia: false };
    }

    const texto = (respuesta?.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Las cifras permitidas son las que el sistema le PASÓ a la IA: la meta, el
    // promedio y el monto de cada mes. Mencionar cualquier otra invalida el texto.
    const cifrasPermitidas = [
      base.detalle.promedio,
      ...base.detalle.meses.map((m) => m.monto),
    ];
    if (!texto || !laCifraCuadra(texto, base.sugerencia, cifrasPermitidas)) {
      // La IA escribió una cifra distinta de la calculada: se descarta entera.
      return { ...base, redaccion: base.motivo, redactado_por_ia: false };
    }

    return { ...base, redaccion: texto, redactado_por_ia: true };
  } catch (e) {
    // Red caída, cuota agotada, timeout, respuesta rara: la sugerencia sale
    // igual. Se registra para poder diagnosticarlo, sin datos del negocio.
    console.warn("Sugerencia de meta sin redacción de IA:", e.message);
    return { ...base, redaccion: base.motivo, redactado_por_ia: false };
  } finally {
    clearTimeout(temporizador);
  }
}

module.exports = {
  sugerirMetaConExplicacion, laCifraCuadra,
  MODELO, MAX_TOKENS, TIMEOUT_MS,
};
