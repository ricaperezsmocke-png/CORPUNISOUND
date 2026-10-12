const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarPlan, descartarPlan, listarPlanes } = require("./planIACrear");

const VICTOR = { id: 70, nombre: "Victor" };
const PROPUESTA = { okr: { titulo: "Más acústicas", descripcion: null }, metas: [
  { indice: 0, accion: "actividad:grupos", nombre: "Publicar", unidad: "publicaciones", prueba: "liga", valor_meta: 4 },
  { indice: 1, accion: "actividad:iglesia", nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1 },
  { indice: 2, accion: "nueva", nombre: "Clínica", unidad: "clínica", prueba: "foto", valor_meta: 1 }] };
function dbConPlan(sucursal_id = 1) {
  return { admin: { usuarios: [] }, pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }], vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1 }, { id: 2, nombre: "Bea", sucursal_id: 1, activo: false }],
    okrs: [], metas_personalizadas: [], meta_sellos: [],
    planes_ia: [{ id: 1, estado: "borrador", entrada: { sucursal_id, periodo: "mensual", inicio: "2026-11-01" }, propuesta: PROPUESTA,
      decisiones: [], validado_por_id: null, validado_por_nombre: null, validado_en: null, creados: null }],
  } };
}
const todo = (decision) => ({ okr: { decision }, metas: [0, 1, 2].map((indice) => ({ indice, decision })) });

test("crea exactamente lo aceptado, con cambios y origen, y deja el plan validado", () => {
  const DB = dbConPlan();
  const cuerpo = { okr: { decision: "aceptar", cambios: { titulo: "Más guitarras" } }, metas: [
    { indice: 0, decision: "aceptar", cambios: { valor_meta: 6 } }, { indice: 1, decision: "rechazar" }, { indice: 2, decision: "aceptar" }] };
  const plan = validarPlan(DB, 1, cuerpo, VICTOR);
  assert.equal(plan.estado, "validado");
  assert.equal(plan.validado_por_nombre, "Victor");
  assert.equal(DB.pos.okrs.length, 1);
  assert.equal(DB.pos.okrs[0].titulo, "Más guitarras");
  assert.deepEqual(DB.pos.metas_personalizadas.map((m) => [m.nombre, m.valor_meta, m.okr_clave]), [["Publicar", 6, 1], ["Clínica", 1, 1]]);
  assert.equal(DB.pos.metas_personalizadas[0].origen.tipo, "plan_ia");
  assert.equal(DB.pos.metas_personalizadas[0].origen.plan_id, 1);
  assert.deepEqual(plan.creados, { okr_clave: 1, metas_claves: [1, 2] });
  assert.deepEqual(plan.decisiones.find((d) => d.punto === 0).cambios, { valor_meta: [4, 6] });
});

test("falta decidir un punto, sobra uno, decision rara o nada aceptado: 400 y nada creado", () => {
  const casos = [
    { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar" }, { indice: 1, decision: "aceptar" }] },
    { okr: { decision: "aceptar" }, metas: [0, 1, 2, 3].map((indice) => ({ indice, decision: "aceptar" })) },
    { okr: { decision: "aceptar" }, metas: [0, 0, 2].map((indice) => ({ indice, decision: "aceptar" })) },
    { okr: { decision: "quizas" }, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) },
    { okr: {}, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) },
    todo("rechazar"),
    { okr: { decision: "aceptar", cambios: { alcance: "empresa" } }, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) },
  ];
  for (const cuerpo of casos) {
    const DB = dbConPlan();
    assert.throws(() => validarPlan(DB, 1, cuerpo, VICTOR));
    assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0, JSON.stringify(cuerpo));
    assert.equal(DB.pos.planes_ia[0].estado, "borrador");
  }
});

test("todo o nada: si una meta no se puede crear, no queda ningun OKR ni meta", () => {
  const DB = dbConPlan();
  const cuerpo = { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar" }, { indice: 1, decision: "aceptar" },
    { indice: 2, decision: "aceptar", cambios: { valor_meta: 0 } }] };
  assert.throws(() => validarPlan(DB, 1, cuerpo, VICTOR), /cifra/);
  assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0);
  DB.pos.meta_sellos.push({ periodo: "mensual", inicio: "2026-11-01" });
  assert.throws(() => validarPlan(DB, 1, todo("aceptar"), VICTOR), /sellado/);
  assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0);
});

test("segunda validacion del mismo plan: 400 y sin duplicados", () => {
  const DB = dbConPlan();
  validarPlan(DB, 1, todo("aceptar"), VICTOR);
  assert.throws(() => validarPlan(DB, 1, todo("aceptar"), VICTOR), /ya no está en borrador/);
  assert.equal(DB.pos.metas_personalizadas.length, 3);
});

test("un indice nulo, vacio o booleano no cuenta como decision de la primera meta", () => {
  for (const indice of [null, "", "  ", false, []]) {
    const DB = dbConPlan();
    const cuerpo = todo("aceptar");
    cuerpo.metas[0].indice = indice;
    assert.throws(() => validarPlan(DB, 1, cuerpo, VICTOR), /decisiones/);
    assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0);
  }
});

test("meta cambiada a persona se crea suelta; OKR rechazado deja las metas sueltas", () => {
  const DB = dbConPlan();
  validarPlan(DB, 1, { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar", alcance: "persona", vendedor_id: 1 },
    { indice: 1, decision: "aceptar" }, { indice: 2, decision: "rechazar" }] }, VICTOR);
  const [persona, tienda] = DB.pos.metas_personalizadas;
  assert.deepEqual([persona.okr_clave, persona.alcance, persona.vendedor_id], [null, "persona", 1]);
  assert.equal(tienda.okr_clave, 1);
  const otro = dbConPlan();
  validarPlan(otro, 1, { okr: { decision: "rechazar" }, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) }, VICTOR);
  assert.equal(otro.pos.okrs.length, 0);
  assert.ok(otro.pos.metas_personalizadas.every((m) => m.okr_clave === null && m.alcance === "tienda" && m.sucursal_id === 1));
});

test("toda la empresa: participantes son las personas activas; sin activas, error claro", () => {
  const DB = dbConPlan(null);
  validarPlan(DB, 1, todo("aceptar"), VICTOR);
  assert.deepEqual(DB.pos.okrs[0].participantes, [1]);
  const vacio = dbConPlan(null);
  vacio.pos.vendedores.forEach((v) => { v.activo = false; });
  assert.throws(() => validarPlan(vacio, 1, todo("aceptar"), VICTOR), /participantes/);
});

test("descartar no crea nada; listar trae lo mas reciente primero", () => {
  const DB = dbConPlan();
  assert.equal(descartarPlan(DB, 1, VICTOR).estado, "descartado");
  assert.throws(() => validarPlan(DB, 1, todo("aceptar"), VICTOR), /ya no está en borrador/);
  assert.throws(() => descartarPlan(DB, 99, VICTOR), /no existe/);
  DB.pos.planes_ia.push({ id: 2, estado: "fallido" });
  assert.deepEqual(listarPlanes(DB).map((p) => p.id), [2, 1]);
});
