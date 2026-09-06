const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { crearCliente, actualizarCliente } = require("./clientes");

/**
 * ASIGNACION EN MASA. `actualizarCliente` copiaba el cuerpo de la peticion
 * entero sobre el cliente (`{ ...actual, ...datos, id }`), sin lista blanca.
 *
 * Los campos de dinero —`saldo`, `monedero`, `limite_credito`,
 * `sujeto_credito`— no los escribe una persona desde una pantalla: los calcula
 * el sistema. Quien tuviera `editar_cliente` (el Gerente de sucursal lo tiene)
 * podia fijarselos por HTTP sobre CUALQUIER cliente ya existente: es la puerta
 * trasera del credito, y sigue importando aunque el credito este apagado,
 * porque `monedero` y `saldo` son dinero.
 */
test("editar un cliente no puede tocar los campos de dinero", () => {
  const DB = construirDBPrueba();
  const cliente = crearCliente(DB, { nombre: "Cliente de prueba", sucursal_id: 1, limite_credito: 1000 });

  actualizarCliente(DB, cliente.id, {
    nombre: "Nombre corregido",
    telefono: "9611234567",
    saldo: -999999,
    monedero: 50000,
    limite_credito: 900000,
    sujeto_credito: true,
  });

  const guardado = DB.crm.clientes.find((c) => c.id === cliente.id);
  assert.strictEqual(guardado.nombre, "Nombre corregido", "los campos normales SI se editan");
  assert.strictEqual(guardado.telefono, "9611234567", "los campos normales SI se editan");
  assert.strictEqual(guardado.saldo, 0);
  assert.strictEqual(guardado.monedero, 0);
  assert.strictEqual(guardado.limite_credito, 1000);
  assert.strictEqual(guardado.sujeto_credito, false);
});

/**
 * El id tampoco se puede mover: reasignarlo convertiria a un cliente en otro y
 * le llevaria su historial encima.
 */
test("editar un cliente no puede cambiarle el id", () => {
  const DB = construirDBPrueba();
  const cliente = crearCliente(DB, { nombre: "Otro cliente", sucursal_id: 1 });

  actualizarCliente(DB, cliente.id, { id: 999, nombre: "Otro cliente" });

  assert.ok(DB.crm.clientes.find((c) => c.id === cliente.id), "sigue con su id");
  assert.strictEqual(DB.crm.clientes.find((c) => c.id === 999), undefined);
});

/** Un campo que nadie declaro como editable no se cuela por venir en el cuerpo. */
test("un campo desconocido no se escribe", () => {
  const DB = construirDBPrueba();
  const cliente = crearCliente(DB, { nombre: "Tercer cliente", sucursal_id: 1 });

  actualizarCliente(DB, cliente.id, { nombre: "Tercer cliente", campo_inventado: "lo que sea" });

  assert.strictEqual(DB.crm.clientes.find((c) => c.id === cliente.id).campo_inventado, undefined);
});

/** La red: editar lo normal tiene que seguir funcionando igual que siempre. */
test("los datos de contacto y catalogo siguen editandose", () => {
  const DB = construirDBPrueba();
  const cliente = crearCliente(DB, { nombre: "Cuarto cliente", sucursal_id: 1 });

  const actualizado = actualizarCliente(DB, cliente.id, {
    nombre: "Cuarto cliente S.A.",
    rfc: "AAA010101AAA",
    email: "correo@ejemplo.com",
    celular: "9619876543",
    tipo: "mayoreo",
    estado: "compro",
    vendedor_asignado_id: 1,
    ubicacion: "Ocosingo centro",
  });

  assert.strictEqual(actualizado.nombre, "Cuarto cliente S.A.");
  assert.strictEqual(actualizado.rfc, "AAA010101AAA");
  assert.strictEqual(actualizado.email, "correo@ejemplo.com");
  assert.strictEqual(actualizado.celular, "9619876543");
  assert.strictEqual(actualizado.tipo, "mayoreo");
  assert.strictEqual(actualizado.estado, "compro");
  assert.strictEqual(actualizado.vendedor_asignado_id, 1);
  assert.strictEqual(actualizado.ubicacion, "Ocosingo centro");
});
