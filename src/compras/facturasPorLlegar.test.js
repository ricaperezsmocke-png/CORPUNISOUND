import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textoEspera, nombreEstado, formatoCentavos, motivoValido, puedeRegistrar, resumenFacturas, fechaCorta, archivoXmlValido,
  mensajeResultado,
} from "./facturasPorLlegar.js";

test("textoEspera cuenta dias solo mientras la factura esta por llegar", () => {
  assert.equal(textoEspera({ estado: "por_llegar", dias_espera: 0 }), "Hoy");
  assert.equal(textoEspera({ estado: "por_llegar", dias_espera: 1 }), "1 día");
  assert.equal(textoEspera({ estado: "por_llegar", dias_espera: 20, aviso: true }), "20 días");
  assert.equal(textoEspera({ estado: "llego", dias_espera: null }), "—");
});

test("nombreEstado", () => {
  assert.equal(nombreEstado("por_llegar"), "Por llegar");
  assert.equal(nombreEstado("llego"), "Llegó");
  assert.equal(nombreEstado("cancelada"), "Cancelada");
});

test("formatoCentavos pone pesos con miles sin flotantes", () => {
  assert.equal(formatoCentavos(1621800), "$16,218.00");
  assert.equal(formatoCentavos(5), "$0.05");
  assert.equal(formatoCentavos(null), "—");
});

test("motivoValido pide entre 3 y 200 caracteres", () => {
  assert.equal(motivoValido("  "), false);
  assert.equal(motivoValido("ab"), false);
  assert.equal(motivoValido(" abc "), true);
  assert.equal(motivoValido("x".repeat(201)), false);
});

test("puedeRegistrar usa registrar_facturas_por_llegar", () => {
  assert.equal(puedeRegistrar(["registrar_facturas_por_llegar"]), true);
  assert.equal(puedeRegistrar(["ver_facturas_por_llegar"]), false);
  assert.equal(puedeRegistrar(undefined), false);
});

test("resumenFacturas da el aviso de mas de 15 dias", () => {
  assert.equal(resumenFacturas({ facturas: [], vencidas: 0, dias_aviso: 15 }), "");
  assert.equal(resumenFacturas({ facturas: [{}], vencidas: 1, dias_aviso: 15 }), "1 factura lleva más de 15 días sin llegar.");
  assert.equal(resumenFacturas({ facturas: [{}, {}], vencidas: 2, dias_aviso: 15 }), "2 facturas llevan más de 15 días sin llegar.");
});

test("fechaCorta", () => {
  assert.equal(fechaCorta("2026-10-25 08:00:00"), "25/10/2026");
  assert.equal(fechaCorta("2026-10-25T14:03:00.000Z").length, 10);
  assert.equal(fechaCorta(null), "—");
});

test("archivoXmlValido acepta .xml y rechaza otros o archivos enormes", () => {
  assert.equal(archivoXmlValido({ name: "F.xml", size: 1000 }), "");
  assert.equal(archivoXmlValido({ name: "F.XML", size: 1000 }), "");
  assert.match(archivoXmlValido({ name: "F.pdf", size: 1000 }), /XML/);
  assert.match(archivoXmlValido({ name: "F.xml", size: 6 * 1024 * 1024 }), /grande/);
});

test("mensajeResultado resume cargas de varios archivos", () => {
  const r = mensajeResultado([{ nombre: "a.xml", ok: true }, { nombre: "b.xml", ok: false, error: "Esa factura ya está registrada." }]);
  assert.equal(r.ok, 1);
  assert.deepEqual(r.errores, ["b.xml: Esa factura ya está registrada."]);
});
