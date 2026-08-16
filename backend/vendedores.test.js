/**
 * vendedores.test.js — El catálogo de quién vende en cada tienda.
 *
 * Lo que más importa: que un vendedor NUNCA se borre (las ventas históricas
 * resuelven su nombre por id), que la sucursal no se pueda descuadrar respecto
 * a la cuenta ligada, y que quien administra una sola tienda no toque las otras.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const {
  listarVendedores, crearVendedor, actualizarVendedor, desactivarVendedor,
} = require("./vendedores");

function nuevoDB() {
  return {
    pos: {
      sucursales: [
        { id: 1, nombre: "Ocosingo" },
        { id: 2, nombre: "Yajalón" },
        { id: 4, nombre: "Palenque" },
      ],
      vendedores: [
        { id: 1, nombre: "Ana López", sucursal_id: 1, meta_mensual: 50000 },
        { id: 3, nombre: "María R.", sucursal_id: 2, meta_mensual: 40000 },
      ],
      ventas: [],
    },
    admin: { usuarios: [] },
  };
}

const TODAS = { verTodas: true };
const SOLO_YAJALON = { verTodas: false, sucursalId: 2 };

// ---------- Alta ----------

test("dar de alta un vendedor lo hace elegible para objetivos de venta", () => {
  const DB = nuevoDB();
  const v = crearVendedor(DB, { nombre: "Rosa Pérez", sucursal_id: 1, meta_mensual: 35000 }, TODAS);
  assert.strictEqual(v.nombre, "Rosa Pérez");
  assert.strictEqual(v.sucursal_id, 1);
  assert.strictEqual(v.meta_mensual, 35000);
  assert.strictEqual(v.activo, true);
  assert.ok(DB.pos.vendedores.some((x) => x.id === v.id));
});

test("la meta es opcional al dar de alta", () => {
  const DB = nuevoDB();
  assert.strictEqual(crearVendedor(DB, { nombre: "Sin Meta", sucursal_id: 1 }, TODAS).meta_mensual, 0);
});

test("no se puede dar de alta sin nombre ni con una sucursal inventada", () => {
  const DB = nuevoDB();
  assert.throws(() => crearVendedor(DB, { nombre: "  ", sucursal_id: 1 }, TODAS), /nombre/i);
  assert.throws(() => crearVendedor(DB, { nombre: "X", sucursal_id: 99 }, TODAS), /sucursal/i);
});

test("no se permiten dos vendedores con el mismo nombre", () => {
  // Serían indistinguibles en el selector de personal y en los reportes, y
  // ligar la cuenta equivocada es justo el error que este catálogo evita.
  const DB = nuevoDB();
  assert.throws(() => crearVendedor(DB, { nombre: "ana lópez", sucursal_id: 1 }, TODAS), /ya existe/i);
});

test("quien administra una sola tienda no da de alta vendedores de otra", () => {
  const DB = nuevoDB();
  assert.throws(
    () => crearVendedor(DB, { nombre: "Ajena", sucursal_id: 1 }, SOLO_YAJALON),
    /tu propia sucursal/i,
  );
  assert.ok(crearVendedor(DB, { nombre: "Propia", sucursal_id: 2 }, SOLO_YAJALON));
});

// ---------- Listado y alcance ----------

test("quien administra una tienda solo ve a sus vendedores", () => {
  const lista = listarVendedores(nuevoDB(), SOLO_YAJALON);
  assert.deepStrictEqual(lista.map((v) => v.nombre), ["María R."]);
});

test("los inactivos no salen salvo que se pidan", () => {
  const DB = nuevoDB();
  desactivarVendedor(DB, 1, TODAS);
  assert.ok(!listarVendedores(DB, TODAS).some((v) => v.id === 1));
  assert.ok(listarVendedores(DB, TODAS, { incluirInactivos: true }).some((v) => v.id === 1));
});

test("un vendedor sembrado sin el campo activo se considera activo", () => {
  // Los cinco de ejemplo vienen de server.js sin ese campo.
  const lista = listarVendedores(nuevoDB(), TODAS);
  assert.strictEqual(lista.length, 2);
  assert.ok(lista.every((v) => v.activo === true));
});

test("el listado dice si el vendedor ya tiene cuenta ligada", () => {
  const DB = nuevoDB();
  DB.admin.usuarios.push({ id: 10, usuario: "ana", vendedor_id: 1, sucursal_id: 1 });
  const ana = listarVendedores(DB, TODAS).find((v) => v.id === 1);
  assert.strictEqual(ana.cuenta_ligada, "ana");
  const maria = listarVendedores(DB, TODAS).find((v) => v.id === 3);
  assert.strictEqual(maria.cuenta_ligada, null);
});

// ---------- Nunca se borra ----------

test("desactivar NO borra el renglón: los reportes históricos conservan el nombre", () => {
  // Cada venta guarda su vendedor_id y reportes.js resuelve el nombre por ahí.
  // Borrar dejaría las ventas viejas mostrando "—" para siempre.
  const DB = nuevoDB();
  DB.pos.ventas.push({ id: 1, vendedor_id: 1, total: 5000 });

  desactivarVendedor(DB, 1, TODAS);

  const sigue = DB.pos.vendedores.find((v) => v.id === 1);
  assert.ok(sigue, "el renglón debe seguir existiendo");
  assert.strictEqual(sigue.nombre, "Ana López");
  assert.strictEqual(sigue.activo, false);
});

test("no se puede desactivar a alguien que todavía tiene cuenta ligada", () => {
  // Si no, esa persona entra al sistema y ve un tablero de un vendedor que ya
  // no está activo, sin explicación.
  const DB = nuevoDB();
  DB.admin.usuarios.push({ id: 10, usuario: "ana", vendedor_id: 1, sucursal_id: 1 });
  assert.throws(() => desactivarVendedor(DB, 1, TODAS), /ligada/i);
});

test("un vendedor desactivado se puede reactivar", () => {
  const DB = nuevoDB();
  desactivarVendedor(DB, 1, TODAS);
  assert.strictEqual(actualizarVendedor(DB, 1, { activo: true }, TODAS).activo, true);
});

// ---------- Edición ----------

test("cambiar la sucursal se bloquea si descuadra con la cuenta ligada", () => {
  // La sucursal decide qué ventas cuentan para la meta: si no cuadra con la
  // cuenta, la persona vería un tablero cuyas ventas ya no son las suyas.
  const DB = nuevoDB();
  DB.admin.usuarios.push({ id: 10, usuario: "ana", vendedor_id: 1, sucursal_id: 1 });
  assert.throws(() => actualizarVendedor(DB, 1, { sucursal_id: 2 }, TODAS), /otra sucursal/i);
});

test("sin cuenta ligada, la sucursal sí se puede corregir", () => {
  const DB = nuevoDB();
  assert.strictEqual(actualizarVendedor(DB, 1, { sucursal_id: 2 }, TODAS).sucursal_id, 2);
});

test("quien administra una tienda no puede sacar un vendedor de ella", () => {
  const DB = nuevoDB();
  assert.throws(() => actualizarVendedor(DB, 3, { sucursal_id: 1 }, SOLO_YAJALON), /otra sucursal/i);
});

test("no se alcanza a un vendedor de otra sucursal, ni para editar ni para desactivar", () => {
  const DB = nuevoDB();
  // Mismo mensaje que "no existe": no se confirma que el de la otra tienda exista.
  assert.throws(() => actualizarVendedor(DB, 1, { nombre: "X" }, SOLO_YAJALON), /no encontrado/i);
  assert.throws(() => desactivarVendedor(DB, 1, SOLO_YAJALON), /no encontrado/i);
});

test("una meta negativa se rechaza al editar", () => {
  assert.throws(() => actualizarVendedor(nuevoDB(), 1, { meta_mensual: -1 }, TODAS), /mayor o igual/i);
});

test("renombrar a un vendedor con el nombre de otro se rechaza", () => {
  assert.throws(() => actualizarVendedor(nuevoDB(), 3, { nombre: "Ana López" }, TODAS), /ya existe/i);
});

test("renombrarse a sí mismo con el mismo nombre no se bloquea", () => {
  const DB = nuevoDB();
  assert.strictEqual(actualizarVendedor(DB, 1, { nombre: "Ana López" }, TODAS).nombre, "Ana López");
});
