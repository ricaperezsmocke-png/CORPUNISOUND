import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textoPersona, claseDiferencia, textoAtribucion, formatoDinero, nombreFormaPago, fechaHoraCorte, parametrosCortes, contadorDePeticiones,
} from "./cortesSicar.js";

test("textoPersona: sin nombre, con nombre y ventas sin usuario", () => {
  assert.equal(textoPersona({ usu_id: "52", nombre: null }), "Usuario SICAR 52 — sin nombre");
  assert.equal(textoPersona({ usu_id: "52", nombre: "Fulana" }), "Fulana (SICAR 52)");
  assert.equal(textoPersona({ usu_id: "", nombre: null }), "Ventas sin usuario registrado");
  assert.equal(textoPersona(null), "—");
});

test("claseDiferencia: tenue bajo $1, ambar faltante, azul sobrante, normal en cero", () => {
  assert.match(claseDiferencia("-0.33"), /amber-500/);
  assert.match(claseDiferencia("-1.00"), /amber-700/);
  assert.match(claseDiferencia("-25.50"), /amber-700/);
  assert.match(claseDiferencia("0.50"), /blue-400/);
  assert.match(claseDiferencia("1.00"), /blue-700/);
  assert.match(claseDiferencia("0.00"), /slate-900/);
  assert.match(claseDiferencia("-0.00"), /slate-900/);
});

test("textoAtribucion: propia, compartida, sin usuario y sin ventas dicen solo lo que se sabe", () => {
  const propia = { atribucion: "propia", atribuida_a: { usu_id: "52", nombre: "Fulana" } };
  assert.equal(textoAtribucion(propia), "Del turno de Fulana (SICAR 52), que fue la única persona que cobró");
  assert.equal(textoAtribucion({ atribucion: "compartida", atribuida_a: null }),
    "Cobraron varias personas o hay ventas sin usuario registrado: no se atribuye a nadie");
  assert.equal(textoAtribucion({ atribucion: "sin_usuario", atribuida_a: null }),
    "Las ventas del turno no tienen usuario registrado en SICAR: no se atribuye a nadie");
  assert.equal(textoAtribucion({ atribucion: "sin_ventas", atribuida_a: null }), "SICAR no registró cobros para este turno: no se atribuye a nadie");
  assert.equal(textoAtribucion({ atribucion: "otra", atribuida_a: null }), "No se atribuye a nadie", "un valor desconocido no culpa a nadie");
  assert.equal(textoAtribucion(null), "No se atribuye a nadie");
});

test("formatoDinero: signo, miles y dos decimales", () => {
  assert.equal(formatoDinero("-0.33"), "-$0.33");
  assert.equal(formatoDinero("18242.59"), "$18,242.59");
  assert.equal(formatoDinero("-1234567.05"), "-$1,234,567.05");
  assert.equal(formatoDinero("0.00"), "$0.00");
  assert.equal(formatoDinero(undefined), "—");
});

test("nombreFormaPago y fechaHoraCorte", () => {
  assert.equal(nombreFormaPago("1"), "Efectivo");
  assert.equal(nombreFormaPago("8"), "SICAR Pagos");
  assert.equal(nombreFormaPago("99"), "Forma de pago 99");
  assert.equal(fechaHoraCorte("2026-10-23 17:53:00"), "23/10/2026 17:53");
  assert.equal(fechaHoraCorte("2026-10-23T17:53:00"), "23/10/2026 17:53");
  assert.equal(fechaHoraCorte(null), "—");
});

test("parametrosCortes: manda siempre su propia tienda, aun vacia", () => {
  const todas = parametrosCortes({ sucursal: "", desde: "2026-10-01", hasta: "2026-10-23", caja: " 2 ", persona: "" });
  assert.match(todas, /(^|&)sucursal_id=(&|$)/);
  assert.match(todas, /desde=2026-10-01/);
  assert.match(todas, /caj_id=2(&|$)/);
  assert.doesNotMatch(todas, /usu_id/);
  assert.match(parametrosCortes({ sucursal: "3", desde: "", hasta: "", caja: "", persona: "52" }), /sucursal_id=3.*usu_id=52/);
});

test("contadorDePeticiones: solo la respuesta de la ultima peticion se muestra", () => {
  const contador = contadorDePeticiones();
  const vieja = contador.nueva();
  const nueva = contador.nueva();
  assert.equal(contador.vigente(vieja), false, "la respuesta vieja que llega tarde se descarta");
  assert.equal(contador.vigente(nueva), true);
  contador.nueva();
  assert.equal(contador.vigente(nueva), false);
});
