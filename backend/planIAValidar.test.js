const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarPropuesta, TEXTO_POR_QUE } = require("./planIAValidar");

const CONTEXTO = {
  periodo: "mensual",
  catalogo: [
    { accion: "actividad:grupos", nombre: "Publicación en grupos", unidad: "publicación", prueba: "liga" },
    { accion: "actividad:iglesia", nombre: "Salida a iglesia", unidad: "salida", prueba: "foto" },
    { accion: "actividad:volanteo", nombre: "Jornada de volanteo", unidad: "jornada", prueba: "foto" },
  ],
  maximos: { "actividad:grupos": 10, "actividad:iglesia": 2, "actividad:volanteo": 0 },
  cifrasPermitidas: [10, 2, 1500],
};
const meta = (extra = {}) => ({ accion: "actividad:grupos", nombre: "Publicar en grupos", unidad: "publicaciones", prueba: "liga",
  valor_meta: 12, por_que: "El mejor mes tuvo 10 publicaciones", ...extra });
const propuesta = (metas) => ({ okr: { titulo: "Vender más acústicas", descripcion: "Mover el inventario" }, metas });
const falla = (p, texto) => assert.throws(() => validarPropuesta(p, CONTEXTO), (e) => e.planInvalido && e.message.includes(texto));

test("propuesta correcta pasa y conserva indices", () => {
  const r = validarPropuesta(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 3, prueba: "foto", por_que: "" }),
    meta({ accion: "nueva", nombre: "Clínica de guitarra", valor_meta: 1, prueba: "foto", por_que: "Idea" })]), CONTEXTO);
  assert.equal(r.okr.titulo, "Vender más acústicas");
  assert.deepEqual(r.metas.map((m) => m.indice), [0, 1, 2]);
  assert.equal(r.metas[0].por_que, "El mejor mes tuvo 10 publicaciones");
  assert.equal(r.metas[1].por_que, TEXTO_POR_QUE); // vacío
  assert.equal(r.metas[2].nueva, true);
  assert.equal(r.metas[2].sin_historico, true);
});

test("cantidad de metas: menos de 3 o mas de 6 se rechaza", () => {
  falla(propuesta([meta(), meta()]), "de 3 a 6");
  falla(propuesta(Array.from({ length: 7 }, () => meta())), "de 3 a 6");
});

test("mas de 2 ideas nuevas se rechaza", () => {
  const nueva = meta({ accion: "nueva" });
  falla(propuesta([nueva, nueva, nueva]), "más de 2 ideas nuevas");
});

test("accion fuera del catalogo se rechaza", () => falla(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ accion: "actividad:tiktok" })]), "fuera del catálogo"));

test("prueba, cifra y textos invalidos se rechazan", () => {
  falla(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ prueba: "video" })]), "prueba");
  falla(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ valor_meta: 2.5 })]), "cifra");
  falla(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ valor_meta: 0 })]), "cifra");
  falla(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ nombre: "" })]), "nombre");
  falla({ okr: { titulo: "x".repeat(121) }, metas: [meta(), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta()] }, "OKR");
  falla(null, "sin contenido");
});

test("topes ajustan la cifra y conservan la propuesta original", () => {
  const contexto = { ...CONTEXTO, maximos: { "actividad:grupos": 4 } };
  const r = validarPropuesta(propuesta([meta({ valor_meta: 40 }),
    meta({ accion: "actividad:volanteo", valor_meta: 5000000, por_que: "" }),
    meta({ accion: "nueva", valor_meta: 5000000 })]), contexto);
  assert.equal(r.metas[0].valor_meta, 12);
  assert.equal(r.metas[0].ajustada, true);
  assert.equal(r.metas[0].propuesta_ia, 40);
  assert.equal(r.metas[1].valor_meta, 1000000);
  assert.equal(r.metas[2].valor_meta, 1000000);
  assert.equal(r.metas[1].por_que, "Propuesta sin datos históricos de la tienda");
});

test("unidad y prueba del catálogo; acciones repetidas se rechazan", () => {
  const r = validarPropuesta(propuesta([meta({ unidad: "conciertos", prueba: "ninguna" }),
    meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ accion: "nueva" })]), CONTEXTO);
  assert.equal(r.metas[0].unidad, "publicación");
  assert.equal(r.metas[0].prueba, "liga");
  falla(propuesta([meta(), meta(), meta({ accion: "nueva" })]), "repetida");
});

test("por que con un numero inventado se sustituye por el texto del sistema", () => {
  const r = validarPropuesta(propuesta([meta({ por_que: "Las tiendas similares hacen 45 por mes" }), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ accion: "nueva" })]), CONTEXTO);
  assert.equal(r.metas[0].por_que, TEXTO_POR_QUE);
  const ok = validarPropuesta(propuesta([meta({ por_que: "Vendiste $1,500 y propongo 12" }), meta({ accion: "actividad:iglesia", valor_meta: 1 }), meta({ accion: "nueva" })]), CONTEXTO);
  assert.equal(ok.metas[0].por_que, TEXTO_POR_QUE); // 12 no estaba en los datos enviados
});
