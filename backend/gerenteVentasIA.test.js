/**
 * gerenteVentasIA.test.js — La sugerencia de meta y su capa de redacción.
 *
 * Lo que se prueba aquí NO es qué tan bien redacta Claude — eso no se puede
 * probar y no importa. Se prueba lo que sí importa: que la CIFRA salga siempre
 * del cálculo sobre ventas reales, que una IA caída o equivocada nunca deje a
 * Victor sin sugerencia, y que una redacción que invente un número distinto se
 * descarte antes de llegar a la pantalla.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { sugerirMeta } = require("./gerenteVentas");
const { sugerirMetaConExplicacion, laCifraCuadra } = require("./gerenteVentasIA");

const AHORA = "2026-08-15T18:00:00.000Z"; // agosto: los meses completos llegan a julio

function nuevoDB() {
  return {
    pos: {
      ventas: [],
      venta_detalle: [],
      vendedores: [{ id: 1, nombre: "Ana López", sucursal_id: 1, meta_mensual: 0 }],
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      tareas_venta: { tareas: [], ultimo_id: 0 },
    },
    crm: { clientes: [] },
    "catalogo-productos": { productos: [], categorias: [], proveedores: [] },
  };
}

function venta(DB, fecha, total, estatus = "cerrada") {
  DB.pos.ventas.push({
    id: DB.pos.ventas.length + 1, vendedor_id: 1, total, fecha, estatus, sucursal_id: 1,
  });
}

/** Cliente de Anthropic falso: devuelve lo que se le diga, o revienta. */
function iaFalsa(comportamiento) {
  return {
    messages: {
      create: async () => {
        if (typeof comportamiento === "function") return comportamiento();
        return comportamiento;
      },
    },
  };
}

const respuestaConTexto = (texto) => ({ stop_reason: "end_turn", content: [{ type: "text", text: texto }] });

// ---------- La cifra ----------

test("la meta sugerida sale del promedio de los meses completos", () => {
  const DB = nuevoDB();
  venta(DB, "2026-05-10", 40000);
  venta(DB, "2026-06-10", 40000);
  venta(DB, "2026-07-10", 40000);

  const s = sugerirMeta(DB, 1, AHORA);
  assert.strictEqual(s.detalle.promedio, 40000);
  assert.strictEqual(s.sugerencia, 40000, "sin tendencia, la meta es el promedio");
  assert.strictEqual(s.meses_de_historial, 3);
});

test("el mes EN CURSO no cuenta: va a la mitad y hundiría la meta", () => {
  // Es agosto 15. Agosto lleva media venta; si contara, el promedio caería y la
  // meta saldría artificialmente baja justo por estar a mitad de mes.
  const DB = nuevoDB();
  venta(DB, "2026-06-10", 50000);
  venta(DB, "2026-07-10", 50000);
  venta(DB, "2026-08-05", 3000); // mes en curso, incompleto

  const s = sugerirMeta(DB, 1, AHORA);
  assert.strictEqual(s.detalle.promedio, 50000);
  assert.ok(!s.detalle.meses.some((m) => m.mes === "2026-08"), "agosto no debe entrar");
});

test("una venta CANCELADA no infla la meta sugerida", () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  venta(DB, "2026-07-11", 90000, "cancelada");
  assert.strictEqual(sugerirMeta(DB, 1, AHORA).detalle.promedio, 30000);
});

test("una venta al alza sube la meta, pero con tope", () => {
  // Sin tope, este salto (de 10k a 100k) produciría una meta imposible.
  const DB = nuevoDB();
  venta(DB, "2026-04-10", 10000);
  venta(DB, "2026-05-10", 10000);
  venta(DB, "2026-06-10", 100000);
  venta(DB, "2026-07-10", 100000);

  const s = sugerirMeta(DB, 1, AHORA);
  const promedio = s.detalle.promedio; // 55,000
  assert.ok(s.sugerencia > promedio, "la tendencia al alza debe subir la meta");
  assert.ok(
    s.sugerencia <= Math.round(promedio * 1.2 / 100) * 100,
    `la subida se topa al 20%: ${s.sugerencia} sobre un promedio de ${promedio}`,
  );
});

test("una venta a la baja baja la meta, también con tope", () => {
  const DB = nuevoDB();
  venta(DB, "2026-04-10", 100000);
  venta(DB, "2026-05-10", 100000);
  venta(DB, "2026-06-10", 10000);
  venta(DB, "2026-07-10", 10000);

  const s = sugerirMeta(DB, 1, AHORA);
  const promedio = s.detalle.promedio;
  assert.ok(s.sugerencia < promedio);
  assert.ok(s.sugerencia >= Math.round(promedio * 0.8 / 100) * 100);
});

test("la meta se redondea a centenas: $47,383 se ve calculada con calzador", () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 47383);
  assert.strictEqual(sugerirMeta(DB, 1, AHORA).sugerencia % 100, 0);
});

test("sin historial NO se inventa una meta", () => {
  // Inventar un número aquí sería lo peor que podría hacer este módulo: Victor
  // evaluaría a alguien con una cifra sacada de la nada.
  const s = sugerirMeta(nuevoDB(), 1, AHORA);
  assert.strictEqual(s.sugerencia, null);
  assert.strictEqual(s.confianza, "ninguna");
  assert.match(s.motivo, /no hay/i);
});

test("la confianza es honesta sobre cuánto historial hay", () => {
  const conMeses = (n) => {
    const DB = nuevoDB();
    for (let i = 1; i <= n; i++) {
      venta(DB, `2026-0${i}-10`, 30000);
    }
    return sugerirMeta(DB, 1, AHORA).confianza;
  };
  assert.strictEqual(conMeses(1), "baja");
  assert.strictEqual(conMeses(3), "media");
  assert.strictEqual(conMeses(6), "alta");
});

test("con poco historial el texto lo ADVIERTE", () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  assert.match(sugerirMeta(DB, 1, AHORA).motivo, /poco historial/i);
});

// ---------- La caída elegante ----------

test("si la IA revienta, la sugerencia sale igual con el texto calculado", async () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  const ia = iaFalsa(() => { throw new Error("sin conexión"); });

  const r = await sugerirMetaConExplicacion(DB, ia, 1, AHORA);
  assert.strictEqual(r.sugerencia, 30000, "la cifra no depende de la IA");
  assert.strictEqual(r.redactado_por_ia, false);
  assert.ok(r.redaccion.length > 0, "siempre hay algo que mostrar");
});

test("sin cliente de IA configurado, la pantalla sigue funcionando", async () => {
  // Caso real: ANTHROPIC_API_KEY sin poner en Render.
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  const r = await sugerirMetaConExplicacion(DB, null, 1, AHORA);
  assert.strictEqual(r.sugerencia, 30000);
  assert.strictEqual(r.redactado_por_ia, false);
});

test("si la IA se NIEGA a responder, tampoco truena", async () => {
  // Una negativa llega como respuesta exitosa con stop_reason "refusal" y
  // contenido vacío: leer content[0].text a ciegas reventaría aquí.
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  const ia = iaFalsa({ stop_reason: "refusal", content: [] });

  const r = await sugerirMetaConExplicacion(DB, ia, 1, AHORA);
  assert.strictEqual(r.redactado_por_ia, false);
  assert.strictEqual(r.sugerencia, 30000);
});

test("si la IA responde vacío, se usa el texto calculado", async () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  const r = await sugerirMetaConExplicacion(DB, iaFalsa(respuestaConTexto("   ")), 1, AHORA);
  assert.strictEqual(r.redactado_por_ia, false);
});

// ---------- El candado contra cifras inventadas ----------

test("si la IA propone OTRA cifra, su texto se DESCARTA entero", async () => {
  // Esto es lo que separa una sugerencia útil de un riesgo real: si la IA
  // escribe "te sugiero $75,000" cuando el cálculo dio $30,000, Victor podría
  // fijarle a una cajera una meta que nadie calculó.
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  const ia = iaFalsa(respuestaConTexto("Te sugiero una meta de $75,000 para Ana."));

  const r = await sugerirMetaConExplicacion(DB, ia, 1, AHORA);
  assert.strictEqual(r.redactado_por_ia, false, "no debe mostrar una cifra inventada");
  assert.ok(!r.redaccion.includes("75,000"));
  assert.strictEqual(r.sugerencia, 30000);
});

test("si la IA respeta la cifra, su redacción SÍ se usa", async () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  const ia = iaFalsa(respuestaConTexto("Ponle $30,000 a Ana: es lo que ha vendido en promedio."));

  const r = await sugerirMetaConExplicacion(DB, ia, 1, AHORA);
  assert.strictEqual(r.redactado_por_ia, true);
  assert.match(r.redaccion, /30,000/);
});

test("laCifraCuadra ignora el formato del número, no la cifra", () => {
  // "$30,000", "30000" y "30 000" son la misma meta escrita distinto.
  assert.ok(laCifraCuadra("Ponle $30,000", 30000));
  assert.ok(laCifraCuadra("Ponle 30000 de meta", 30000));
  assert.ok(!laCifraCuadra("Ponle $75,000", 30000));
  assert.ok(laCifraCuadra("cualquier cosa", null), "sin meta que verificar, no hay nada que romper");
});

test("si la IA tarda demasiado, no deja la pantalla colgada", async () => {
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);
  // Nunca resuelve: sin el timeout, esta prueba se quedaría colgada para siempre.
  const ia = { messages: { create: () => new Promise(() => {}) } };

  const empezo = Date.now();
  const r = await Promise.race([
    sugerirMetaConExplicacion(DB, ia, 1, AHORA),
    new Promise((listo) => setTimeout(() => listo({ agotado: true }), 20_000)),
  ]);
  assert.ok(!r.agotado, `no debió esperar 20s (esperó ${Date.now() - empezo} ms)`);
  assert.strictEqual(r.redactado_por_ia, false);
});
