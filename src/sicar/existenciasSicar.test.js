import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haceCuanto, fechaTienda, claseExistencia, formatoExistencia, avisoTienda, textoSinConfirmar, paginaDelServidor,
} from "./existenciasSicar.js";

const AHORA = new Date("2026-10-23T18:00:00.000Z");

test("haceCuanto: minutos, horas y fecha", () => {
  assert.equal(haceCuanto("2026-10-23T17:57:00.000Z", AHORA), "hace 3 min");
  assert.equal(haceCuanto("2026-10-23T15:50:00.000Z", AHORA), "hace 2 h");
  assert.equal(haceCuanto("2026-10-23T17:59:50.000Z", AHORA), "hace unos segundos");
  assert.equal(haceCuanto("2026-10-21T18:04:00.000Z", AHORA), "el 21/10 12:04");
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

test("fechaTienda: hoy / ayer / fecha, siempre en hora de Chiapas", () => {
  const ahora = new Date("2026-10-26T18:00:00.000Z"); // lunes 26/10 12:00 en Chiapas
  assert.equal(fechaTienda("2026-10-26T16:42:00.000Z", ahora), "hoy 10:42");
  assert.equal(fechaTienda("2026-10-26T00:04:00.000Z", ahora), "ayer 18:04");
  assert.equal(fechaTienda("2026-10-22T00:04:00.000Z", ahora), "el 21/10 18:04");
  assert.equal(fechaTienda(null, ahora), "nunca");
  assert.equal(fechaTienda("basura", ahora), "nunca");
});

test("fechaTienda: la misma fecha de hace un año no se muestra como hoy ni ayer", () => {
  const ahora = new Date("2026-10-26T18:00:00.000Z");
  assert.equal(fechaTienda("2025-10-26T16:42:00.000Z", ahora), "el 26/10 10:42");
  assert.equal(fechaTienda("2025-10-25T16:42:00.000Z", ahora), "el 25/10 10:42");
});

test("fechaTienda: el dia UTC y el de Chiapas no coinciden", () => {
  // 2026-10-26T03:00Z es el 25/10 21:00 en Chiapas
  const ahora = new Date("2026-10-26T03:30:00.000Z");
  assert.equal(fechaTienda("2026-10-26T03:00:00.000Z", ahora), "hoy 21:00");
  assert.equal(fechaTienda("2026-10-25T20:00:00.000Z", ahora), "hoy 14:00");
  assert.equal(fechaTienda("2026-10-25T03:00:00.000Z", ahora), "ayer 21:00");
  assert.equal(fechaTienda("2026-10-24T03:00:00.000Z", new Date("2026-10-26T18:00:00.000Z")), "el 23/10 21:00");
});

test("textoSinConfirmar: texto visible bajo la cantidad con dia y hora; nada si esta confirmada", () => {
  const ahora = new Date("2026-10-26T18:00:00.000Z");
  assert.equal(textoSinConfirmar("2026-10-22T00:04:00.000Z", ahora), "sin confirmar desde el 21/10 18:04");
  assert.equal(textoSinConfirmar("2026-10-26T00:04:00.000Z", ahora), "sin confirmar desde ayer 18:04");
  assert.equal(textoSinConfirmar(null), null);
  assert.equal(textoSinConfirmar(undefined), null);
  assert.equal(textoSinConfirmar("basura"), null);
});

test("paginaDelServidor: se queda con la pagina que el servidor dice que mostro", () => {
  assert.equal(paginaDelServidor(5, { pagina: 3 }), 3);
  assert.equal(paginaDelServidor(2, { pagina: "2" }), 2);
  assert.equal(paginaDelServidor(4, null), 4);
  assert.equal(paginaDelServidor(4, { pagina: 0 }), 4);
  assert.equal(paginaDelServidor(4, { pagina: "x" }), 4);
  assert.equal(paginaDelServidor(4, {}), 4);
});
