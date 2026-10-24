import { test } from "node:test";
import assert from "node:assert/strict";
import { haceCuanto, claseExistencia, formatoExistencia, avisoTienda } from "./existenciasSicar.js";

const AHORA = new Date("2026-10-23T18:00:00.000Z");

test("haceCuanto: minutos, horas y fecha", () => {
  assert.equal(haceCuanto("2026-10-23T17:57:00.000Z", AHORA), "hace 3 min");
  assert.equal(haceCuanto("2026-10-23T15:50:00.000Z", AHORA), "hace 2 h");
  assert.equal(haceCuanto("2026-10-23T17:59:50.000Z", AHORA), "hace unos segundos");
  assert.match(haceCuanto("2026-10-21T18:04:00.000Z", AHORA), /^el 21\/10 \d{2}:\d{2}$/);
  assert.equal(haceCuanto(null, AHORA), "nunca");
  assert.equal(haceCuanto("basura", AHORA), "nunca");
});

test("claseExistencia: rojo, gris claro, normal y gris si no esta confirmada", () => {
  assert.match(claseExistencia("-1.0000", null), /red/);
  assert.match(claseExistencia("0.0000", null), /slate-400/);
  assert.match(claseExistencia("3.0000", null), /slate-900/);
  assert.match(claseExistencia("3.0000", "2026-10-20T00:00:00.000Z"), /slate-400/);
  assert.match(claseExistencia("-1.0000", "2026-10-20T00:00:00.000Z"), /slate-400/);
});

test("formatoExistencia: enteros sin decimales y fracciones recortadas", () => {
  assert.equal(formatoExistencia("3.0000"), "3");
  assert.equal(formatoExistencia("-1.0000"), "-1");
  assert.equal(formatoExistencia("0.0000"), "0");
  assert.equal(formatoExistencia("2.5000"), "2.5");
  assert.equal(formatoExistencia("-0.0250"), "-0.025");
  assert.equal(formatoExistencia(undefined), "—");
});

test("avisoTienda: ambar solo si el agente lleva mas de 24 h sin enviar", () => {
  const ok = { nombre: "Ocosingo", sin_contacto_24h: false, ultimo_contacto: "2026-10-23T17:57:00.000Z" };
  assert.equal(avisoTienda(ok, AHORA), null);
  const mal = { nombre: "Yajalón", sin_contacto_24h: true, ultimo_contacto: "2026-10-21T18:04:00.000Z" };
  assert.match(avisoTienda(mal, AHORA), /^El agente de esta tienda no ha enviado nada desde el 21\/10/);
  const nunca = { nombre: "X", sin_contacto_24h: true, ultimo_contacto: null };
  assert.match(avisoTienda(nunca, AHORA), /no ha enviado nada/);
});
