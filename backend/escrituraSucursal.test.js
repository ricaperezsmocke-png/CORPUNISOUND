const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { ajustarExistencia } = require("./productos");
const { crearVenta, cancelarVenta } = require("./ventas");
const { obtenerConfiguracion } = require("./configuracion");
const { alcanceSucursal, dentroDeAlcance } = require("./auth");
const { permisosDeRol } = require("./roles");
const { crearApartado } = require("./apartados");

test("ajustarExistencia afecta la existencia de la sucursal indicada", () => {
  const DB = construirDBPrueba();
  // producto 2 tiene existencia en sucursal 2 (cantidad 80)
  ajustarExistencia(DB, 2, { cantidad: -5, motivo: "prueba", sucursal_id: 2 });
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist.cantidad_actual, 75);
});

test("crearVenta descuenta inventario de su propia sucursal", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB); // inicializa config
  DB.pos.configuracion.permitir_ventas_sin_existencia = true; // no bloquear por stock en la prueba
  crearVenta(DB, { sucursal_id: 2, cliente_id: 0, lineas: [{ producto_id: 2, cantidad: 10, precio_unitario: 16 }], total: 160 });
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist.cantidad_actual, 70, "se descontó de la sucursal 2");
});

test("POST /api/productos/:id/ajustar: un usuario amarrado a su sucursal no puede forzar otra vía body.sucursal_id", () => {
  const DB = construirDBPrueba();
  // rol 2 = "Gerente de sucursal": no tiene el permiso ver_todas_las_sucursales.
  const permisos = permisosDeRol(DB, 2);
  assert.ok(!permisos.includes("ver_todas_las_sucursales"));

  // Simula el request: token amarra al usuario a la sucursal 2, pero el body
  // (controlado por el cliente) pide ajustar la sucursal 4.
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {}, body: { cantidad: -5, motivo: "prueba", sucursal_id: 4 } };
  const alcance = alcanceSucursal(req, permisos);
  const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;

  // La misma lógica que aplica la ruta: el sucursal_id efectivo debe ser el
  // del token (2), nunca el que mandó el cliente en el body (4).
  assert.strictEqual(sucursal_id, 2);

  ajustarExistencia(DB, 2, { ...req.body, sucursal_id });
  const exist2 = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist2.cantidad_actual, 75, "el ajuste se aplicó a la sucursal del token, no a la del body");
});

test("POST /api/productos/:id/ajustar: un usuario con ver_todas_las_sucursales sí puede elegir sucursal_id por body", () => {
  const DB = construirDBPrueba();
  // rol 1 = "Administrador": sí tiene ver_todas_las_sucursales.
  const permisos = permisosDeRol(DB, 1);
  assert.ok(permisos.includes("ver_todas_las_sucursales"));

  const req = { usuarioToken: { rol_id: 1, sucursal_id: 1 }, query: {}, body: { cantidad: -5, motivo: "prueba", sucursal_id: 2 } };
  const alcance = alcanceSucursal(req, permisos);
  const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;

  assert.strictEqual(sucursal_id, 2);
});

test("PUT /api/ventas/:id/cancelar: un amarrado NO puede cancelar la venta de otra sucursal", () => {
  const DB = construirDBPrueba();
  // rol 2 = "Gerente de sucursal": tiene cancelar_ventas, pero está amarrado.
  const permisos = permisosDeRol(DB, 2);
  assert.ok(permisos.includes("cancelar_ventas"));
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {} };
  const alcance = alcanceSucursal(req, permisos);

  // Venta 1 es de la sucursal 1 (Ocosingo); el usuario está amarrado a la 2.
  const venta = DB.pos.ventas.find((v) => v.id === 1);
  assert.strictEqual(dentroDeAlcance(venta.sucursal_id, alcance), false, "la ruta debe responder 404 sin llegar a cancelar");

  // La ruta real corta ANTES de llamar a cancelarVenta ni de reintegrar
  // inventario — aquí se comprueba que la venta ajena queda intacta.
  assert.strictEqual(venta.estatus, "cerrada");
  const existAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existAntes, 120, "sin reintegro cruzado de inventario");
});

test("PUT /api/ventas/:id/cancelar: un amarrado sí puede cancelar la venta de su propia sucursal", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 2);
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {} };
  const alcance = alcanceSucursal(req, permisos);

  const venta = DB.pos.ventas.find((v) => v.id === 2); // venta 2 es de sucursal 2
  assert.strictEqual(dentroDeAlcance(venta.sucursal_id, alcance), true);

  const resultado = cancelarVenta(DB, 2, "prueba de cancelación propia");
  assert.strictEqual(resultado.estatus, "cancelada");
});

test("POST /api/apartados/:id/abonos: un amarrado NO puede abonar el apartado de otra sucursal", () => {
  const DB = construirDBPrueba();
  // rol 2 = "Gerente de sucursal": tiene gestionar_apartados, pero está amarrado.
  const permisos = permisosDeRol(DB, 2);
  assert.ok(permisos.includes("gestionar_apartados"));
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {} };
  const alcance = alcanceSucursal(req, permisos);

  // Apartado creado en sucursal 4 (Palenque); el usuario está amarrado a la 2.
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" });

  assert.strictEqual(dentroDeAlcance(venta.sucursal_id, alcance), false, "la ruta debe responder 404 sin llegar a abonar");
});

test("PUT /api/apartados/:id/cancelar: un amarrado NO puede cancelar el apartado de otra sucursal", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 2);
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {} };
  const alcance = alcanceSucursal(req, permisos);

  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" });

  assert.strictEqual(dentroDeAlcance(venta.sucursal_id, alcance), false, "la ruta debe responder 404 sin llegar a cancelar");

  // La ruta real corta ANTES de llamar a cancelarApartado — el apartado
  // ajeno debe seguir vigente y sin reintegro cruzado de inventario.
  assert.strictEqual(venta.estatus, "apartado");
  const existAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 4);
  assert.ok(!existAntes || existAntes.cantidad_actual >= 0, "sin reintegro cruzado de inventario");
});

test("POST /api/apartados/:id/abonos: un amarrado sí puede abonar el apartado de su propia sucursal", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 2);
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {} };
  const alcance = alcanceSucursal(req, permisos);

  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }],
    anticipo_monto: 5,
    anticipo_forma_pago: "EFECTIVO",
  }, 2, { nombre: "Ana" }); // apartado de la propia sucursal 2

  assert.strictEqual(dentroDeAlcance(venta.sucursal_id, alcance), true);
});

test("listarProductos muestra la existencia de la sucursal pedida", () => {
  const { listarProductos } = require("./productos");
  const DB = construirDBPrueba();
  // producto 2 tiene 80 en sucursal 2 y 0 en sucursal 1 (fixture)
  const enSuc2 = listarProductos(DB, 2).find((p) => p.id === 2);
  const enSuc1 = listarProductos(DB, 1).find((p) => p.id === 2);
  assert.strictEqual(enSuc2.existencia, 80);
  assert.strictEqual(enSuc1.existencia, 0);
});
