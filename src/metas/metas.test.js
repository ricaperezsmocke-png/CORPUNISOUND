import { test } from "node:test";
import assert from "node:assert/strict";
import { inicioDePeriodo, finDePeriodo, moverPeriodo, etiquetaPeriodo, periodoTerminado, cuerpoMeta, cuerpoCaptura } from "./metas.js";

test("periodos iguales a los del servidor", () => {
  assert.equal(inicioDePeriodo("semanal", "2026-10-11"), "2026-10-05");
  assert.equal(finDePeriodo("semanal", "2026-10-05"), "2026-10-11");
  assert.equal(inicioDePeriodo("mensual", "2026-10-15"), "2026-10-01");
  assert.equal(finDePeriodo("mensual", "2028-02-01"), "2028-02-29");
  assert.equal(inicioDePeriodo("trimestral", "2026-08-15"), "2026-07-01");
  assert.equal(finDePeriodo("trimestral", "2026-10-01"), "2026-12-31");
});

test("mover periodos hacia atrás y adelante, cruzando el año", () => {
  assert.equal(moverPeriodo("semanal", "2026-10-05", -1), "2026-09-28");
  assert.equal(moverPeriodo("mensual", "2026-12-01", 1), "2027-01-01");
  assert.equal(moverPeriodo("trimestral", "2026-01-01", -1), "2025-10-01");
});

test("etiquetas legibles", () => {
  assert.equal(etiquetaPeriodo("semanal", "2026-10-05"), "Semana del 5 al 11 de octubre de 2026");
  assert.equal(etiquetaPeriodo("semanal", "2026-09-28"), "Semana del 28 de septiembre al 4 de octubre de 2026");
  assert.equal(etiquetaPeriodo("mensual", "2026-10-01"), "Octubre de 2026");
  assert.equal(etiquetaPeriodo("trimestral", "2026-10-01"), "Trimestre octubre–diciembre de 2026");
});

test("un periodo termina el día después de su fin", () => {
  assert.equal(periodoTerminado("semanal", "2026-10-05", "2026-10-11"), false);
  assert.equal(periodoTerminado("semanal", "2026-10-05", "2026-10-12"), true);
});

test("cuerpo de la meta según alcance", () => {
  const base = { nombre: " Videos ", unidad: "videos", prueba: "liga", valor_meta: "12", periodo: "mensual", inicio: "2026-10-01" };
  assert.deepEqual(cuerpoMeta({ ...base, alcance: "tienda", sucursal_id: "4", okr_clave: "" }),
    { nombre: " Videos ", descripcion: undefined, unidad: "videos", prueba: "liga", valor_meta: 12, periodo: "mensual",
      inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 });
  assert.deepEqual(cuerpoMeta({ ...base, alcance: "persona", vendedor_id: "2" }).vendedor_id, 2);
  assert.deepEqual(cuerpoMeta({ ...base, alcance: "empresa", participantes: ["3", "1"] }).participantes, [3, 1]);
  assert.deepEqual(cuerpoMeta({ ...base, okr_clave: "7" }), { nombre: " Videos ", descripcion: undefined, unidad: "videos",
    prueba: "liga", valor_meta: 12, okr_clave: 7 });
});

test("cuerpo de la captura según la prueba de la meta", () => {
  const archivo = { nombre_archivo: "a.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" };
  assert.deepEqual(cuerpoCaptura({ prueba: "liga" }, { fecha: "2026-10-08", link: "https://x.com/1", nota: "  " }),
    { fecha: "2026-10-08", link: "https://x.com/1" });
  assert.deepEqual(cuerpoCaptura({ prueba: "foto" }, { fecha: "2026-10-08", archivo, nota: "Tienda" }),
    { fecha: "2026-10-08", archivo, nota: "Tienda" });
  assert.deepEqual(cuerpoCaptura({ prueba: "ninguna" }, { fecha: "2026-10-08", cantidad: "5" }), { fecha: "2026-10-08", cantidad: 5 });
});
