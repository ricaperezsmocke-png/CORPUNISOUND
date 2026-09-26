const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { crearCliente } = require("./clientes");
const { crearVenta } = require("./ventas");
const { crearApartado } = require("./apartados");
const { calcularCorteEnCurso } = require("./cortes");
const { sembrarCajas } = require("./cajas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { descuentos_pago_habilitado: false };
  require("./condicionesPago").listarCondiciones(DB, 1);
  return DB;
}
const datos = (extra = {}) => ({
  sucursal_id: "1", cliente_id: "1", metodo_pago: "EFECTIVO",
  lineas: [{ producto_id: "1", cantidad: 1, precio_unitario: 25 }], ...extra,
});
const opciones = { permisos: ["cambiar_tipo_documento"] };

test("H1: el alta ignora dinero inventado y la venta cobra todo en caja", () => {
  const DB = prepararDB();
  const cliente = crearCliente(DB, {
    nombre: "Cliente", monedero: 12000, saldo: 9000, saldo_vencido: 8000,
    limite_credito: 15000, sujeto_credito: true,
  });
  for (const campo of ["monedero", "saldo", "saldo_vencido", "limite_credito"]) assert.equal(cliente[campo], 0);
  assert.equal(cliente.sujeto_credito, false);
  const venta = crearVenta(DB, datos({ cliente_id: String(cliente.id), monedero_aplicado: 12000 }));
  assert.equal(venta.monedero_aplicado, 0);
  assert.equal(calcularCorteEnCurso(DB, 1, venta.caja_id).calculado.EFECTIVO, 25);
});

for (const tipo of ["Apartado", "apartado", "Cotización", "Tícket", "Remisi\uFFFDn", " Ticket", false, 0, {}]) {
  test(`H2: rechaza documento ${JSON.stringify(tipo)} sin modificar dinero ni inventario`, () => {
    const DB = prepararDB();
    const antes = structuredClone(DB);
    assert.throws(() => crearVenta(DB, datos({ tipo_documento: tipo }), opciones), /documento/i);
    assert.deepEqual(DB, antes);
  });
}
for (const tipo of ["Ticket", "Factura", "Nota de Venta", "Factura CFDI", "Remisión", "", undefined, null]) {
  test(`H2: acepta documento permitido ${tipo} y lo incluye en corte`, () => {
    const DB = prepararDB();
    const venta = crearVenta(DB, datos({ tipo_documento: tipo }), opciones);
    assert.equal(venta.tipo_documento, tipo || "Ticket");
    assert.equal(venta.total, 25);
    assert.equal(calcularCorteEnCurso(DB, 1, venta.caja_id).calculado.EFECTIVO, 25);
  });
}
test("H2: permisos vecinos no autorizan cambiar el documento", () => {
  for (const tipo of ["Factura", "Nota de Venta", "Factura CFDI", "Remisión"]) {
    const DB = prepararDB();
    const antes = structuredClone(DB);
    assert.throws(() => crearVenta(DB, datos({ tipo_documento: tipo }), {
      permisos: ["cerrar_venta", "cambiar_numero_precio"],
    }), /permiso/i);
    assert.deepEqual(DB, antes);
  }
  assert.equal(crearVenta(prepararDB(), datos()).tipo_documento, "Ticket");
});

for (const apartado of [false, true]) {
  const crear = (DB, precio) => {
    const entrada = datos({ lineas: [{ producto_id: "1", cantidad: 1, ...precio }] });
    return apartado ? crearApartado(DB, { ...entrada, anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO" }, "1")
      : crearVenta(DB, entrada);
  };
  for (const precio of [24, 26, null, "", "basura", 25.01]) {
    test(`H3: ${apartado ? "apartado" : "venta"} rechaza precio ${JSON.stringify(precio)} sin efectos`, () => {
      const DB = prepararDB();
      const antes = structuredClone(DB);
      assert.throws(() => crear(DB, { precio_unitario: precio }), /precio.*catálogo.*Recarga/i);
      assert.deepEqual(DB, antes);
    });
  }
  for (const precio of [{ precio_unitario: "25" }, { precio_unitario: 25.004 }, {}]) {
    test(`H3: ${apartado ? "apartado" : "venta"} acepta centavos iguales o precio omitido ${JSON.stringify(precio)}`, () => {
      const DB = prepararDB();
      const venta = crear(DB, precio);
      assert.equal(venta.total, 25);
      assert.equal(DB.pos.venta_detalle[0].precio_unitario, 25);
      assert.equal(DB.inventario.existencias[0].cantidad_actual, 119);
    });
  }
}

test("H2: el documento configurado por defecto se permite sin el permiso de cambiar documento", () => {
  const { crearVenta } = require("./ventas");
  const { obtenerConfiguracion } = require("./configuracion");
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB).documento_por_defecto = "Nota de Venta";
  const venta = crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "TARJETA", tipo_documento: "Nota de Venta",
    lineas: [{ producto_id: 1, cantidad: 1 }],
  }, { permisos: ["cerrar_venta"], usuario: { id: 5, nombre: "Cajera" } });
  assert.strictEqual(venta.tipo_documento, "Nota de Venta");
  assert.throws(() => crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "TARJETA", tipo_documento: "Factura",
    lineas: [{ producto_id: 1, cantidad: 1 }],
  }, { permisos: ["cerrar_venta"], usuario: { id: 5, nombre: "Cajera" } }), /permiso para cambiar el tipo de documento/);
});
