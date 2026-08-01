const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const {
  listarCategorias, crearCategoria, renombrarCategoria, desactivarCategoria, buscarHojaActiva,
} = require("./gastosCategorias");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("el módulo gastos y sus 4 permisos están en el catálogo", () => {
  const modulo = listarModulosSistema().find((m) => m.id === "gastos");
  assert.ok(modulo, "el módulo gastos debe existir en MODULOS_SISTEMA");

  const claves = ["ver_gastos", "registrar_gastos", "cancelar_gastos", "administrar_categorias_gastos"];
  for (const clave of claves) {
    const p = listarPermisos().find((x) => x.clave === clave);
    assert.ok(p, `debe existir el permiso ${clave}`);
    assert.strictEqual(p.modulo, "gastos", `${clave} debe pertenecer al módulo gastos`);
    assert.strictEqual(p.implementado, true);
  }
});

test("el guardia de arranque sigue pasando con el módulo nuevo", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});

test("el catálogo viene sembrado con grupos y subcategorías", () => {
  const DB = construirDBPrueba();
  const todas = listarCategorias(DB, {});
  const grupos = todas.filter((c) => c.categoria_padre_id === null);
  const hojas = todas.filter((c) => c.categoria_padre_id !== null);

  assert.strictEqual(grupos.length, 7, "7 grupos sembrados");
  assert.ok(hojas.length >= 25, "al menos 25 subcategorías sembradas");
  assert.ok(grupos.some((g) => g.nombre === "Servicios"));
  assert.ok(hojas.some((h) => h.nombre === "Combustible"));
  assert.ok(todas.every((c) => c.activa === true), "todo nace activo");
});

test("crearCategoria: agrega un grupo y una subcategoría", () => {
  const DB = construirDBPrueba();
  const grupo = crearCategoria(DB, { nombre: "Fletes", categoria_padre_id: null });
  assert.strictEqual(grupo.categoria_padre_id, null);
  assert.strictEqual(grupo.activa, true);

  const hoja = crearCategoria(DB, { nombre: "Paquetería", categoria_padre_id: grupo.id });
  assert.strictEqual(hoja.categoria_padre_id, grupo.id);
});

test("crearCategoria: rechaza nombre vacío y padre inexistente", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearCategoria(DB, { nombre: "   ", categoria_padre_id: null }), /nombre/i);
  assert.throws(() => crearCategoria(DB, { nombre: "X", categoria_padre_id: 9999 }), /no encontrad/i);
});

test("crearCategoria: no permite anidar una subcategoría dentro de otra subcategoría", () => {
  const DB = construirDBPrueba();
  const hoja = listarCategorias(DB, {}).find((c) => c.categoria_padre_id !== null);
  assert.throws(
    () => crearCategoria(DB, { nombre: "Nieta", categoria_padre_id: hoja.id }),
    /solo dos niveles/i
  );
});

test("renombrarCategoria cambia el nombre sin tocar nada más", () => {
  const DB = construirDBPrueba();
  const hoja = listarCategorias(DB, {}).find((c) => c.nombre === "Combustible");
  const r = renombrarCategoria(DB, hoja.id, "Gasolina");
  assert.strictEqual(r.nombre, "Gasolina");
  assert.strictEqual(r.categoria_padre_id, hoja.categoria_padre_id);
});

test("desactivarCategoria: la quita de las activas pero NO la borra", () => {
  const DB = construirDBPrueba();
  const antes = listarCategorias(DB, {}).length;
  const hoja = listarCategorias(DB, {}).find((c) => c.nombre === "Multas");

  desactivarCategoria(DB, hoja.id);

  assert.strictEqual(listarCategorias(DB, {}).length, antes, "sigue existiendo el registro");
  assert.ok(!listarCategorias(DB, { soloActivas: true }).some((c) => c.id === hoja.id));
});

test("desactivarCategoria: no deja desactivar un grupo con subcategorías activas", () => {
  const DB = construirDBPrueba();
  const grupo = listarCategorias(DB, {}).find((c) => c.nombre === "Servicios");
  assert.throws(() => desactivarCategoria(DB, grupo.id), /subcategorías activas/i);
});

test("buscarHojaActiva: acepta una hoja activa y rechaza grupo, inactiva e inexistente", () => {
  const DB = construirDBPrueba();
  const hoja = listarCategorias(DB, {}).find((c) => c.nombre === "Luz");
  const grupo = listarCategorias(DB, {}).find((c) => c.nombre === "Servicios");

  assert.strictEqual(buscarHojaActiva(DB, hoja.id).id, hoja.id);
  assert.throws(() => buscarHojaActiva(DB, grupo.id), /subcategoría/i);
  assert.throws(() => buscarHojaActiva(DB, 9999), /no encontrad/i);

  desactivarCategoria(DB, hoja.id);
  assert.throws(() => buscarHojaActiva(DB, hoja.id), /desactivada/i);
});
