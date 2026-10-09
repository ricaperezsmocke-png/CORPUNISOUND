const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { previoSello, sellarPeriodo, rectificarSello } = require("./metasSellos");

const VICTOR = { id: 1, nombre: "Victor" };
const BASE = { periodo: "semanal", inicio: "2026-10-05" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 4, nombre: "Palenque" }], vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
function conMeta() {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 4, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  DB.pos.meta_capturas.push({ id: 1, meta_clave: meta.clave, meta_id: meta.id, ...BASE, fecha: "2026-10-06", vendedor_id: 1,
    sucursal_id: 4, cantidad: 3, evidencia: null, nota: null, anulada: null });
  return { DB, meta };
}

test("no se sella un periodo que no ha terminado", () => {
  const { DB } = conMeta();
  assert.throws(() => previoSello(DB, BASE, "2026-10-11"), /todavía no termina/);
  assert.equal(previoSello(DB, BASE, "2026-10-12").resultados[0].resultado, 3);
});

test("sellar congela una copia, guarda las eliminadas y no se sella dos veces", () => {
  const { DB, meta } = conMeta();
  const quitada = M.crearMeta(DB, { ...BASE, nombre: "Reseñas", unidad: "reseñas", prueba: "liga", valor_meta: 9, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.retirarMeta(DB, quitada.clave, "No aplica en Palenque", { id: 5, nombre: "Gerente" });
  const sello = sellarPeriodo(DB, BASE, VICTOR, "2026-10-12");
  assert.equal(sello.sellado_por, "Victor");
  assert.equal(sello.foto.resultados[0].resultado, 3);
  assert.deepEqual(sello.foto.retiradas.map((r) => [r.nombre, r.retirada.por_nombre, r.retirada.motivo]),
    [["Reseñas", "Gerente", "No aplica en Palenque"]]);
  DB.pos.meta_capturas[0].cantidad = 99;
  assert.equal(sello.foto.capturas[0].cantidad, 3);
  assert.throws(() => sellarPeriodo(DB, BASE, VICTOR, "2026-10-12"), /ya está sellado/);
  assert.equal(M.periodoSellado(DB, BASE.periodo, BASE.inicio), true);
  assert.ok(meta);
});

test("rectificar cambia el resultado con motivo, conserva el sellado y lee el valor anterior", () => {
  const { DB, meta } = conMeta();
  const sello = sellarPeriodo(DB, BASE, VICTOR, "2026-10-12");
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: 4, motivo: " " }, VICTOR), /motivo/);
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: -1, motivo: "x" }, VICTOR), /entero/);
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: 999, valor_nuevo: 1, motivo: "x" }, VICTOR), /no está en este sello/);
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: meta.clave, campo: "valor_meta", valor_nuevo: 1, motivo: "x" }, VICTOR),
    /cifra meta/);
  const r1 = rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: 4, motivo: "Faltó un video" }, VICTOR);
  assert.equal(r1.valor_anterior, 3);
  const r2 = rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: 2, motivo: "Uno era repetido" }, VICTOR);
  assert.equal(r2.valor_anterior, 4);
  assert.equal(sello.foto.resultados[0].resultado, 3);
});

test("no se sella un periodo sin metas: impediría crearle metas después", () => {
  const DB = DBPrueba();
  assert.throws(() => sellarPeriodo(DB, BASE, VICTOR, "2026-10-12"), /no hay metas/i);
  assert.equal(DB.pos.meta_sellos.length, 0);
});
