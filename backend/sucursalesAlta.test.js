const { test } = require("node:test");
const assert = require("node:assert/strict");
const { crearSucursal } = require("./sucursales");
const { fechaLocal } = require("./fechas");

function prepararDB() {
  return {
    pos: {
      sucursales: ["Ocosingo", "Yajalón", "San Cristóbal", "Palenque", "MercadoLibre", "CEDIS"]
        .map((nombre, i) => ({ id: i + 1, nombre })),
      cajas: [{ id: 20, sucursal_id: 1, nombre: "Administrativa", predeterminada: true }],
      existencias: [],
    },
    admin: { usuarios: [{ id: 9, nombre: "Victor" }] },
  };
}
const datos = { nombre: " Innotec ", ciudad: " Ocosingo ", lat: "16.9", lng: "-92.1" };

test("alta id 7, dos cajas, autor real, fecha local y sin alterar otras colecciones", () => {
  const DB = prepararDB();
  const antes = structuredClone(DB);
  const nueva = crearSucursal(DB, { ...datos, id: 99, sin_ubicacion: true, creada_por: "falso" }, { id: 9 });
  assert.deepEqual(nueva, {
    id: 7, nombre: "Innotec", ciudad: "Ocosingo", lat: 16.9, lng: -92.1,
    fecha_alta: fechaLocal(), creada_por: { usuario_id: 9, nombre: "Victor" },
  });
  assert.deepEqual(DB.pos.sucursales, [...antes.pos.sucursales, nueva]);
  assert.deepEqual(DB.pos.cajas.slice(0, 1), antes.pos.cajas);
  assert.deepEqual(DB.pos.cajas.slice(1), [
    { id: 21, sucursal_id: 7, nombre: "Administrativa", predeterminada: true },
    { id: 22, sucursal_id: 7, nombre: "Fiscal", predeterminada: false },
  ]);
  assert.deepEqual(DB.pos.existencias, antes.pos.existencias);
  assert.deepEqual(DB.admin, antes.admin);
});

for (const nombre of ["Yajalon", " YAJALÓN ", " San   Cristobal "]) {
  test(`rechaza duplicado normalizado ${nombre} sin mutaciones`, () => {
    const DB = prepararDB();
    const antes = structuredClone(DB);
    const existente = nombre.includes("San") ? "San Cristóbal" : "Yajalón";
    assert.throws(() => crearSucursal(DB, { ...datos, nombre }, { id: 9 }), {
      message: `Ya existe una tienda con ese nombre: ${existente}`,
    });
    assert.deepEqual(DB, antes);
  });
}

for (const cambio of [
  { nombre: undefined }, { nombre: " " }, { nombre: [] }, { nombre: "a".repeat(61) },
  { ciudad: undefined }, { ciudad: " " }, { ciudad: 12 }, { ciudad: "a".repeat(61) },
  { lat: undefined }, { lng: null }, { lat: " " }, { lat: "abc" }, { lat: Infinity },
  { lat: true }, { lng: [] }, { lat: 91 }, { lng: 181 }, { lat: -91 }, { lng: -181 },
]) {
  test(`validación atómica ${JSON.stringify(cambio)}`, () => {
    const DB = prepararDB();
    const antes = structuredClone(DB);
    assert.throws(() => crearSucursal(DB, { ...datos, ...cambio }, { id: 9 }), { name: "Error" });
    assert.deepEqual(DB, antes);
  });
}

test("GPS faltante tiene mensaje explícito", () => {
  assert.throws(() => crearSucursal(prepararDB(), { ...datos, lat: "" }, { id: 9 }), {
    message: "Captura la ubicación GPS de la tienda (latitud y longitud)",
  });
});

test("id usa máximo existente y admite coordenadas cero", () => {
  const DB = prepararDB();
  DB.pos.sucursales.unshift({ id: 15, nombre: "Otra" });
  assert.equal(crearSucursal(DB, { ...datos, lat: 0, lng: 0 }, { id: 9 }).id, 16);
});

for (const nombre of ["SanCristobal", "san  cristóbal", "Palenque\u200B", "Mercado Libre", "ＭｅｒｃａｄｏLibre"]) {
  test(`rechaza otra escritura de tienda existente: ${nombre}`, () => {
    const DB = prepararDB();
    const antes = structuredClone(DB);
    assert.throws(() => crearSucursal(DB, { ...datos, nombre }, { id: 9 }), /Ya existe una tienda/);
    assert.deepEqual(DB, antes);
  });
}
for (const campo of ["nombre", "ciudad"]) {
  for (const valor of ["\u200B", "---", "\u200C\u200D\u2060\uFEFF", "\uFEFF", "\u0085"]) {
    test(`${campo} requiere letras o números`, () => {
      const DB = prepararDB();
      const antes = structuredClone(DB);
      assert.throws(() => crearSucursal(DB, { ...datos, [campo]: valor }, { id: 9 }), /debe tener letras o números/);
      assert.deepEqual(DB, antes);
    });
  }
}
test("guarda textos limpios y mide el máximo después de limpiar", () => {
  const nueva = crearSucursal(prepararDB(), {
    ...datos, nombre: `\u200B${"x".repeat(60)}\u200D`, ciudad: "  San\u00A0 \u3000Cristóbal\u2060 ",
  }, { id: 9 });
  assert.equal(nueva.nombre, "x".repeat(60));
  assert.equal(nueva.ciudad, "San Cristóbal");
});
test("normaliza también el espacio Unicode NEXT LINE", () => {
  const DB = prepararDB();
  assert.throws(() => crearSucursal(DB, { ...datos, nombre: "Mercado\u0085Libre" }, { id: 9 }), /Ya existe/);
  const nueva = crearSucursal(DB, { ...datos, ciudad: "San\u0085 Cristóbal" }, { id: 9 });
  assert.equal(nueva.ciudad, "San Cristóbal");
});
for (const [grupo, coleccion] of [["pos", "cajas"], ["admin", "usuarios"], ["pos", "vendedores"]]) {
  test(`huérfanos en ${coleccion} impiden alta sin mutar`, () => {
    const DB = prepararDB();
    (DB[grupo][coleccion] ||= []).push({ id: 50, sucursal_id: "7" });
    const antes = structuredClone(DB);
    assert.throws(() => crearSucursal(DB, datos, { id: 9 }), {
      message: "Hay registros huérfanos con la sucursal 7; revisa antes de crear la tienda",
    });
    assert.deepEqual(DB, antes);
  });
}
test("cajas con id ausente o no numérico no contaminan nuevos ids", () => {
  const DB = prepararDB();
  DB.pos.cajas.push({ sucursal_id: 2 }, { id: "abc", sucursal_id: 3 });
  const anteriores = structuredClone(DB.pos.cajas);
  crearSucursal(DB, datos, { id: 9 });
  assert.deepEqual(DB.pos.cajas.slice(0, 3), anteriores);
  assert.deepEqual(DB.pos.cajas.slice(3).map((c) => c.id), [21, 22]);
});

