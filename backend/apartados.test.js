const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { obtenerConfiguracion } = require("./configuracion");
const {
  crearApartado, registrarAbono, cancelarApartado, procesarVencimientos,
  listarApartados, obtenerApartadosProximosAVencer, saldoPendiente,
} = require("./apartados");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

function lineasBase() {
  return [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }];
}

test("crearApartado: rechaza cliente Público en General (id 0)", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 0, lineas: lineasBase(), anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /cliente/i
  );
});

test("crearApartado: rechaza anticipo en $0", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 0, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /anticipo/i
  );
});

test("crearApartado: rechaza CRÉDITO como forma de pago del anticipo", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 10, anticipo_forma_pago: "CRÉDITO" }, 1, { nombre: "Ana" }),
    /crédito/i
  );
});

test("registrarAbono: rechaza CRÉDITO como forma de pago del abono", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  assert.throws(
    () => registrarAbono(DB, venta.id, { monto: 5, forma_pago: "CRÉDITO" }, { nombre: "Ana" }),
    /crédito/i
  );
});

test("crearApartado: rechaza un anticipo mayor al total del apartado", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }], anticipo_monto: 999, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /anticipo/i
  );
});

test("crearApartado: rechaza apartar más de lo que hay en existencia", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB); // inicializa config
  DB.pos.configuracion.permitir_ventas_sin_existencia = false; // forzar bloqueo por stock en la prueba
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: [{ producto_id: 1, cantidad: 9999, precio_unitario: 25, descuento_pct: 0 }], anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /existencia/i
  );
});

test("crearApartado: descuenta existencia de inmediato y crea el primer abono (el anticipo)", () => {
  const DB = construirDBPrueba();
  const existenciaAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;

  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  assert.strictEqual(venta.tipo_documento, "Apartado");
  assert.strictEqual(venta.estatus, "apartado");
  assert.strictEqual(venta.cliente_id, 1);
  assert.strictEqual(venta.total, 50, "2 x $25");
  assert.ok(venta.fecha_limite > venta.fecha, "la fecha límite debe ser posterior a la de creación");

  const existenciaDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existenciaDespues, existenciaAntes - 2);

  assert.strictEqual(DB.pos.apartado_abonos.length, 1);
  assert.strictEqual(DB.pos.apartado_abonos[0].monto, 20);
  assert.strictEqual(DB.pos.apartado_abonos[0].forma_pago, "EFECTIVO");
  assert.strictEqual(saldoPendiente(DB, venta), 30);
});

test("registrarAbono: rechaza un abono mayor al saldo pendiente", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  assert.throws(
    () => registrarAbono(DB, venta.id, { monto: 100, forma_pago: "TARJETA" }, { nombre: "Ana" }),
    /saldo/i
  );
});

test("registrarAbono: acumula el abono y liquida automáticamente cuando cubre el saldo restante", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  registrarAbono(DB, venta.id, { monto: 30, forma_pago: "TARJETA" }, { nombre: "Ana" });

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "cerrada");
  assert.ok(actualizada.fecha_liquidacion);
  assert.strictEqual(DB.pos.apartado_abonos.length, 2);
  assert.strictEqual(DB.pos.apartado_abonos[1].forma_pago, "TARJETA");
});

test("registrarAbono: rechaza abonar un apartado que ya no está vigente", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 50, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  assert.throws(
    () => registrarAbono(DB, venta.id, { monto: 10, forma_pago: "EFECTIVO" }, { nombre: "Ana" }),
    /vigente/i
  );
});

test("cancelarApartado: reintegra existencia y abona lo ya pagado al monedero del cliente", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const existenciaAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;

  cancelarApartado(DB, venta.id, "El cliente ya no lo quiere");

  const existenciaDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existenciaDespues, existenciaAntes + 2);

  const cliente = DB.crm.clientes.find((c) => c.id === 1);
  assert.strictEqual(cliente.monedero, 20);

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "cancelada");
  assert.strictEqual(actualizada.motivo_cancelacion, "El cliente ya no lo quiere");
});

test("procesarVencimientos: cancela automáticamente y abona al monedero un apartado pasados los 60 días", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  DB.pos.ventas.find((v) => v.id === venta.id).fecha_limite = "2000-01-01"; // fuerza que ya venció

  procesarVencimientos(DB);

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "cancelada");
  assert.strictEqual(actualizada.motivo_cancelacion, "Vencido — 60 días sin liquidar");
  const cliente = DB.crm.clientes.find((c) => c.id === 1);
  assert.strictEqual(cliente.monedero, 20);
});

test("procesarVencimientos: no toca apartados que todavía están dentro del límite", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  procesarVencimientos(DB);

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "apartado");
});

test("listarApartados: solo devuelve los vigentes (ya corrió el vencimiento automático primero)", () => {
  const DB = construirDBPrueba();
  const vigente = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  DB.inventario.existencias.push({ producto_id: 2, sucursal_id: 1, cantidad_actual: 10, cantidad_minima: 0, cantidad_maxima: 0 });
  const vencido = crearApartado(DB, { cliente_id: 1, lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }], anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  DB.pos.ventas.find((v) => v.id === vencido.id).fecha_limite = "2000-01-01";

  const lista = listarApartados(DB, ALCANCE_TODAS);

  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].id, vigente.id);
  assert.strictEqual(lista[0].saldo_pendiente, 30);
  assert.strictEqual(lista[0].cliente_nombre, "Abarrotes Mary");
  assert.strictEqual(lista[0].abonos.length, 1);
});

test("listarApartados: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  crearApartado(DB, { cliente_id: 2, lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }], anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO" }, 2, { nombre: "María" });

  const lista = listarApartados(DB, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(lista.length, 1);
});

test("obtenerApartadosProximosAVencer: respeta el umbral de 7 días y no repite si ya hay contacto registrado", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const en5Dias = new Date();
  en5Dias.setDate(en5Dias.getDate() + 5);
  DB.pos.ventas.find((v) => v.id === venta.id).fecha_limite = en5Dias.toISOString().slice(0, 10);

  let lista = obtenerApartadosProximosAVencer(DB, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].venta_id, venta.id);
  assert.strictEqual(lista[0].cliente_nombre, "Abarrotes Mary");

  DB.crm.contactos_cliente.push({ id: 1, cliente_id: 1, fecha: "2026-07-21", tipo: "apartado_por_vencer", resultado: null, venta_id: venta.id });
  lista = obtenerApartadosProximosAVencer(DB, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 0, "ya no debe aparecer si ya se registró el contacto");
});

test("obtenerApartadosProximosAVencer: no incluye apartados con más de 7 días restantes", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const lista = obtenerApartadosProximosAVencer(DB, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 0, "recién creado, faltan 60 días");
});
