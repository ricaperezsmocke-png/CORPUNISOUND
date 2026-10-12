// Planeador con IA de metas extra. La IA SOLO escribe un borrador: aquí nada crea OKR ni metas.
// Lo que se crea lo decide una persona con permiso en planIACrear.js (regla de Victor 2026-10-12).
const { armarDatosPlan, quitarNombres } = require("./planIADatos");
const { validarPropuesta } = require("./planIAValidar");
const { periodoSellado } = require("./metasPersonalizadas");
const { validarPeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");

const MODELO = "claude-opus-5-5";
// El razonamiento de este modelo siempre está encendido y cuenta dentro de max_tokens: se deja holgado.
const MAX_TOKENS = 16000;
const TIMEOUT_MS = 30_000;
const LIMITE_DIARIO = 20;
const MENSAJE_FALLA = "No se pudo armar el plan; puedes intentarlo otra vez o dar de alta las metas a mano";

// Respuesta con salida estructurada (output_config.format). Este modelo RECHAZA forzar una herramienta
// (tool_choice "tool"/"any" da 400), así que no se usa el patrón de facturaIA.js. Los límites (3 a 6 metas,
// cifra > 0, topes) los revisa planIAValidar.js: el esquema solo asegura la forma.
const META_SCHEMA = { type: "object", additionalProperties: false, required: ["accion", "nombre", "unidad", "prueba", "valor_meta", "por_que"],
  properties: {
    accion: { type: "string", description: "Una 'accion' del catálogo, o 'nueva' si es una idea que no está en el catálogo" },
    nombre: { type: "string" }, unidad: { type: "string" }, prueba: { type: "string", enum: ["ninguna", "liga", "foto"] },
    valor_meta: { type: "integer" }, por_que: { type: "string", description: "Una línea, máximo 200 caracteres" } } };
const ESQUEMA = { type: "object", additionalProperties: false, required: ["okr", "metas"], properties: {
  okr: { type: "object", additionalProperties: false, required: ["titulo", "descripcion"],
    properties: { titulo: { type: "string" }, descripcion: { type: "string" } } },
  metas: { type: "array", items: META_SCHEMA } } };

const INSTRUCCIONES = `Ayudas al dueño de una cadena de tiendas de instrumentos musicales en Chiapas, México, a planear metas del periodo.
Recibes su objetivo en palabras y un JSON con datos reales y agregados de la tienda. Propón un OKR y de 3 a 6 metas medibles.
Reglas que no puedes romper:
- Cada meta usa una "accion" del catálogo. Como máximo 2 metas pueden ser "nueva" (ideas fuera del catálogo).
- Las cifras son enteros alcanzables: no más de 3 veces lo mejor que la tienda ha hecho en esa acción, ajustado al periodo.
- En "por_que" no menciones ningún número que no esté en el JSON.
- No conoces a las personas y no inventes nombres.
Escribe en español de México, breve y concreto. Responde solo con el JSON pedido.`;

function errorCon(status, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function leerEntrada(DB, entrada) {
  const texto = typeof entrada.objetivo_texto === "string" ? entrada.objetivo_texto.trim() : "";
  if (!texto || texto.length > 500) throw errorCon(400, "Escribe el objetivo (hasta 500 caracteres)");
  const sucursal_id = entrada.sucursal_id === null || entrada.sucursal_id === "" || entrada.sucursal_id === undefined
    ? null : Number(entrada.sucursal_id);
  if (sucursal_id !== null && !DB.pos.sucursales.some((s) => s.id === sucursal_id)) throw errorCon(400, "La tienda no existe");
  try { validarPeriodo(entrada.periodo, entrada.inicio); } catch (e) { throw errorCon(400, e.message); }
  if (periodoSellado(DB, entrada.periodo, entrada.inicio)) throw errorCon(400, "El periodo ya está sellado; no se le pueden crear metas");
  return { texto, sucursal_id, periodo: entrada.periodo, inicio: entrada.inicio };
}

const planesDeHoy = (DB, usuarioId, hoy) =>
  DB.pos.planes_ia.filter((p) => p.creado_por_id === usuarioId && fechaLocal(new Date(p.creado_en)) === hoy).length;

async function pedirAlModelo(cliente, contenido, timeoutMs) {
  const corte = new AbortController();
  let temporizador;
  try {
    const respuesta = await Promise.race([
      cliente.messages.create({
        model: MODELO, max_tokens: MAX_TOKENS, system: INSTRUCCIONES,
        output_config: { format: { type: "json_schema", schema: ESQUEMA }, effort: "low" },
        messages: [{ role: "user", content: JSON.stringify(contenido) }],
      }, { signal: corte.signal }),
      new Promise((_, rechazar) => { temporizador = setTimeout(() => { corte.abort(); rechazar(new Error("tiempo agotado")); }, timeoutMs); }),
    ]);
    if (respuesta?.stop_reason === "refusal") throw new Error("la IA se negó a responder");
    if (respuesta?.stop_reason === "max_tokens") throw new Error("la respuesta de la IA quedó cortada");
    const bloque = respuesta?.content?.find((b) => b.type === "text");
    if (!bloque) throw new Error("la IA no devolvió el plan");
    return JSON.parse(bloque.text);
  } finally {
    clearTimeout(temporizador);
  }
}

async function proponerPlan(DB, cliente, entrada, usuario, { hoy, timeoutMs = TIMEOUT_MS }) {
  const { texto, sucursal_id, periodo, inicio } = leerEntrada(DB, entrada || {});
  if (!cliente) throw errorCon(503, "El planeador con IA no está configurado");
  if (planesDeHoy(DB, usuario?.id ?? null, hoy) >= LIMITE_DIARIO) throw errorCon(429, `Llegaste al límite de ${LIMITE_DIARIO} planes por hoy`);

  const contexto = armarDatosPlan(DB, { sucursal_id, periodo, inicio }, hoy);
  const objetivo_enviado = quitarNombres(DB, texto);
  const plan = {
    // "pendiente" mientras la IA responde: un plan sin propuesta no se puede validar ni descartar.
    id: DB.pos.planes_ia.reduce((maximo, p) => Math.max(maximo, p.id), 0) + 1, estado: "pendiente",
    creado_por_id: usuario?.id ?? null, creado_por_nombre: usuario?.nombre || "desconocido", creado_en: new Date().toISOString(),
    entrada: { objetivo_texto: texto, objetivo_enviado, sucursal_id, periodo, inicio }, sin_historial: contexto.sinHistorial,
    propuesta: null, decisiones: [], validado_por_id: null, validado_por_nombre: null, validado_en: null, creados: null, error: null,
  };
  // Reservar el intento antes de esperar: las peticiones simultáneas cuentan para el límite y obtienen ids distintos.
  DB.pos.planes_ia.push(plan);
  try {
    const crudo = await pedirAlModelo(cliente, { objetivo: objetivo_enviado, datos: contexto.datos, catalogo: contexto.catalogo }, timeoutMs);
    plan.propuesta = validarPropuesta(crudo, { ...contexto, periodo });
    plan.estado = "borrador";
  } catch (e) {
    plan.estado = "fallido";
    plan.error = String(e.message || e).slice(0, 300);
    throw errorCon(502, MENSAJE_FALLA);
  }
  return plan;
}

module.exports = { proponerPlan, MENSAJE_FALLA, LIMITE_DIARIO, MODELO, ESQUEMA };
