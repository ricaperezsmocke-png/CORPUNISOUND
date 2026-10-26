import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textoEstadoCompromiso, estadoCompromiso, textoIndicador, rangoFechaCompromiso, fechaCompromisoInicial, cuerpoCompromiso,
  cuerpoCancelar, cuerpoJuntaHecha, compromisoValido, puedeMarcarJunta, puedeEscribirJunta, queryJunta,
} from "./juntaLunes.js";

const base = { id: 1, sucursal_id: 1, lunes: "2026-10-19", texto: "Llamar a clientes", responsable: "Gerente", fecha_compromiso: "2026-10-22",
  hecho: null, cancelado: null };

test("textoEstadoCompromiso: pendiente, hecho por X el dia Y, cancelado con motivo", () => {
  assert.equal(textoEstadoCompromiso(base), "Pendiente");
  assert.equal(estadoCompromiso(base), "pendiente");
  const hecho = { ...base, hecho: { por_id: 3, por_nombre: "Ana", en: "2026-10-22T18:30:00.000Z" } };
  assert.equal(textoEstadoCompromiso(hecho), "Hecho por Ana el 22/10/2026");
  assert.equal(estadoCompromiso(hecho), "hecho");
  const sinNombre = { ...base, hecho: { por_id: 3, por_nombre: null, en: "2026-10-23T03:00:00.000Z" } };
  assert.equal(textoEstadoCompromiso(sinNombre), "Hecho el 22/10/2026");
  const cancelado = { ...base, cancelado: { por_id: 3, motivo: "Ya no aplica", en: "2026-10-21T20:00:00.000Z" } };
  assert.equal(textoEstadoCompromiso(cancelado), "Cancelado el 21/10/2026: Ya no aplica");
  assert.equal(estadoCompromiso(cancelado), "cancelado");
});

test("textoIndicador", () => {
  assert.equal(textoIndicador({ semanas: 8, con_junta: 5, pct: 63 }), "Juntas hechas: 5 de 8 semanas");
  assert.equal(textoIndicador({ semanas: 8, con_junta: 0, pct: 0 }), "Juntas hechas: 0 de 8 semanas");
  assert.equal(textoIndicador(null), "");
});

test("rango y fecha inicial del compromiso: la semana de la junta o la siguiente", () => {
  assert.deepEqual(rangoFechaCompromiso("2026-10-19"), { min: "2026-10-19", max: "2026-11-01" });
  assert.equal(fechaCompromisoInicial("2026-10-19", "2026-10-21"), "2026-10-21");
  assert.equal(fechaCompromisoInicial("2026-10-19", "2026-10-10"), "2026-10-19");
  assert.equal(fechaCompromisoInicial("2026-10-05", "2026-10-21"), "2026-10-18");
});

test("cuerpoCompromiso nunca manda tienda ni usuario", () => {
  const cuerpo = cuerpoCompromiso({ texto: " Llamar ", responsable: " Gerente ", fecha_compromiso: "2026-10-22", sucursal_id: 9, usuario_id: 4 },
    "2026-10-19");
  assert.deepEqual(cuerpo, { lunes: "2026-10-19", texto: "Llamar", responsable: "Gerente", fecha_compromiso: "2026-10-22" });
  assert.deepEqual(cuerpoCancelar(" Ya no aplica "), { motivo: "Ya no aplica" });
  assert.deepEqual(cuerpoJuntaHecha("2026-10-19"), { lunes: "2026-10-19" });
});

test("compromisoValido: texto 3-200, responsable 3-80 y fecha dentro del rango", () => {
  const ok = { texto: "Llamar", responsable: "Ana", fecha_compromiso: "2026-10-22" };
  assert.equal(compromisoValido(ok, "2026-10-19"), true);
  assert.equal(compromisoValido({ ...ok, texto: "ab" }, "2026-10-19"), false);
  assert.equal(compromisoValido({ ...ok, texto: "x".repeat(201) }, "2026-10-19"), false);
  assert.equal(compromisoValido({ ...ok, responsable: "  a " }, "2026-10-19"), false);
  assert.equal(compromisoValido({ ...ok, responsable: "x".repeat(81) }, "2026-10-19"), false);
  assert.equal(compromisoValido({ ...ok, fecha_compromiso: "2026-11-02" }, "2026-10-19"), false);
  assert.equal(compromisoValido({ ...ok, fecha_compromiso: "2026-10-18" }, "2026-10-19"), false);
  assert.equal(compromisoValido({ ...ok, fecha_compromiso: "" }, "2026-10-19"), false);
});

test("puedeMarcarJunta: pide un compromiso vigente y que no este marcada", () => {
  const hecho = { ...base, hecho: { por_id: 1, por_nombre: "A", en: "2026-10-22T18:00:00.000Z" } };
  const cancelado = { ...base, cancelado: { por_id: 1, motivo: "xxx", en: "2026-10-22T18:00:00.000Z" } };
  assert.equal(puedeMarcarJunta({ compromisos: [], junta: null }), false);
  assert.equal(puedeMarcarJunta({ compromisos: [cancelado], junta: null }), false);
  assert.equal(puedeMarcarJunta({ compromisos: [cancelado, base], junta: null }), true);
  assert.equal(puedeMarcarJunta({ compromisos: [hecho], junta: null }), true);
  assert.equal(puedeMarcarJunta({ compromisos: [base], junta: { por_id: 1 } }), false);
});

test("puedeEscribirJunta: permiso y la tienda del propio usuario (el servidor escribe en la del token)", () => {
  const permisos = ["ver_cinco_caminos", "marcar_junta_cinco_caminos"];
  assert.equal(puedeEscribirJunta(permisos, { sucursal_id: 1 }, "1"), true);
  assert.equal(puedeEscribirJunta(permisos, { sucursal_id: 1 }, "2"), false);
  assert.equal(puedeEscribirJunta(["ver_cinco_caminos"], { sucursal_id: 1 }, "1"), false);
  assert.equal(puedeEscribirJunta(permisos, null, "1"), false);
});

test("queryJunta lleva tienda y lunes explicitos", () => {
  assert.equal(queryJunta("2", "2026-10-19"), "sucursal_id=2&lunes=2026-10-19");
});
