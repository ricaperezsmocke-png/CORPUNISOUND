const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { ajustarExistencia, crearProducto } = require("./productos");

const ultimoMovimiento = (DB) => DB.inventario.movimientos_inventario.slice(-1)[0];

/**
 * Un ajuste de existencia mueve inventario sin que medie ningun documento: no
 * hay venta, compra ni traspaso a los que rastrearlo. Si ademas no guarda quien
 * lo hizo, bajar la existencia de un producto caro no deja a nadie a quien
 * preguntarle. El Gerente de sucursal tiene este permiso.
 */
test("un ajuste de existencia guarda quien lo hizo", () => {
  const DB = construirDBPrueba();

  ajustarExistencia(DB, 1, { cantidad: -5, motivo: "merma", sucursal_id: 1, usuario: { nombre: "Gerente Ocosingo" } });

  assert.strictEqual(ultimoMovimiento(DB).usuario, "Gerente Ocosingo");
});

/**
 * Los movimientos que nacen de un documento —venta, compra, traspaso— se
 * rastrean por su folio, que ya va en `referencia_documento`. Cuando no llega
 * usuario se guarda la misma marca que usan las cancelaciones, nunca
 * `undefined`: un campo ausente y uno con "—" se leen distinto en una auditoria.
 */
test("sin usuario se guarda una marca, no undefined", () => {
  const DB = construirDBPrueba();

  ajustarExistencia(DB, 1, { cantidad: -1, motivo: "Venta — folio 7", sucursal_id: 1 });

  assert.strictEqual(ultimoMovimiento(DB).usuario, "—");
});

/**
 * El alta de un producto con piezas escribia `cantidad_actual` directo, SIN
 * generar movimiento y sin usuario: era la unica forma de meter existencia al
 * sistema sin dejar huella. Es tambien la razon por la que el guard de baja de
 * productos tuvo que aprender a mirar la existencia ademas de los movimientos.
 */
test("el alta con existencia inicial deja movimiento con usuario", () => {
  const DB = construirDBPrueba();

  crearProducto(DB, {
    descripcion: "Guitarra de prueba", sku: "GT-999", categoria_id: 1,
    costo: 100, precios: [{ utilidad: 50, precioVenta: 150 }],
    existencia_inicial: 7,
  }, 1, { nombre: "Victor" });

  const mov = ultimoMovimiento(DB);
  assert.strictEqual(mov.cantidad, 7);
  assert.strictEqual(mov.sucursal_id, 1);
  assert.strictEqual(mov.usuario, "Victor");
  assert.match(String(mov.referencia_documento), /alta/i);
});

/** Un alta sin piezas no inventa un movimiento de cero. */
test("el alta sin existencia inicial no genera movimiento", () => {
  const DB = construirDBPrueba();
  const antes = DB.inventario.movimientos_inventario.length;

  crearProducto(DB, {
    descripcion: "Producto sin piezas", sku: "SP-001", categoria_id: 1,
    costo: 10, precios: [{ utilidad: 50, precioVenta: 15 }],
  }, 1, { nombre: "Victor" });

  assert.strictEqual(DB.inventario.movimientos_inventario.length, antes);
});
