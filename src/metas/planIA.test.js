import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoInicial, faltanPorDecidir, puedeCrear, cuerpoValidacion, resumenConfirmacion } from "./planIA.js";

const PLAN = { id: 4, entrada: { periodo: "mensual", inicio: "2026-11-01" }, propuesta: {
  okr: { titulo: "Más acústicas", descripcion: null },
  metas: [{ indice: 0, nombre: "Publicar", unidad: "pub", prueba: "liga", valor_meta: 4 },
    { indice: 1, nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1 }] } };

test("nada viene decidido al empezar", () => {
  const e = estadoInicial(PLAN);
  assert.equal(e.okr.decision, null);
  assert.ok(e.metas.every((m) => m.decision === null));
  assert.equal(faltanPorDecidir(e), 3);
  assert.equal(puedeCrear(e), false);
});

test("puedeCrear exige decidir todo, aceptar algo y elegir persona si se cambio a persona", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "rechazar"; e.metas[0].decision = "rechazar";
  assert.equal(puedeCrear(e), false); // falta la meta 1
  e.metas[1].decision = "rechazar";
  assert.equal(puedeCrear(e), false); // nada aceptado
  e.metas[1].decision = "aceptar"; e.metas[1].alcance = "persona";
  assert.equal(puedeCrear(e), false); // sin persona
  e.metas[1].vendedor_id = "3";
  assert.equal(puedeCrear(e), true);
});

test("cuerpoValidacion manda solo lo que cambio y la persona como numero", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "aceptar"; e.okr.form.titulo = "Más guitarras";
  e.metas[0].decision = "aceptar"; e.metas[0].form.valor_meta = "6";
  e.metas[1].decision = "aceptar"; e.metas[1].alcance = "persona"; e.metas[1].vendedor_id = "3";
  assert.deepEqual(cuerpoValidacion(PLAN, e), {
    okr: { decision: "aceptar", cambios: { titulo: "Más guitarras" } },
    metas: [{ indice: 0, decision: "aceptar", cambios: { valor_meta: 6 }, alcance: "base" },
      { indice: 1, decision: "aceptar", cambios: {}, alcance: "persona", vendedor_id: 3 }],
  });
});

test("resumenConfirmacion cuenta lo aceptado", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "aceptar"; e.metas[0].decision = "aceptar"; e.metas[1].decision = "rechazar";
  assert.equal(resumenConfirmacion(PLAN, e, "Ocosingo"), "Vas a crear 1 OKR y 1 meta para Ocosingo, Noviembre de 2026");
  e.okr.decision = "rechazar"; e.metas[1].decision = "aceptar";
  assert.equal(resumenConfirmacion(PLAN, e, "toda la empresa"), "Vas a crear 2 metas para toda la empresa, Noviembre de 2026");
});
