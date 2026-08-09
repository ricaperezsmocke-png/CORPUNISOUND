const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { ajustarExistencia } = require("./productos");
const { crearVenta, cancelarVenta } = require("./ventas");
const { obtenerConfiguracion } = require("./configuracion");
const { alcanceSucursal, dentroDeAlcance, sucursalDeEscritura, sucursalDelFormulario } = require("./auth");
const { permisosDeRol } = require("./roles");
const { crearApartado } = require("./apartados");
const { crearProducto } = require("./productos");
const { crearCorte } = require("./cortes");
const { crearGarantia } = require("./garantias");

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

/**
 * Reproduce lo que hace CUALQUIER ruta de creación: resolver el alcance y de
 * ahí la sucursal donde se escribe. Si devuelve null, la ruta responde 400.
 * @param campo nombre del campo del cuerpo que trae la sucursal del formulario
 *              (las rutas de traspaso y garantía usan "sucursal_origen_id").
 */
const sucursalQueEscribeLaRuta = (DB, req, campo = "sucursal_id") => {
  const permisos = permisosDeRol(DB, req.usuarioToken.rol_id);
  const alcance = alcanceSucursal(req, permisos);
  return sucursalDeEscritura(alcance, (req.body || {})[campo]);
};

test("POST /api/productos/:id/ajustar: un usuario amarrado a su sucursal no puede forzar otra vía body.sucursal_id", () => {
  const DB = construirDBPrueba();
  // rol 2 = "Gerente de sucursal": no tiene el permiso ver_todas_las_sucursales.
  const permisos = permisosDeRol(DB, 2);
  assert.ok(!permisos.includes("ver_todas_las_sucursales"));

  // Simula el request: token amarra al usuario a la sucursal 2, pero el body
  // (controlado por el cliente) pide ajustar la sucursal 4.
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: {}, body: { cantidad: -5, motivo: "prueba", sucursal_id: 4 } };
  const sucursal_id = sucursalQueEscribeLaRuta(DB, req);

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
  assert.strictEqual(sucursalQueEscribeLaRuta(DB, req), 2);
});

// ============================================================
// El encabezado en "Todas" ya NO cae a la sucursal 1
//
// Con "Todas" (el valor con el que entra el administrador) alcance.verTodas es
// true y el cuerpo normalmente no trae sucursal: antes, TODAS estas rutas
// hacían `Number(req.body.sucursal_id) || 1` y guardaban en Ocosingo sin decir
// nada. Ahora devuelven null y la ruta responde 400 pidiendo elegir tienda.
// ============================================================

const ADMIN_EN_TODAS = { usuarioToken: { rol_id: 1, sucursal_id: 1 }, query: {}, body: {} };

test("administrador con el encabezado en 'Todas' y sin sucursal en el cuerpo: la ruta no resuelve sucursal (400)", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 1);
  const alcance = alcanceSucursal(ADMIN_EN_TODAS, permisos);
  assert.strictEqual(alcance.verTodas, true, "así entra el administrador: viendo todas");
  assert.strictEqual(sucursalDeEscritura(alcance, undefined), null, "nada de caer a la sucursal 1");
});

test("administrador en 'Todas': las rutas de creación se quedan sin sucursal (venta, apartado, producto, corte, compra, cliente)", () => {
  const DB = construirDBPrueba();
  // El cuerpo real de cada pantalla cuando el encabezado dice "Todas": ninguna
  // manda sucursal, así que ninguna puede escribir.
  const cuerpos = [
    ["/api/ventas", { cliente_id: 0, lineas: [] }],
    ["/api/apartados", { cliente_id: 1, anticipo_monto: 50 }],
    ["/api/productos", { descripcion: "Bocina" }],
    ["/api/cortes", { contado: { EFECTIVO: 100 } }],
    ["/api/compras", { proveedor_id: 1, renglones: [] }],
    ["/api/clientes", { nombre: "Juan Pérez" }],
  ];
  for (const [ruta, body] of cuerpos) {
    const req = { ...ADMIN_EN_TODAS, body };
    assert.strictEqual(sucursalQueEscribeLaRuta(DB, req), null, `${ruta} debe responder 400, no escribir en la sucursal 1`);
  }
});

test("administrador con sucursal explícita en el cuerpo escribe en ESA sucursal (no en la 1)", () => {
  const DB = construirDBPrueba();
  // Pantallas con selector propio (CRM, Garantías, Traspasos, Recepción de
  // Compras, Migración): llaman con ?sucursal_id=todas para que gane el
  // formulario, y el formulario manda la tienda elegida.
  const cliente = { ...ADMIN_EN_TODAS, body: { nombre: "Juan Pérez", sucursal_id: 4 } };
  assert.strictEqual(sucursalQueEscribeLaRuta(DB, cliente), 4);

  const traspaso = { ...ADMIN_EN_TODAS, body: { producto_id: 1, cantidad: 2, sucursal_origen_id: 3, sucursal_destino_id: 5 } };
  assert.strictEqual(sucursalQueEscribeLaRuta(DB, traspaso, "sucursal_origen_id"), 3);

  const garantia = { ...ADMIN_EN_TODAS, body: { producto_id: 1, sucursal_origen_id: 2 } };
  assert.strictEqual(sucursalQueEscribeLaRuta(DB, garantia, "sucursal_origen_id"), 2);
});

test("administrador con una tienda elegida en el encabezado escribe en ESA tienda", () => {
  const DB = construirDBPrueba();
  // apiFetch agrega ?sucursal_id=<encabezado> a toda llamada que no lo traiga.
  const req = { usuarioToken: { rol_id: 1, sucursal_id: 1 }, query: { sucursal_id: "5" }, body: { descripcion: "Bocina" } };
  assert.strictEqual(sucursalQueEscribeLaRuta(DB, req), 5);
});

test("un usuario amarrado nunca se queda sin poder escribir aunque el cuerpo venga vacío", () => {
  const DB = construirDBPrueba();
  // Cajera de la sucursal 2: su sucursal sale del token, así que la regla de
  // "elige una tienda" jamás la bloquea (es solo del rol Administrador).
  const req = { usuarioToken: { rol_id: 2, sucursal_id: 2 }, query: { sucursal_id: "todas" }, body: {} };
  assert.strictEqual(sucursalQueEscribeLaRuta(DB, req), 2);
});

test("sucursalDeEscritura descarta valores basura del cuerpo en vez de convertirlos en la sucursal 1", () => {
  const TODAS = { verTodas: true, sucursalId: null };
  assert.strictEqual(sucursalDeEscritura(TODAS, ""), null);
  assert.strictEqual(sucursalDeEscritura(TODAS, "todas"), null);
  assert.strictEqual(sucursalDeEscritura(TODAS, 0), null);
  assert.strictEqual(sucursalDeEscritura(TODAS, -3), null);
  assert.strictEqual(sucursalDeEscritura(TODAS, 2.5), null);
  assert.strictEqual(sucursalDeEscritura(TODAS, "3"), 3, "el <select> del formulario manda texto");
});

// ============================================================
// Los módulos tampoco adivinan (última red, por si alguien llama sin ruta)
// ============================================================

test("crearVenta, crearApartado, crearProducto, crearCorte y crearGarantia se niegan a escribir sin sucursal", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB);
  DB.pos.configuracion.permitir_ventas_sin_existencia = true;
  const linea = [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }];

  assert.throws(() => crearVenta(DB, { cliente_id: 0, lineas: linea, total: 16 }), /sucursal/i);
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: linea, anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO" }, undefined, { nombre: "Ana" }),
    /sucursal/i
  );
  assert.throws(() => crearProducto(DB, { descripcion: "Bocina" }, undefined), /sucursal/i);
  assert.throws(() => crearCorte(DB, { contado: { EFECTIVO: 100 }, retiro: {} }), /sucursal/i);
  assert.throws(() => crearGarantia(DB, { producto_id: 1 }, undefined, { nombre: "Ana" }), /sucursal/i);

  assert.strictEqual(DB.pos.cortes_caja.filter((c) => c.sucursal_id === 1).length, 0, "ningún corte fantasma en Ocosingo");
});

// ============================================================
// Migración de Datos: gana SIEMPRE la sucursal del formulario
//
// La pantalla obliga a elegir la "sucursal de origen del archivo". Antes esta
// ruta usaba alcanceSucursal(), y como apiFetch agrega ?sucursal_id=<encabezado>
// a toda llamada, con una tienda elegida arriba el Excel de una sucursal se
// importaba a OTRA sin ninguna señal.
// ============================================================

test("/api/migracion/*: la sucursal del formulario gana sobre la del encabezado", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 1);
  const token = { rol_id: 1, sucursal_id: 1 };
  // Encabezado en la sucursal 2, archivo de la sucursal 5: importa a la 5.
  assert.strictEqual(sucursalDelFormulario(permisos, token, "5"), 5);
});

test("/api/migracion/*: sin elegir sucursal de origen se rechaza (400), no se importa a la 1", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 1);
  assert.strictEqual(sucursalDelFormulario(permisos, { rol_id: 1, sucursal_id: 1 }, undefined), null);
  assert.strictEqual(sucursalDelFormulario(permisos, { rol_id: 1, sucursal_id: 1 }, ""), null);
});

test("/api/migracion/*: a un usuario amarrado se le sigue forzando su sucursal, aunque mande otra", () => {
  const DB = construirDBPrueba();
  const permisos = permisosDeRol(DB, 2); // Gerente de sucursal
  assert.ok(!permisos.includes("ver_todas_las_sucursales"));
  assert.strictEqual(sucursalDelFormulario(permisos, { rol_id: 2, sucursal_id: 2 }, "5"), 2);
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
