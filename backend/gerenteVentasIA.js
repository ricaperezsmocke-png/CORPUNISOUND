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

Escribe en español de México, hablándole de tú al dueño, en máximo 3 frases cortas:
1. Qué meta sugieres y de dónde sale.
2. Si la venta viene subiendo, bajando o pareja.
3. Un consejo práctico de una línea (por ejemplo, si conviene subirla poco a poco, o esperar más historial).

Sin saludos, sin despedidas, sin viñetas. Solo el texto.`;

/**
 * Comprueba que la redacción no haya inventado la cifra.
 *
 * Es una verificación deliberadamente sencilla: la cantidad sugerida tiene que
 * aparecer en el texto. Si Claude escribió otro número como meta, esto lo
 * atrapa y se cae al texto determinista. No pretende detectar toda invención
 * posible — pretende que la cifra que Victor lee sea la calculada.
 */
function laCifraCuadra(texto, sugerencia) {
  if (!texto || typeof texto !== "string") return false;
  if (!sugerencia) return true; // sin meta que verificar (historial vacío)
  const soloDigitos = texto.replace(/[^\d]/g, "");
  return soloDigitos.includes(String(sugerencia));
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
            vendedor: base.vendedor_nombre,
            meta_sugerida: base.sugerencia,
            promedio_mensual: base.detalle.promedio,
            tendencia_pct: base.detalle.tendencia_pct,
            meses_de_historial: base.meses_de_historial,
            confianza: base.confianza,
            meses: base.detalle.meses,
          }),
        }],
      }),
      new Promise((_, rechazar) =>
        setTimeout(() => rechazar(new Error("La IA tardó demasiado")), TIMEOUT_MS)
      ),
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

    if (!texto || !laCifraCuadra(texto, base.sugerencia)) {
      // La IA escribió una cifra distinta de la calculada: se descarta entera.
      return { ...base, redaccion: base.motivo, redactado_por_ia: false };
    }

    return { ...base, redaccion: texto, redactado_por_ia: true };
  } catch (e) {
    // Red caída, cuota agotada, timeout, respuesta rara: la sugerencia sale
    // igual. Se registra para poder diagnosticarlo, sin datos del negocio.
    console.warn("Sugerencia de meta sin redacción de IA:", e.message);
    return { ...base, redaccion: base.motivo, redactado_por_ia: false };
  }
}

module.exports = {
  sugerirMetaConExplicacion, laCifraCuadra,
  MODELO, MAX_TOKENS, TIMEOUT_MS,
};
