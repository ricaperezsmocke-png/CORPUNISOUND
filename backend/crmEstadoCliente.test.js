const test = require("node:test");
const assert = require("node:assert/strict");

const { cambiarEstadoCliente } = require("./crm");

function construirDB() {
  return {
    crm: {
      clientes: [
        { id: 1, nombre: "Prospecto", sucursal_id: 1, estado: "interesado", ultimo_contacto: null },
        { id: 2, nombre: "Compro en ML", sucursal_id: 1, estado: "compro", ultimo_contacto: null },
      ],
    },
  };
}

test("poner 'compro' a mano se rechaza y el cliente conserva su estado", () => {
  const DB = construirDB();
  assert.throws(() => cambiarEstadoCliente(DB, 1, "compro"), /venta/i);
  assert.equal(DB.crm.clientes[0].estado, "interesado", "no debio moverse");
  assert.equal(DB.crm.clientes[0].ultimo_contacto, null, "ni tocar el ultimo contacto");
});

test("los cuatro estados que si sabe una persona se pueden poner", () => {
  for (const estado of ["contactado", "interesado", "visito_tienda", "perdido"]) {
    const DB = construirDB();
    assert.equal(cambiarEstadoCliente(DB, 1, estado).estado, estado);
  }
});

test("un estado inventado se rechaza", () => {
  const DB = construirDB();
  assert.throws(() => cambiarEstadoCliente(DB, 1, "cualquier_cosa"), /no es v[aá]lido/i);
  assert.equal(DB.crm.clientes[0].estado, "interesado");
});

test("un cliente que YA compro si puede moverse a otro estado", () => {
  const DB = construirDB();
  // La regla es sobre PONER "compro", no sobre salir de el: un cliente que
  // compro por MercadoLibre puede volver al embudo como cualquier otro.
  assert.equal(cambiarEstadoCliente(DB, 2, "contactado").estado, "contactado");
});

test("cambiar de estado sigue actualizando el ultimo contacto", () => {
  const DB = construirDB();
  const cliente = cambiarEstadoCliente(DB, 1, "visito_tienda");
  assert.ok(cliente.ultimo_contacto, "debio quedar con fecha de hoy");
});

test("un cliente que no existe sigue dando error", () => {
  const DB = construirDB();
  assert.throws(() => cambiarEstadoCliente(DB, 999, "contactado"), /no encontrado/i);
});
