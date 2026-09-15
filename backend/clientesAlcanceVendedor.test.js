const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { crearCliente, actualizarCliente } = require("./clientes");
const { actualizarVendedor } = require("./vendedores");

const TODAS = { verTodas: true };

function prepararDB() {
  const DB = construirDBPrueba();
  DB.crm.clientes = DB.crm.clientes.map((cliente) => ({ ...cliente }));
  DB.pos.vendedores = DB.pos.vendedores.map((vendedor) => ({ ...vendedor }));
  return DB;
}

test("no se asigna un cliente a un vendedor de otra sucursal", () => {
  const DB = prepararDB();
  const cantidadInicial = DB.crm.clientes.length;

  assert.throws(
    () => crearCliente(DB, { nombre: "Cliente cruzado", sucursal_id: 1, vendedor_asignado_id: 3 }),
    /vendedor.*misma sucursal/i,
  );
  assert.strictEqual(DB.crm.clientes.length, cantidadInicial, "el rechazo no crea nada");
});

test("no se asigna un cliente a un vendedor que no existe", () => {
  const DB = prepararDB();
  const cantidadInicial = DB.crm.clientes.length;

  assert.throws(
    () => crearCliente(DB, { nombre: "Cliente sin vendedor", sucursal_id: 1, vendedor_asignado_id: "999" }),
    /vendedor.*no existe/i,
  );
  assert.strictEqual(DB.crm.clientes.length, cantidadInicial, "el rechazo no crea nada");
});

test("editar el cliente valida el vendedor y la sucursal finales sin modificar nada al rechazar", () => {
  const DB = prepararDB();
  const antes = { ...DB.crm.clientes.find((cliente) => cliente.id === 1) };

  assert.throws(
    () => actualizarCliente(DB, 1, {
      nombre: "Nombre que no debe guardarse",
      sucursal_id: "2",
      vendedor_asignado_id: "1",
    }),
    /vendedor.*misma sucursal/i,
  );
  assert.deepStrictEqual(DB.crm.clientes.find((cliente) => cliente.id === 1), antes);
});

test("editar solo el teléfono no bloquea un cliente histórico ya cruzado", () => {
  const DB = prepararDB();
  const cliente = DB.crm.clientes.find((item) => item.id === 1);
  cliente.vendedor_asignado_id = 3;

  const actualizado = actualizarCliente(DB, 1, { telefono: "9611234567" });

  assert.strictEqual(actualizado.telefono, "9611234567");
  assert.strictEqual(actualizado.vendedor_asignado_id, 3);
});

test("trasladar a un vendedor con clientes asignados se bloquea hasta reasignarlos", () => {
  const DB = prepararDB();
  DB.crm.clientes.push({ id: 20, nombre: "Otro cliente", sucursal_id: 1, vendedor_asignado_id: "1" });
  const antes = { ...DB.pos.vendedores.find((vendedor) => vendedor.id === 1) };

  assert.throws(
    () => actualizarVendedor(DB, "1", { nombre: "Nombre que no debe guardarse", sucursal_id: "2" }, TODAS),
    /2 clientes.*primero.*reasignarlos/i,
  );
  assert.deepStrictEqual(DB.pos.vendedores.find((vendedor) => vendedor.id === 1), antes);
});

test("un vendedor sin clientes asignados sí se puede trasladar", () => {
  const DB = prepararDB();
  DB.crm.clientes.forEach((cliente) => {
    if (Number(cliente.vendedor_asignado_id) === 1) cliente.vendedor_asignado_id = null;
  });

  const actualizado = actualizarVendedor(DB, "1", { sucursal_id: "2" }, TODAS);

  assert.strictEqual(actualizado.sucursal_id, 2);
});

test("un cliente sin vendedor asignado sigue siendo válido", () => {
  for (const vendedor_asignado_id of [null, undefined, "", 0]) {
    const DB = prepararDB();
    const cliente = crearCliente(DB, {
      nombre: `Cliente sin asignar ${String(vendedor_asignado_id)}`,
      sucursal_id: "2",
      vendedor_asignado_id,
    });

    assert.strictEqual(cliente.vendedor_asignado_id, null);
    assert.strictEqual(cliente.sucursal_id, 2);
  }
});

test("crear y editar normalizan ids de texto cuando vendedor y sucursal coinciden", () => {
  const DB = prepararDB();
  const cliente = crearCliente(DB, {
    nombre: "Cliente con ids de texto",
    sucursal_id: "1",
    vendedor_asignado_id: "1",
  });

  assert.strictEqual(cliente.sucursal_id, 1);
  assert.strictEqual(cliente.vendedor_asignado_id, 1);

  const actualizado = actualizarCliente(DB, cliente.id, {
    sucursal_id: "2",
    vendedor_asignado_id: "3",
  });
  assert.strictEqual(actualizado.sucursal_id, 2);
  assert.strictEqual(actualizado.vendedor_asignado_id, 3);
});

test("Público en General conserva su id 0 al editar datos permitidos", () => {
  const DB = prepararDB();

  const actualizado = actualizarCliente(DB, 0, { telefono: "9610000000" });

  assert.strictEqual(actualizado.id, 0);
  assert.strictEqual(actualizado.telefono, "9610000000");
});
