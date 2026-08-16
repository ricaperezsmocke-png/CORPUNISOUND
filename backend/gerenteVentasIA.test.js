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

test("una meta que redondea a CERO no se ofrece como sugerencia", () => {
  // Con un promedio de $49, Math.round(49/100)*100 daba 0, y en la pantalla la
  // condición `sugerencia != null` es cierta para 0: salía el botón "Usar esta
  // meta" con $0 y aplicarlo dejaba a la vendedora sin objetivo.
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 49);

  const s = sugerirMeta(DB, 1, AHORA);
  assert.strictEqual(s.sugerencia, null, "una meta de $0 no es una meta");
  assert.strictEqual(s.confianza, "ninguna");
  assert.match(s.motivo, /demasiado bajo/i, "el texto debe decir por qué no hay cifra");
});

test("la confianza es honesta sobre cuánto historial hay", () => {
  // Los meses van HACIA ATRÁS desde julio (el último mes completo antes de
  // agosto), no desde enero: si el historial termina hace medio año, la
  // confianza se degrada por vieja y esta prueba mediría otra cosa.
  const conMeses = (n) => {
    const DB = nuevoDB();
    const meses = ["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02"];
    for (const mes of meses.slice(0, n)) venta(DB, `${mes}-10`, 30000);
    return sugerirMeta(DB, 1, AHORA).confianza;
  };
  assert.strictEqual(conMeses(1), "baja");
  assert.strictEqual(conMeses(3), "media");
  assert.strictEqual(conMeses(6), "alta");
});

test("un historial VIEJO no puede tener confianza alta", () => {
  // Seis meses buenos de hace más de un año daban "confianza alta" sobre datos
  // de 2025, y Victor iba a evaluar a una persona con esa cifra.
  const DB = nuevoDB();
  for (const mes of ["01", "02", "03", "04", "05", "06"]) venta(DB, `2025-${mes}-10`, 90000);

  const s = sugerirMeta(DB, 1, AHORA);
  assert.notStrictEqual(s.confianza, "alta", "no puede presentarse como dato firme");
  assert.match(s.motivo, /no tiene ventas registradas desde/i, "el texto debe advertirlo");
});

test("un mes SIN ventas cuenta como cero, no se lo salta", () => {
  // Una sola venta grande y ocho meses en blanco producían "vendió en promedio
  // $120,000 al mes, y su venta viene pareja" — dos afirmaciones falsas
  // presentadas como cálculo firme.
  const DB = nuevoDB();
  venta(DB, "2026-03-10", 120000); // un solo mes con ventas, dentro de la ventana

  const s = sugerirMeta(DB, 1, AHORA);
  assert.ok(s.meses_de_historial > 1, "los meses en blanco posteriores deben contar");
  assert.ok(
    s.detalle.promedio < 120000,
    `el promedio no puede ser el único mes bueno: dio ${s.detalle.promedio}`,
  );
  assert.ok(s.detalle.meses.some((m) => m.monto === 0), "debe haber meses en cero");
});

test("no se cuentan como cero los meses ANTERIORES a que la persona empezara", () => {
  // Alguien que entró en junio no debe arrastrar ceros de febrero a mayo: no
  // estaba, no es que no vendiera.
  const DB = nuevoDB();
  venta(DB, "2026-06-10", 40000);
  venta(DB, "2026-07-10", 40000);

  const s = sugerirMeta(DB, 1, AHORA);
  assert.strictEqual(s.meses_de_historial, 2);
  assert.strictEqual(s.detalle.promedio, 40000);
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

test("laCifraCuadra compara NÚMEROS, no subcadenas de dígitos", () => {
  // La versión anterior comparaba texto.replace(/[^\d]/g,"") como SUBCADENA, y
  // la revisión independiente demostró ejecutándola que dejaba pasar los cinco
  // primeros casos de abajo con una meta real de $30,000. Cada uno le habría
  // mostrado a Victor una cifra que nadie calculó.
  assert.ok(!laCifraCuadra("Ponle $300,000 al mes a Ana", 30000), "10x mas: 30000 esta dentro de 300000");
  assert.ok(!laCifraCuadra("Ponle $300.00 al mes", 30000), "100x menos, tras quitar el punto");
  assert.ok(!laCifraCuadra("Ponle $47,000", 4700), "10x mas");
  assert.ok(!laCifraCuadra("En 5 meses vendio 23,000 en promedio", 52300), "cifra formada cruzando dos numeros");
  assert.ok(!laCifraCuadra("da $30,000 pero yo te sugiero $85,000", 30000), "la correcta Y una inventada");

  // Y sigue aceptando lo legítimo, en cualquier formato.
  assert.ok(laCifraCuadra("Ponle $30,000", 30000));
  assert.ok(laCifraCuadra("Ponle 30000 de meta", 30000));
  assert.ok(laCifraCuadra("En 6 meses vendio $30,000 mensuales", 30000), "numeros chicos no son dinero");
});

test("sin cifra calculada, la IA no puede mencionar NINGUNA cantidad", () => {
  // El hueco peor de la version anterior: `if (!sugerencia) return true` apagaba
  // la verificacion entera justo donde no existe ninguna cifra legitima. Y en la
  // pantalla la insignia se oculta cuando no hay sugerencia, asi que lo UNICO
  // que Victor leia era el numero inventado.
  assert.ok(!laCifraCuadra("Ponle una meta de $65,000 a Ana", null));
  assert.ok(!laCifraCuadra("Yo le pondria $50,000", 0), "una meta de 0 tambien apagaba el candado");
  assert.ok(laCifraCuadra("Todavia no hay meses completos para calcular una meta.", null));
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

// ---------- Solo cuenta la venta de SU tienda (decisión de Victor, 2026-08-16) ----------

test("una venta hecha en OTRA tienda no cuenta para su meta ni para la sugerencia", () => {
  // El personal de Unisound no cambia de sucursal, así que hoy esto no mueve
  // ninguna cifra. Es la red para el día que alguien cubra un turno: la meta
  // mide el desempeño dentro de su tienda, y un gerente no debe ver totales
  // mezclados de otra sucursal.
  const DB = nuevoDB();
  DB.pos.ventas.push({ id: 1, vendedor_id: 1, total: 40000, fecha: "2026-07-10", estatus: "cerrada", sucursal_id: 1 });
  DB.pos.ventas.push({ id: 2, vendedor_id: 1, total: 90000, fecha: "2026-07-15", estatus: "cerrada", sucursal_id: 4 });

  const s = sugerirMeta(DB, 1, AHORA);
  assert.strictEqual(s.detalle.promedio, 40000, "la venta de Palenque no debe sumar");
});

test("una venta SIN sucursal registrada sí cuenta: no se castiga por un dato viejo", () => {
  const DB = nuevoDB();
  DB.pos.ventas.push({ id: 1, vendedor_id: 1, total: 40000, fecha: "2026-07-10", estatus: "cerrada" });
  assert.strictEqual(sugerirMeta(DB, 1, AHORA).detalle.promedio, 40000);
});

// ---------- El nombre del personal no sale hacia la IA ----------

test("el prompt que se le manda a Claude NO lleva el nombre de la vendedora", async () => {
  // Decisión de Victor: la explicación no mejora por saber el nombre, y el
  // nombre de su personal no tiene por qué salir del sistema. La pantalla sigue
  // mostrando el nombre real porque lo pone el código, no la IA.
  const DB = nuevoDB();
  venta(DB, "2026-07-10", 30000);

  let loQueSeEnvio = null;
  const ia = {
    messages: {
      create: async (params) => {
        loQueSeEnvio = JSON.stringify(params);
        return respuestaConTexto("Ponle $30,000: es su promedio.");
      },
    },
  };

  const r = await sugerirMetaConExplicacion(DB, ia, 1, AHORA);

  assert.ok(loQueSeEnvio, "la IA debió ser llamada");
  assert.ok(!loQueSeEnvio.includes("Ana López"), "el nombre no debe viajar a la IA");
  assert.ok(!loQueSeEnvio.includes("Ana"), "ni el nombre de pila");
  assert.ok(loQueSeEnvio.includes("30000"), "las cifras sí, son el dato del que se explica");
  assert.strictEqual(r.vendedor_nombre, "Ana López", "pero la pantalla sí lo muestra");
});

// ---------- El candado, endurecido tras la segunda revisión ----------

test("una cifra escrita CON LETRAS también se descarta", () => {
  // "cuarenta mil" es la forma más natural en español de México, y ningún
  // regex de dígitos la ve. Era el hueco por el que seguía colándose una cifra
  // que nadie calculó — incluso sin historial, que es el caso peor.
  assert.ok(!laCifraCuadra("Ponle $30,000. Yo la subiría a cuarenta mil.", 30000, []));
  assert.ok(!laCifraCuadra("Te sugiero treinta mil pesos de meta.", null, []));
  assert.ok(!laCifraCuadra("Te sugiero una meta de 65 mil pesos.", null, []));
});

test("un número que no se puede leer invalida el texto, no se ignora", () => {
  // "1.000.000" no parsea; antes se tiraba en silencio y el texto pasaba como
  // si esa cantidad no existiera.
  assert.ok(!laCifraCuadra("Ponle $30,000; el potencial es 1.000.000 al mes.", 30000, []));
});

test("la explicación SÍ puede mencionar el promedio y los meses reales", () => {
  // El prompt le pide a la IA que diga "de dónde sale" la meta, y el JSON que
  // recibe incluye el promedio. Una versión que solo aceptara la meta rechazaba
  // casi toda explicación legítima, dejando la llamada a Claude pagada y sin
  // usar.
  const permitidas = [28450, 27000, 31000];
  assert.ok(laCifraCuadra("Ponle $30,000. Su promedio fue de $28,450.", 30000, permitidas));
  assert.ok(laCifraCuadra("Ponle $30,000; en julio vendió $31,000.", 30000, permitidas));
  // Pero una cifra que NO venía en el JSON sigue invalidando todo.
  assert.ok(!laCifraCuadra("Ponle $30,000. Su promedio fue de $99,999.", 30000, permitidas));
});

test("una fecha no se confunde con una cantidad", () => {
  // "no vende desde 2026-02" es información legítima; 2026 pasaría el filtro de
  // $1,000 y habría invalidado el texto.
  assert.ok(laCifraCuadra("Ponle $30,000. No tiene ventas desde 2026-02.", 30000, []));
});

test("una meta menor a $1,000 puede validarse", () => {
  // sugerirMeta redondea a centenas y solo exige > 0, así que $800 es una meta
  // posible. El filtro de "esto es dinero" la escondía y NINGUNA redacción
  // podía pasar jamás para ese vendedor.
  assert.ok(laCifraCuadra("Ponle $800 de meta.", 800, []));
});

test("el separador de miles con espacio también se entiende", () => {
  assert.ok(laCifraCuadra("Ponle $30 000 de meta.", 30000, []));
});

test("la confianza baja UN escalón por historial viejo, no dos", () => {
  // Los dos `if` seguidos corrían sobre la variable ya mutada: seis meses
  // sólidos caían hasta "baja", indistinguibles de un solo mes.
  const DB = nuevoDB();
  // Seis meses completos, pero terminando dos meses antes del pasado.
  for (const mes of ["01", "02", "03", "04", "05", "06"]) venta(DB, `2026-${mes}-10`, 30000);
  const s = sugerirMeta(DB, 1, AHORA);
  assert.strictEqual(s.meses_de_historial, 6);
  assert.strictEqual(s.confianza, "media", "de 'alta' baja a 'media', no hasta 'baja'");
});
