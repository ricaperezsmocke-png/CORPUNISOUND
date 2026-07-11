const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearRecepcion, listarRecepciones } = require("./compras");

const USUARIO_CEDIS = { id: 9, nombre: "Encargado CEDIS" };

function conProveedor(DB) {
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor Uno", contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "" });
  return DB;
}

test("crearRecepcion suma existencia en la sucursal del CEDIS y guarda el renglón", () => {
  const DB = conProveedor(construirDBPrueba());
  // producto 1 tiene 120 en sucursal 1 (fixture); en CEDIS (6) no tiene fila todavía
  const compra = crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 10, costo: 50 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(compra.proveedor_id, 1);
  assert.strictEqual(compra.sucursal_id, 6);
  const existCedis = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 6);
  assert.ok(existCedis, "debe crear la fila de existencia en CEDIS");
  assert.strictEqual(existCedis.cantidad_actual, 10);

  const detalle = DB.inventario.compra_detalle.filter((d) => d.compra_id === compra.id);
  assert.strictEqual(detalle.length, 1);
  assert.strictEqual(detalle[0].cantidad, 10);
  assert.strictEqual(detalle[0].costo, 50);
});

test("crearRecepcion genera un movimiento de inventario tipo entrada por renglón", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 10, costo: 50 }],
  }, 6, USUARIO_CEDIS);
  const mov = DB.inventario.movimientos_inventario.find((m) => m.producto_id === 1 && m.sucursal_id === 6);
  assert.ok(mov, "debe existir el movimiento");
  assert.strictEqual(mov.tipo, "entrada");
  assert.strictEqual(mov.cantidad, 10);
});

test("crearRecepcion actualiza el costo del producto cuando cambia", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40);
  assert.strictEqual(producto.precios[0].precioVenta, 50, "40 * 1.25");
});

test("crearRecepcion no toca precios si el costo capturado es igual al actual", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];
  const preciosAntes = JSON.stringify(producto.precios);

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 20 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(JSON.stringify(producto.precios), preciosAntes);
});

test("crearRecepcion rechaza sin proveedor", () => {
  const DB = conProveedor(construirDBPrueba());
  assert.throws(
    () => crearRecepcion(DB, { renglones: [{ producto_id: 1, cantidad: 5, costo: 20 }] }, 6, USUARIO_CEDIS),
    /Selecciona un proveedor/
  );
});

test("crearRecepcion rechaza sin renglones", () => {
  const DB = conProveedor(construirDBPrueba());
  assert.throws(
    () => crearRecepcion(DB, { proveedor_id: 1, renglones: [] }, 6, USUARIO_CEDIS),
    /Agrega al menos un producto/
  );
});

test("crearRecepcion rechaza cantidad <= 0", () => {
  const DB = conProveedor(construirDBPrueba());
  assert.throws(
    () => crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 0, costo: 20 }] }, 6, USUARIO_CEDIS),
    /La cantidad debe ser mayor a cero/
  );
});

test("listarRecepciones: usuario amarrado a CEDIS solo ve las suyas", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 20 }] }, 6, USUARIO_CEDIS);
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 2, cantidad: 3, costo: 10 }] }, 1, USUARIO_CEDIS);

  const paraCedis = listarRecepciones(DB, { verTodas: false, sucursalId: 6 });
  assert.strictEqual(paraCedis.length, 1);
  assert.strictEqual(paraCedis[0].sucursal_id, 6);
  assert.strictEqual(paraCedis[0].renglones.length, 1);
  assert.strictEqual(paraCedis[0].renglones[0].producto_id, 1);
});

test("listarRecepciones: usuario global ve todas", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 20 }] }, 6, USUARIO_CEDIS);
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 2, cantidad: 3, costo: 10 }] }, 1, USUARIO_CEDIS);

  const todas = listarRecepciones(DB, { verTodas: true, sucursalId: null });
  assert.strictEqual(todas.length, 2);
});

test("crearRecepcion funciona con producto legacy sin precios array", () => {
  const DB = conProveedor(construirDBPrueba());
  // Simula producto legacy (como los 4 de seed) sin precios array
  const productoLegacy = {
    id: 99,
    nombre: "Producto Legacy",
    costo: 50,
    precio_venta: 75,
    // Sin precios array
  };
  DB["catalogo-productos"].productos.push(productoLegacy);

  // Crear recepción con costo diferente del actual
  const compra = crearRecepcion(DB, {
    proveedor_id: 1,
    factura: "A-999",
    renglones: [{ producto_id: 99, cantidad: 5, costo: 100 }],
  }, 6, USUARIO_CEDIS);

  assert.ok(compra.id, "debe crear la recepción sin error");
  assert.strictEqual(productoLegacy.costo, 100, "debe actualizar el costo del producto legacy");
  assert.strictEqual(productoLegacy.precio_venta, 75, "debe mantener precio_venta si no hay precios array");
  const existCedis = DB.inventario.existencias.find((e) => e.producto_id === 99 && e.sucursal_id === 6);
  assert.strictEqual(existCedis.cantidad_actual, 5, "debe incrementar existencia en CEDIS");
});

test("crearRecepcion no muta nada si un renglón posterior referencia un producto inexistente", () => {
  const DB = conProveedor(construirDBPrueba());
  const existenciaAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 6);
  assert.strictEqual(existenciaAntes, undefined, "CEDIS no debe tener fila de existencia de producto 1 todavía");

  assert.throws(
    () => crearRecepcion(DB, {
      proveedor_id: 1, factura: "A-200",
      renglones: [
        { producto_id: 1, cantidad: 10, costo: 50 },
        { producto_id: 999, cantidad: 5, costo: 20 },
      ],
    }, 6, USUARIO_CEDIS),
    /Producto no encontrado/
  );

  assert.strictEqual(DB.inventario.compras.length, 0, "no debe crear la compra");
  assert.strictEqual(DB.inventario.compra_detalle.length, 0, "no debe crear ningún detalle");
  const existCedisDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 6);
  assert.strictEqual(existCedisDespues, undefined, "no debe haber creado/afectado existencia del renglón 1 en CEDIS");
});

test("crearRecepcion aplica descuento en pesos antes de recalcular costo", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 50, descuento_pesos: 10 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40, "50 - 10 de descuento");
  const detalle = DB.inventario.compra_detalle.find((d) => d.producto_id === 1);
  assert.strictEqual(detalle.costo, 40);
  assert.strictEqual(detalle.descuento_pesos, 10);
});

test("crearRecepcion aplica descuento en porcentaje antes de recalcular costo", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 100, descuento_porcentaje: 10 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 90, "100 * (1 - 10%) = 90");
});

test("crearRecepcion combina descuento en pesos y porcentaje: pesos primero, luego porcentaje", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 100, descuento_pesos: 10, descuento_porcentaje: 10 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 81, "(100 - 10) * (1 - 10%) = 81");
});

test("crearRecepcion sin descuento se comporta igual que antes (compatibilidad)", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40);
});

test("crearRecepcion guarda clave_sat y localizacion cuando el renglón los trae", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40, clave_sat: "52161547", localizacion: "Pasillo 3" }],
  }, 6, USUARIO_CEDIS);

  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  assert.strictEqual(producto.clave_sat, "52161547");
  assert.strictEqual(producto.localizacion, "Pasillo 3");
});

test("crearRecepcion respeta precios editados a mano en el renglón, sin dejar que actualizarCostoDesdeCompra los recalcule encima", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  // Con la fórmula normal, costo 40 * 1.25 = 50 — pero el renglón trae un
  // precio editado a mano (60) que debe prevalecer.
  const preciosEditados = [{ utilidad: 50, precioVenta: 60 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40, precios: preciosEditados }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40);
  assert.strictEqual(producto.precios[0].precioVenta, 60, "debe prevalecer el precio editado a mano, no el recalculado (50)");
});

test("crearRecepcion sin precios explícito en el renglón sigue recalculando con la fórmula normal", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.precios[0].precioVenta, 50, "40 * 1.25, formula normal preservando el % de utilidad");
});

test("crearRecepcion rechaza una factura ya registrada (mismo uuid_cfdi)", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100", uuid_cfdi: "ABCDEF12-3456-7890-ABCD-EF1234567890",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.throws(
    () => crearRecepcion(DB, {
      proveedor_id: 1, factura: "A-101", uuid_cfdi: "ABCDEF12-3456-7890-ABCD-EF1234567890",
      renglones: [{ producto_id: 2, cantidad: 1, costo: 10 }],
    }, 6, USUARIO_CEDIS),
    /ya fue registrada/
  );
});

test("crearRecepcion sin uuid_cfdi nunca choca con otras (no exige unicidad si no viene)", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }] }, 6, USUARIO_CEDIS);
  assert.doesNotThrow(() =>
    crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 2, cantidad: 1, costo: 10 }] }, 6, USUARIO_CEDIS)
  );
});
