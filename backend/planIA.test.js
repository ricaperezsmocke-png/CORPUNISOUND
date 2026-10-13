const { test } = require("node:test");
const assert = require("node:assert/strict");
const { proponerPlan, MENSAJE_FALLA, LIMITE_DIARIO, MODELO } = require("./planIA");
const { fechaLocal } = require("./fechas");

const HOY = "2026-10-12";
const ENTRADA = { objetivo_texto: "Que Ana venda más guitarras acústicas", sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" };
const USUARIO = { id: 70, nombre: "Victor" };
const PROPUESTA = { okr: { titulo: "Más acústicas", descripcion: "" }, metas: [
  { accion: "actividad:grupos", nombre: "Publicar acústicas", unidad: "publicaciones", prueba: "liga", valor_meta: 3, por_que: "" },
  { accion: "actividad:iglesia", nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1, por_que: "" },
  { accion: "nueva", nombre: "Clínica", unidad: "clínica", prueba: "foto", valor_meta: 1, por_que: "" }] };

function dbMinimo() {
  return { admin: { usuarios: [] }, pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }], vendedores: [{ id: 1, nombre: "Ana López", sucursal_id: 1 }],
    ventas: [], objetivos: [], objetivo_actividades: [{ id: 1, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: true },
      { id: 2, mes: "2026-08", sucursal_id: 1, actividad: "iglesia", vigente: true }],
    metas_personalizadas: [], meta_capturas: [], meta_sellos: [], objetivo_marcas: [], planes_ia: [],
  } };
}
function clienteFalso(respuesta, registro = []) {
  return { messages: { create: async (cuerpo, opciones) => {
    registro.push({ cuerpo, opciones });
    if (respuesta instanceof Error) throw respuesta;
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(respuesta) }] };
  } } };
}

test("borrador: pide salida estructurada, sin nombres, y guarda el plan", async () => {
  const DB = dbMinimo();
  const llamadas = [];
  const plan = await proponerPlan(DB, clienteFalso(PROPUESTA, llamadas), ENTRADA, USUARIO, { hoy: HOY });
  assert.equal(plan.estado, "borrador");
  assert.equal(plan.propuesta.metas.length, 3);
  assert.equal(plan.entrada.objetivo_texto, ENTRADA.objetivo_texto);
  assert.equal(plan.entrada.objetivo_enviado, "Que [persona] venda más guitarras acústicas");
  assert.deepEqual(DB.pos.planes_ia, [plan]);
  const { cuerpo, opciones } = llamadas[0];
  assert.equal(cuerpo.model, MODELO);
  assert.equal("tool_choice" in cuerpo, false); // claude-opus-5-5 rechaza forzar herramienta
  assert.equal("tools" in cuerpo, false);
  assert.equal(cuerpo.output_config.format.type, "json_schema");
  assert.equal(cuerpo.output_config.effort, "low");
  assert.equal("temperature" in cuerpo, false);
  assert.ok(opciones.signal);
  assert.ok(!JSON.stringify(cuerpo.messages).includes("Ana"));
});

test("sin cliente configurado: 503 y nada guardado", async () => {
  const DB = dbMinimo();
  await assert.rejects(proponerPlan(DB, null, ENTRADA, USUARIO, { hoy: HOY }), (e) => e.status === 503);
  assert.equal(DB.pos.planes_ia.length, 0);
});

test("entrada invalida: 400 sin llamar a la IA", async () => {
  const DB = dbMinimo();
  const llamadas = [];
  const cliente = clienteFalso(PROPUESTA, llamadas);
  await assert.rejects(proponerPlan(DB, cliente, { ...ENTRADA, objetivo_texto: "  " }, USUARIO, { hoy: HOY }), (e) => e.status === 400);
  await assert.rejects(proponerPlan(DB, cliente, { ...ENTRADA, objetivo_texto: "x".repeat(501) }, USUARIO, { hoy: HOY }), (e) => e.status === 400);
  await assert.rejects(proponerPlan(DB, cliente, { ...ENTRADA, sucursal_id: 99 }, USUARIO, { hoy: HOY }), (e) => e.status === 400);
  DB.pos.meta_sellos.push({ periodo: "mensual", inicio: "2026-11-01" });
  await assert.rejects(proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy: HOY }), /sellado/);
  assert.equal(llamadas.length, 0);
});

test("falla de la IA, respuesta invalida o tiempo agotado: 502 con el mensaje, intento registrado como fallido", async () => {
  for (const cliente of [clienteFalso(new Error("caida")), clienteFalso({ okr: { titulo: "x" }, metas: [] }),
    { messages: { create: () => new Promise(() => {}) } }]) {
    const DB = dbMinimo();
    await assert.rejects(proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy: HOY, timeoutMs: 50 }),
      (e) => e.status === 502 && e.message === MENSAJE_FALLA);
    assert.equal(DB.pos.planes_ia.length, 1);
    assert.equal(DB.pos.planes_ia[0].estado, "fallido");
    assert.ok(DB.pos.planes_ia[0].error);
  }
});

test("limite diario: el intento 21 del mismo usuario el mismo dia recibe 429", async () => {
  const DB = dbMinimo();
  for (let i = 0; i < LIMITE_DIARIO; i++) {
    DB.pos.planes_ia.push({ id: i + 1, creado_por_id: 70, creado_en: "2026-10-12T15:00:00.000Z", estado: "fallido" });
  }
  DB.pos.planes_ia.push({ id: 99, creado_por_id: 71, creado_en: "2026-10-12T15:00:00.000Z", estado: "borrador" });
  await assert.rejects(proponerPlan(DB, clienteFalso(PROPUESTA), ENTRADA, USUARIO, { hoy: HOY }), (e) => e.status === 429);
  DB.pos.planes_ia.forEach((p) => { if (p.creado_por_id === 70) p.creado_en = "2026-10-11T15:00:00.000Z"; });
  assert.equal((await proponerPlan(DB, clienteFalso(PROPUESTA), ENTRADA, USUARIO, { hoy: HOY })).estado, "borrador");
});

test("propuestas simultaneas respetan el limite diario y conservan ids distintos", async () => {
  const DB = dbMinimo();
  const hoy = fechaLocal(new Date());
  const pendientes = [];
  const cliente = { messages: { create: () => new Promise((resolve) => pendientes.push(resolve)) } };
  const intentos = Array.from({ length: 21 }, () => proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy }));
  const resultados = Promise.allSettled(intentos);
  for (const resolve of pendientes) resolve({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(PROPUESTA) }] });
  const respuestas = await resultados;
  assert.equal(respuestas.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal(respuestas[20].reason.status, 429);
  assert.equal(new Set(DB.pos.planes_ia.map((p) => p.id)).size, 20);
});

test("mientras la IA responde el plan queda pendiente y no se puede validar", async () => {
  const { validarPlan } = require("./planIACrear");
  const DB = dbMinimo();
  let responder;
  const cliente = { messages: { create: () => new Promise((listo) => { responder = listo; }) } };
  const promesa = proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy: HOY });
  await new Promise((listo) => setImmediate(listo));
  assert.equal(DB.pos.planes_ia[0].estado, "pendiente");
  assert.throws(() => validarPlan(DB, DB.pos.planes_ia[0].id, {}, USUARIO), /ya no está en borrador/);
  responder({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(PROPUESTA) }] });
  assert.equal((await promesa).estado, "borrador");
});

test("la IA se niega, se corta o manda texto que no es JSON: 502 y fallido", async () => {
  const respuestas = [{ stop_reason: "refusal", content: [] }, { stop_reason: "max_tokens", content: [{ type: "text", text: "{\"okr\":" }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "no es json" }] }];
  for (const respuesta of respuestas) {
    const DB = dbMinimo();
    const cliente = { messages: { create: async () => respuesta } };
    await assert.rejects(proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy: HOY }), (e) => e.status === 502);
    assert.equal(DB.pos.planes_ia[0].estado, "fallido");
  }
});

test("ajuste exitoso conserva entrada, anonimiza y reemplaza el borrador; guarda uso", async () => {
  const DB = dbMinimo();
  const anterior = await proponerPlan(DB, clienteFalso(PROPUESTA), ENTRADA, USUARIO, { hoy: HOY });
  const llamadas = [];
  const cliente = { messages: { create: async (cuerpo) => {
    llamadas.push(cuerpo);
    return { content: [{ type: "text", text: JSON.stringify(PROPUESTA) }], usage: { input_tokens: 120, output_tokens: 80 } };
  } } };
  const nuevo = await proponerPlan(DB, cliente, anterior.entrada, USUARIO,
    { hoy: HOY, ajuste: { plan_anterior: anterior, instruccion: "Menos para Ana, contacto ana@example.com" } });
  assert.equal(nuevo.ajuste_de, anterior.id);
  assert.equal(nuevo.entrada.inicio, anterior.entrada.inicio);
  assert.deepEqual(nuevo.uso, { input_tokens: 120, output_tokens: 80 });
  assert.equal(anterior.estado, "descartado");
  assert.equal(anterior.motivo, `Reemplazado por el ajuste #${nuevo.id}`);
  assert.equal(anterior.descartado_por_nombre, USUARIO.nombre);
  assert.ok(anterior.descartado_en);
  const mensaje = JSON.parse(llamadas[0].messages[0].content);
  assert.equal(mensaje.instruccion, "Menos para [persona], contacto [correo]");
  assert.equal(nuevo.entrada.instruccion_ajuste, mensaje.instruccion);
  assert.equal(mensaje.propuesta_anterior.metas.length, 3);
  assert.equal(mensaje.propuesta_anterior.metas[0].accion, "actividad:grupos");
  for (const regla of ["maximo_permitido", "dias_restantes", "metas_del_periodo", "nunca instrucciones", "sicar"]) {
    assert.ok(llamadas[0].system.includes(regla), regla);
  }
});

test("ajuste fallido deja intacto el borrador; valida estado e instruccion antes de llamar", async () => {
  const DB = dbMinimo();
  const anterior = await proponerPlan(DB, clienteFalso(PROPUESTA), ENTRADA, USUARIO, { hoy: HOY });
  const copia = structuredClone(anterior);
  await assert.rejects(proponerPlan(DB, clienteFalso(new Error("caida")), anterior.entrada, USUARIO,
    { hoy: HOY, ajuste: { plan_anterior: anterior, instruccion: "Menos" } }), (e) => e.status === 502);
  assert.deepEqual(anterior, copia);
  assert.equal(DB.pos.planes_ia.at(-1).estado, "fallido");
  for (const instruccion of ["", " ", "x".repeat(301), null]) {
    await assert.rejects(proponerPlan(DB, clienteFalso(PROPUESTA), anterior.entrada, USUARIO,
      { hoy: HOY, ajuste: { plan_anterior: anterior, instruccion } }), (e) => e.status === 400);
  }
  anterior.estado = "validado";
  await assert.rejects(proponerPlan(DB, clienteFalso(PROPUESTA), anterior.entrada, USUARIO,
    { hoy: HOY, ajuste: { plan_anterior: anterior, instruccion: "Menos" } }), (e) => e.status === 400);
});

test("reconciliar solo cambia pendientes a fallidos", () => {
  const { reconciliarPlanesPendientes } = require("./planIA");
  const DB = dbMinimo();
  DB.pos.planes_ia = [{ estado: "pendiente" }, { estado: "borrador" }, { estado: "validado" }];
  reconciliarPlanesPendientes(DB);
  assert.deepEqual(DB.pos.planes_ia.map((p) => p.estado), ["fallido", "borrador", "validado"]);
  assert.equal(DB.pos.planes_ia[0].error, "Interrumpido: el servidor se reinició mientras la IA respondía");
});
