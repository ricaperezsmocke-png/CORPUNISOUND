const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { porcentaje, semaforo, resultadoMeta, tablero } = require("./metasAvance");

const VICTOR = { id: 1, nombre: "Victor" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }, { id: 2, nombre: "Luis", sucursal_id: 4 }, { id: 3, nombre: "Eva", sucursal_id: 1 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
const BASE = { periodo: "mensual", inicio: "2026-10-01" };
const captura = (DB, meta, vendedor_id, cantidad, extra = {}) => DB.pos.meta_capturas.push({
  id: DB.pos.meta_capturas.length + 1, meta_clave: meta.clave, meta_id: meta.id, ...BASE, fecha: "2026-10-03",
  vendedor_id, sucursal_id: 4, cantidad, evidencia: null, nota: null, anulada: null, ...extra });
const JEFE_GLOBAL = { vendedor_id: null, jefatura: true, verTodas: true, sucursalId: null };

test("porcentaje topado a 100 y semáforo contra el ritmo", () => {
  assert.equal(porcentaje(6, 12), 50);
  assert.equal(porcentaje(30, 12), 100);
  assert.equal(porcentaje(1, 3), 33.3);
  assert.equal(semaforo(50, 0.5), "verde");
  assert.equal(semaforo(36, 0.5), "amarillo");
  assert.equal(semaforo(34, 0.5), "rojo");
  assert.equal(semaforo(0, 0), "verde");
});

test("las capturas anuladas no suman", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 3);
  captura(DB, meta, 2, 2, { anulada: { motivo: "x" } });
  assert.equal(resultadoMeta(DB, meta), 3);
});

test("editar la meta no pierde lo capturado con la versión anterior", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 3);
  const v2 = M.editarMeta(DB, meta.clave, { valor_meta: 6, motivo: "Ajuste" }, VICTOR);
  assert.equal(resultadoMeta(DB, v2), 3);
  assert.equal(tablero(DB, JEFE_GLOBAL, BASE, "2026-10-15").sueltas[0].porcentaje, 50);
});

test("OKR = promedio de sus metas vigentes, cada una topada a 100", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, { ...BASE, titulo: "Redes Palenque", alcance: "tienda", sucursal_id: 4 }, VICTOR);
  const a = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const b = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Reseñas", unidad: "reseñas", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const c = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Talleres", unidad: "talleres", prueba: "ninguna", valor_meta: 2 }, VICTOR);
  captura(DB, a, 1, 20); captura(DB, b, 1, 5);
  M.retirarMeta(DB, c.clave, "ya no", VICTOR);
  const t = tablero(DB, JEFE_GLOBAL, BASE, "2026-10-15");
  assert.equal(t.okrs[0].porcentaje, 75);
  assert.equal(t.okrs[0].metas.length, 2);
  assert.equal(t.sueltas.length, 0);
});

test("vendedora: ve sus metas, las de su tienda y empresa donde participa; sin desglose ni capturas ajenas", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Otra tienda", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "De Luis", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "persona", vendedor_id: 2 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa ajena", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [3] }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa mía", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [1, 3] }, VICTOR);
  captura(DB, tienda, 1, 2); captura(DB, tienda, 2, 4);
  const ana = { vendedor_id: 1, jefatura: false, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, ana, BASE, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => m.nombre), ["Videos", "Empresa mía"]);
  assert.equal(t.sueltas[0].resultado, 6);
  assert.equal(t.sueltas[0].por_persona, undefined);
  assert.deepEqual(t.sueltas[0].mis_capturas.map((c) => c.vendedor_id), [1]);
});

test("jefatura de tienda: solo su tienda, con desglose por persona; sin empresa", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Otra tienda", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [1] }, VICTOR);
  captura(DB, tienda, 1, 2); captura(DB, tienda, 2, 4);
  const gerente = { vendedor_id: null, jefatura: true, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, gerente, BASE, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => m.nombre), ["Videos"]);
  assert.deepEqual(t.sueltas[0].por_persona, [{ vendedor_id: 1, nombre: "Ana", resultado: 2 }, { vendedor_id: 2, nombre: "Luis", resultado: 4 }]);
});

test("periodo sellado: el tablero usa el resultado rectificado", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 4);
  DB.pos.meta_sellos.push({ id: 1, ...BASE, foto: { resultados: [{ clave: meta.clave, resultado: 4 }] },
    rectificaciones: [{ meta_clave: meta.clave, valor_nuevo: 5 }] });
  const t = tablero(DB, JEFE_GLOBAL, BASE, "2026-11-05");
  assert.equal(t.sellado, true);
  assert.equal(t.sueltas[0].resultado, 5);
  assert.equal(t.sueltas[0].porcentaje, 50);
});
