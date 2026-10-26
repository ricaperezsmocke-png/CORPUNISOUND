import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esMetaNumero, legibleAEntero, enteroALegible, textoCifra, etiquetaCapturaCifra, textoResultadoMeta, textoPorcentajeMeta,
  hayBarra, hayAvance,
} from "./avanceMetas.js";
import { textoFaltan } from "./metas.js";

const PCT = "cinco_caminos:pct_con_cliente";
const TICKET = "cinco_caminos:ticket_promedio_centavos";
const NUEVOS = "cinco_caminos:clientes_nuevos";
const ARTICULOS = "cinco_caminos:articulos_por_ticket";

test("esMetaNumero reconoce solo las fuentes de los siete numeros", () => {
  assert.equal(esMetaNumero(PCT), true);
  assert.equal(esMetaNumero(TICKET), true);
  assert.equal(esMetaNumero("cinco_caminos:registros_por_10_tickets"), false);
  assert.equal(esMetaNumero("manual"), false);
  assert.equal(esMetaNumero(undefined), false);
});

test("legibleAEntero: 45.2 % es 452, 45 es 450, 45.25 se rechaza", () => {
  assert.deepEqual(legibleAEntero(PCT, "45.2"), { ok: true, valor: 452 });
  assert.deepEqual(legibleAEntero(PCT, "45"), { ok: true, valor: 450 });
  assert.deepEqual(legibleAEntero(PCT, " 45.2 % "), { ok: true, valor: 452 });
  assert.equal(legibleAEntero(PCT, "45.25").ok, false);
  assert.match(legibleAEntero(PCT, "45.25").error, /1 decimal./);
  assert.match(legibleAEntero(TICKET, "1.555").error, /2 decimales/);
  assert.deepEqual(legibleAEntero(PCT, "45,2"), { ok: true, valor: 452 });
  assert.deepEqual(legibleAEntero(PCT, "45.20"), { ok: true, valor: 452 });
  assert.deepEqual(legibleAEntero(NUEVOS, "12.0"), { ok: true, valor: 12 });
  assert.equal(legibleAEntero(PCT, "1,234.5").ok, false);
  assert.equal(legibleAEntero(PCT, "45.25"+"0").ok, false);
  assert.equal(legibleAEntero(PCT, "100.1").ok, false);
  assert.equal(legibleAEntero(PCT, "0").ok, false);
  assert.equal(legibleAEntero(PCT, "").ok, false);
  assert.equal(legibleAEntero(PCT, "abc").ok, false);
  assert.equal(legibleAEntero(PCT, "-5").ok, false);
});

test("legibleAEntero: pesos a centavos, sin errores de punto flotante", () => {
  assert.deepEqual(legibleAEntero(TICKET, "$850.5"), { ok: true, valor: 85050 });
  assert.deepEqual(legibleAEntero(TICKET, "850"), { ok: true, valor: 85000 });
  assert.deepEqual(legibleAEntero(TICKET, "19.99"), { ok: true, valor: 1999 });
  assert.equal(legibleAEntero(TICKET, "850.555").ok, false);
  assert.equal(legibleAEntero(TICKET, "10000.01").ok, false);
});

test("legibleAEntero: clientes enteros y articulos en centesimas", () => {
  assert.deepEqual(legibleAEntero(NUEVOS, "12"), { ok: true, valor: 12 });
  assert.equal(legibleAEntero(NUEVOS, "12.5").ok, false);
  assert.deepEqual(legibleAEntero(ARTICULOS, "1.85"), { ok: true, valor: 185 });
  assert.deepEqual(legibleAEntero(ARTICULOS, "2"), { ok: true, valor: 200 });
  assert.equal(legibleAEntero(ARTICULOS, "1.855").ok, false);
});

test("enteroALegible y textoCifra devuelven la unidad legible", () => {
  assert.equal(enteroALegible(PCT, 452), "45.2");
  assert.equal(enteroALegible(TICKET, 85000), "850.00");
  assert.equal(enteroALegible(NUEVOS, 12), "12");
  assert.equal(enteroALegible(ARTICULOS, 185), "1.85");
  assert.equal(textoCifra(PCT, 452), "45.2 %");
  assert.equal(textoCifra(PCT, 450), "45.0 %");
  assert.equal(textoCifra(TICKET, 85000), "$850.00");
  assert.equal(textoCifra(TICKET, 123456), "$1,234.56");
  assert.equal(textoCifra(NUEVOS, 12), "12 clientes por semana");
  assert.equal(textoCifra(ARTICULOS, 185), "1.85 artículos por ticket");
  assert.equal(textoCifra("manual", 7), "7");
  assert.equal(textoCifra(PCT, null), "Sin dato");
});

test("etiquetaCapturaCifra dice en que unidad se escribe la cifra", () => {
  assert.equal(etiquetaCapturaCifra(PCT), "Cifra meta (%, ej. 45.2)");
  assert.equal(etiquetaCapturaCifra(TICKET), "Cifra meta ($, ej. 850.00)");
  assert.equal(etiquetaCapturaCifra(NUEVOS), "Cifra meta (clientes por semana)");
  assert.equal(etiquetaCapturaCifra(ARTICULOS), "Cifra meta (artículos por ticket, ej. 1.85)");
});

test("textoResultadoMeta: una meta de cinco caminos no sale como 452 de 450", () => {
  const meta = { fuente: PCT, resultado: 452, valor_meta: 450, unidad: "%", sin_dato: false };
  assert.equal(textoResultadoMeta(meta), "45.2 % de 45.0 %");
  assert.equal(textoResultadoMeta({ fuente: TICKET, resultado: 80000, valor_meta: 85000, unidad: "centavos" }), "$800.00 de $850.00");
});

test("textoResultadoMeta: metas manuales igual que antes y sin dato claro", () => {
  assert.equal(textoResultadoMeta({ fuente: "manual", resultado: 3, valor_meta: 10, unidad: "videos" }), "3 de 10 videos");
  assert.equal(textoResultadoMeta({ resultado: 3, valor_meta: 10, unidad: "videos" }), "3 de 10 videos");
  assert.equal(textoResultadoMeta({ fuente: PCT, resultado: null, valor_meta: 450, unidad: "%", sin_dato: true }), "Sin dato (meta 45.0 %)");
  assert.equal(textoResultadoMeta({ fuente: "visitas_tienda", resultado: null, valor_meta: 4, unidad: "visitas", sin_dato: true }),
    "Sin dato (meta 4 visitas)");
});

test("porcentaje null o sin_dato: Sin dato, sin barra y sin %", () => {
  assert.equal(textoPorcentajeMeta({ porcentaje: null, sin_dato: true }), "Sin dato");
  assert.equal(textoPorcentajeMeta({ porcentaje: null }), "Sin dato");
  assert.equal(textoPorcentajeMeta({ porcentaje: undefined }), "Sin dato");
  assert.equal(textoPorcentajeMeta({ porcentaje: 0 }), "0%");
  assert.equal(textoPorcentajeMeta({ porcentaje: 83.5 }), "83.5%");
  assert.equal(hayBarra({ porcentaje: null, sin_dato: true }), false);
  assert.equal(hayBarra({ porcentaje: 0, sin_dato: false }), true);
  assert.equal(hayBarra({ porcentaje: 50 }), true);
  assert.equal(hayAvance({ porcentaje: null }), false);
  assert.equal(hayAvance({ porcentaje: 0 }), true);
});

test("textoFaltan: sin dato no inventa faltantes y las cifras salen en su unidad", () => {
  assert.equal(textoFaltan({ fuente: PCT, resultado: null, valor_meta: 450, unidad: "%", sin_dato: true }, "2026-10-31", "2026-10-20"),
    "Sin dato todavía");
  assert.equal(textoFaltan({ fuente: PCT, resultado: null, valor_meta: 450, unidad: "%", sin_dato: true }, "2026-10-18", "2026-10-20"), "Sin dato");
  assert.equal(textoFaltan({ fuente: "manual", resultado: 6, valor_meta: 10, unidad: "videos" }, "2026-10-18", "2026-10-19"),
    "Faltaron 4 videos");
  assert.equal(textoFaltan({ fuente: PCT, resultado: 400, valor_meta: 452, unidad: "%" }, "2026-10-18", "2026-10-19"), "Faltaron 5.2 %");
  assert.equal(textoFaltan({ fuente: PCT, resultado: 460, valor_meta: 452, unidad: "%" }, "2026-10-18", "2026-10-19"), "Meta cumplida");
});

test("mostrarMias: solo en metas manuales de tienda o empresa", async () => {
  const { mostrarMias } = await import("./avanceMetas.js");
  assert.equal(mostrarMias({ alcance: "tienda", fuente: "manual" }), true);
  assert.equal(mostrarMias({ alcance: "tienda" }), true);
  assert.equal(mostrarMias({ alcance: "tienda", fuente: "cinco_caminos:pct_con_cliente" }), false);
  assert.equal(mostrarMias({ alcance: "persona", fuente: "manual" }), false);
  assert.equal(mostrarMias({ alcance: "corporativo", fuente: "manual" }), false);
});
