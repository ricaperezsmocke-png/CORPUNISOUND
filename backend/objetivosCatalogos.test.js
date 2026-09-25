const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  listarElementos, altaElemento, desactivarElemento, elementoActivo,
} = require("./objetivosCatalogos");

const USUARIO = { id: 7, nombre: "María" };
const ADMINISTRADOR = { id: 9, nombre: "Víctor" };
const LISTAS = [
  { lista: "marcas", coleccion: "objetivo_marcas" },
  { lista: "productos", coleccion: "objetivo_productos" },
];

function prepararDB() {
  return { pos: { objetivo_marcas: [], objetivo_productos: [] } };
}

for (const { lista, coleccion } of LISTAS) {
  test(`${lista}: alta recorta el nombre y guarda autor y fecha UTC`, () => {
    const DB = prepararDB();
    const inicio = Date.now();
    const elemento = altaElemento(DB, lista, {
      nombre: "  Guitarras eléctricas  ", creado_por: "Suplantado", activo: false,
    }, USUARIO);
    assert.deepEqual(elemento, {
      id: 1, nombre: "Guitarras eléctricas", activo: true,
      creado_por: "María", creado_en: elemento.creado_en,
      desactivado_por: null, desactivado_en: null, motivo_desactivacion: null,
    });
    assert.equal(new Date(elemento.creado_en).toISOString(), elemento.creado_en);
    assert.ok(Date.parse(elemento.creado_en) >= inicio && Date.parse(elemento.creado_en) <= Date.now());
    assert.deepEqual(DB.pos[coleccion], [elemento]);
    assert.deepEqual(listarElementos(DB, lista), [elemento]);
  });

  for (const nombre of ["YAMAHA", " yamaha ", "Yámahá", "Ya\u0301maha"]) {
    test(`${lista}: rechaza duplicado ${JSON.stringify(nombre)} sin modificar DB`, () => {
      const DB = prepararDB();
      altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO);
      const antes = structuredClone(DB);
      assert.throws(() => altaElemento(DB, lista, { nombre }, USUARIO), /activo|existe|duplicado/i);
      assert.deepEqual(DB, antes);
    });
  }

  test(`${lista}: colapsa espacios al comparar nombres activos`, () => {
    const DB = prepararDB();
    altaElemento(DB, lista, { nombre: "Guitarras   eléctricas" }, USUARIO);
    const antes = structuredClone(DB);
    assert.throws(() => altaElemento(DB, lista, { nombre: " GUITARRAS\t ELECTRICAS " }, USUARIO), /activo|existe|duplicado/i);
    assert.deepEqual(DB, antes);
  });

  test(`${lista}: rechaza nombres vacíos, de 61 caracteres o que no sean texto`, () => {
    for (const nombre of ["", " \t\n ", "x".repeat(61), null, undefined, 123, {}, []]) {
      const DB = prepararDB();
      const antes = structuredClone(DB);
      assert.throws(() => altaElemento(DB, lista, { nombre }, USUARIO), /nombre/i);
      assert.deepEqual(DB, antes);
    }
  });

  test(`${lista}: acepta los límites de 1 y 60 caracteres después de recortar`, () => {
    const DB = prepararDB();
    assert.equal(altaElemento(DB, lista, { nombre: " A " }, USUARIO).nombre, "A");
    assert.equal(altaElemento(DB, lista, { nombre: ` ${"á".repeat(60)} ` }, USUARIO).nombre, "á".repeat(60));
  });

  test(`${lista}: desactivar exige motivo de texto y no modifica DB si falta`, () => {
    const DB = prepararDB();
    const elemento = altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO);
    const antes = structuredClone(DB);
    for (const motivo of [undefined, null, "", " \t ", 123, {}]) {
      assert.throws(() => desactivarElemento(DB, lista, elemento.id, { motivo }, ADMINISTRADOR), /motivo/i);
      assert.deepEqual(DB, antes);
    }
  });

  test(`${lista}: desactiva con id de texto y conserva nombre e historial`, () => {
    const DB = prepararDB();
    const elemento = altaElemento(DB, lista, { nombre: "Guitarras eléctricas" }, USUARIO);
    const original = structuredClone(elemento);
    const inicio = Date.now();
    const inactivo = desactivarElemento(DB, lista, String(elemento.id), {
      motivo: "  Se capturó por error  ", desactivado_por: "Suplantado",
    }, ADMINISTRADOR);
    assert.deepEqual(inactivo, {
      ...original, activo: false, desactivado_por: "Víctor",
      desactivado_en: inactivo.desactivado_en, motivo_desactivacion: "Se capturó por error",
    });
    assert.equal(new Date(inactivo.desactivado_en).toISOString(), inactivo.desactivado_en);
    assert.ok(Date.parse(inactivo.desactivado_en) >= inicio && Date.parse(inactivo.desactivado_en) <= Date.now());
    assert.deepEqual(DB.pos[coleccion], [inactivo]);
    assert.deepEqual(listarElementos(DB, lista), []);
    assert.deepEqual(listarElementos(DB, lista, { incluirInactivos: true }), [inactivo]);
    assert.equal(elementoActivo(DB, lista, elemento.id), null);
  });

  test(`${lista}: no se puede desactivar dos veces ni alterar la primera justificación`, () => {
    const DB = prepararDB();
    const elemento = altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO);
    desactivarElemento(DB, lista, elemento.id, { motivo: "Error" }, ADMINISTRADOR);
    const antes = structuredClone(DB);
    assert.throws(() => desactivarElemento(DB, lista, elemento.id, { motivo: "Otro" }, USUARIO), /desactivado|inactivo/i);
    assert.deepEqual(DB, antes);
  });

  test(`${lista}: un nombre desactivado admite otra alta sin reutilizar su id`, () => {
    const DB = prepararDB();
    const primero = altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO);
    desactivarElemento(DB, lista, primero.id, { motivo: "Error" }, ADMINISTRADOR);
    const historico = structuredClone(primero);
    const nuevo = altaElemento(DB, lista, { nombre: "YAMAHA" }, USUARIO);
    assert.equal(nuevo.id, 2);
    assert.deepEqual(DB.pos[coleccion], [historico, nuevo]);
    assert.deepEqual(listarElementos(DB, lista), [nuevo]);
    assert.deepEqual(listarElementos(DB, lista, { incluirInactivos: true }), [historico, nuevo]);
  });

  test(`${lista}: consulta activos por id numérico o texto sin modificar DB`, () => {
    const DB = prepararDB();
    const elemento = altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO);
    const antes = structuredClone(DB);
    assert.deepEqual(elementoActivo(DB, lista, elemento.id), elemento);
    assert.deepEqual(elementoActivo(DB, lista, String(elemento.id)), elemento);
    for (const id of [999, null, undefined, "", "inválido"]) {
      assert.equal(elementoActivo(DB, lista, id), null);
    }
    listarElementos(DB, lista);
    listarElementos(DB, lista, { incluirInactivos: true });
    assert.deepEqual(DB, antes);
  });

  test(`${lista}: desactivar un id inexistente rechaza sin modificar DB`, () => {
    const DB = prepararDB();
    const antes = structuredClone(DB);
    assert.throws(() => desactivarElemento(DB, lista, "999", { motivo: "Error" }, USUARIO), /no existe/i);
    assert.deepEqual(DB, antes);
  });

  test(`${lista}: base antigua sin listas se lee sin mutar y admite altas sin alterar metas viejas`, () => {
    const DB = { pos: { objetivos: [{
      id: 8, tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 500, vigente: true,
    }] } };
    const antes = structuredClone(DB);
    assert.deepEqual(listarElementos(DB, lista), []);
    assert.deepEqual(listarElementos(DB, lista, { incluirInactivos: true }), []);
    assert.equal(elementoActivo(DB, lista, "1"), null);
    assert.deepEqual(DB, antes);
    const nuevo = altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO);
    assert.deepEqual(DB, { pos: { ...antes.pos, [coleccion]: [nuevo] } });
  });
}

test("las listas son independientes entre sí y del catálogo de productos del POS", () => {
  const DB = prepararDB();
  DB.pos.productos = [{ id: 40, nombre: "Yamaha", marca: "Yamaha" }];
  const marca = altaElemento(DB, "marcas", { nombre: "Yamaha" }, USUARIO);
  const producto = altaElemento(DB, "productos", { nombre: "Yamaha" }, USUARIO);
  desactivarElemento(DB, "marcas", marca.id, { motivo: "Error" }, ADMINISTRADOR);
  assert.deepEqual(listarElementos(DB, "productos"), [producto]);
  assert.equal(elementoActivo(DB, "marcas", marca.id), null);
  assert.deepEqual(DB.pos.productos, [{ id: 40, nombre: "Yamaha", marca: "Yamaha" }]);
});

test("todas las operaciones rechazan listas distintas de marcas o productos sin mutar DB", () => {
  const DB = prepararDB();
  const antes = structuredClone(DB);
  for (const lista of ["", "marca", "Marcas", "objetivo_marcas", "toString", "__proto__", null, undefined, {}]) {
    assert.throws(() => listarElementos(DB, lista), /lista/i);
    assert.throws(() => altaElemento(DB, lista, { nombre: "Yamaha" }, USUARIO), /lista/i);
    assert.throws(() => desactivarElemento(DB, lista, 1, { motivo: "Error" }, USUARIO), /lista/i);
    assert.throws(() => elementoActivo(DB, lista, 1), /lista/i);
    assert.deepEqual(DB, antes);
  }
});
