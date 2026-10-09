const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");

const VICTOR = { id: 1, nombre: "Victor" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1 }, { id: 2, nombre: "Luis", sucursal_id: 4 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
const OKR = { titulo: "Videos Palenque", periodo: "mensual", inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 };
const META = { nombre: "Videos de tips", unidad: "videos", prueba: "liga", valor_meta: 12,
  periodo: "mensual", inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 };

test("crear meta suelta de tienda con auditoría", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, META, VICTOR);
  assert.equal(meta.clave, meta.id);
  assert.equal(meta.version, 1);
  assert.equal(meta.vigente, true);
  assert.equal(meta.vendedor_id, null);
  assert.deepEqual(meta.participantes, []);
  assert.equal(meta.creado_por_id, 1);
  assert.equal(meta.creado_por, "Victor");
});

test("validaciones de la meta", () => {
  const DB = DBPrueba();
  assert.throws(() => M.crearMeta(DB, { ...META, nombre: "  " }, VICTOR), /nombre/);
  assert.throws(() => M.crearMeta(DB, { ...META, prueba: "video" }, VICTOR), /prueba/);
  assert.throws(() => M.crearMeta(DB, { ...META, valor_meta: 0 }, VICTOR), /cifra/);
  assert.throws(() => M.crearMeta(DB, { ...META, valor_meta: 2.5 }, VICTOR), /cifra/);
  assert.throws(() => M.crearMeta(DB, { ...META, sucursal_id: 99 }, VICTOR), /tienda/);
  assert.throws(() => M.crearMeta(DB, { ...META, inicio: "2026-10-02" }, VICTOR), /día 1/);
  assert.throws(() => M.crearMeta(DB, { ...META, alcance: "persona", vendedor_id: 99 }, VICTOR), /persona/);
  assert.throws(() => M.crearMeta(DB, { ...META, alcance: "empresa", participantes: [] }, VICTOR), /participantes/);
});

test("persona toma la tienda del vendedor; empresa no tiene tienda", () => {
  const DB = DBPrueba();
  const persona = M.crearMeta(DB, { ...META, alcance: "persona", vendedor_id: 2, sucursal_id: 1 }, VICTOR);
  assert.equal(persona.sucursal_id, 4);
  const empresa = M.crearMeta(DB, { ...META, alcance: "empresa", participantes: [2, 1, 2] }, VICTOR);
  assert.equal(empresa.sucursal_id, null);
  assert.deepEqual(empresa.participantes, [1, 2]);
});

test("la meta de un OKR hereda su periodo y alcance", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, OKR, VICTOR);
  const meta = M.crearMeta(DB, { nombre: "Reseñas", unidad: "reseñas", prueba: "liga", valor_meta: 30, okr_clave: okr.clave }, VICTOR);
  assert.equal(meta.okr_clave, okr.clave);
  assert.equal(meta.periodo, "mensual");
  assert.equal(meta.sucursal_id, 4);
  assert.throws(() => M.crearMeta(DB, { ...META, okr_clave: 999 }, VICTOR), /OKR/);
});

test("editar crea versión nueva con motivo y conserva la clave", () => {
  const DB = DBPrueba();
  const v1 = M.crearMeta(DB, META, VICTOR);
  assert.throws(() => M.editarMeta(DB, v1.clave, { valor_meta: 15 }, VICTOR), /motivo/);
  const v2 = M.editarMeta(DB, v1.clave, { valor_meta: 15, motivo: "Más tiendas" }, VICTOR);
  assert.equal(v2.clave, v1.clave);
  assert.equal(v2.version, 2);
  assert.equal(v2.reemplaza_a, v1.id);
  assert.equal(v2.valor_meta, 15);
  assert.equal(v2.nombre, "Videos de tips");
  assert.equal(M.metaVigente(DB, v1.clave).id, v2.id);
  assert.deepEqual(M.historial(DB, "metas_personalizadas", v1.clave).map((m) => m.version), [1, 2]);
  assert.throws(() => M.editarMeta(DB, v1.clave, { periodo: "semanal", motivo: "x" }, VICTOR), /no se pueden cambiar/);
});

test("retirar meta y retirar OKR con sus metas", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, OKR, VICTOR);
  const meta = M.crearMeta(DB, { nombre: "Videos", unidad: "videos", prueba: "liga", valor_meta: 12, okr_clave: okr.clave }, VICTOR);
  assert.throws(() => M.retirarOkr(DB, okr.clave, " ", VICTOR), /motivo/);
  M.retirarOkr(DB, okr.clave, "Cambio de plan", VICTOR);
  assert.equal(M.okrVigente(DB, okr.clave), null);
  assert.equal(M.metaVigente(DB, meta.clave), null);
  const retirada = DB.pos.metas_personalizadas.find((m) => m.id === meta.id);
  assert.equal(retirada.retirada.motivo, "Cambio de plan");
  assert.equal(DB.pos.metas_personalizadas.length, 1);
  assert.throws(() => M.retirarMeta(DB, meta.clave, "otra", VICTOR), /no existe o fue eliminada/);
});

test("editar OKR solo cambia título y descripción", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, OKR, VICTOR);
  const v2 = M.editarOkr(DB, okr.clave, { titulo: "Redes Palenque", motivo: "Más claro" }, VICTOR);
  assert.equal(v2.titulo, "Redes Palenque");
  assert.equal(v2.version, 2);
  assert.throws(() => M.editarOkr(DB, okr.clave, { alcance: "empresa", motivo: "x" }, VICTOR), /no se puede cambiar periodo ni alcance/);
});

test("periodo sellado: no se crea, edita ni retira", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, META, VICTOR);
  DB.pos.meta_sellos.push({ id: 1, periodo: "mensual", inicio: "2026-10-01" });
  assert.equal(M.periodoSellado(DB, "mensual", "2026-10-01"), true);
  assert.throws(() => M.crearMeta(DB, META, VICTOR), /sellado/);
  assert.throws(() => M.editarMeta(DB, meta.clave, { valor_meta: 3, motivo: "x" }, VICTOR), /sellado/);
  assert.throws(() => M.retirarMeta(DB, meta.clave, "x", VICTOR), /sellado/);
});
