import { test } from "node:test";
import assert from "node:assert/strict";
import { pestanasSupervision, estadoVisita } from "./pestanasSupervision.js";

test("cada permiso abre su pestana", () => {
  assert.deepEqual(pestanasSupervision(["atender_fallas_visita"]).map((p) => p.clave), ["pendientes"]);
  assert.deepEqual(pestanasSupervision(["realizar_visitas_tienda", "ver_supervision"]).map((p) => p.clave), ["visita", "resumen"]);
  assert.deepEqual(pestanasSupervision(["administrar_checklist_visitas"]).map((p) => p.clave), ["checklist"]);
  assert.deepEqual(pestanasSupervision([]), []);
});

test("estado de la visita del mes por tienda", () => {
  const v = (sucursal_id, estado, comprobada) => ({ sucursal_id, estado, ubicacion: { comprobada } });
  assert.equal(estadoVisita([v(1, "terminada", true)], 1), "hecha");
  assert.equal(estadoVisita([v(1, "terminada", false)], 1), "no_comprobada");
  assert.equal(estadoVisita([v(1, "en_curso", true)], 1), "en_curso");
  assert.equal(estadoVisita([v(2, "terminada", true)], 1), "falta");
});
