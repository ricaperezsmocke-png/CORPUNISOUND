const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { crearApartado, cancelarApartado, procesarVencimientos } = require("./apartados");

const LINEAS = [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }];

function apartadoDePrueba(DB, extra = {}) {
  return crearApartado(
    DB,
    { cliente_id: 1, lineas: LINEAS, anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO", ...extra },
    1,
    { nombre: "Ana" }
  );
}

/**
 * Cancelar un apartado es el mismo fraude que cancelar una venta cobrada —la
 * mercancia vuelve al inventario y el dinero ya contado desaparece del corte—
 * pero SIN NINGUN RASTRO: la ruta llamaba a `cancelarApartado(DB, id, motivo)`
 * sin pasar el usuario, a diferencia de `cancelarVenta`. Quedaba
 * `cancelada_por: undefined`.
 */
test("cancelar un apartado registra quien lo hizo y cuando", () => {
  const DB = construirDBPrueba();
  const apartado = apartadoDePrueba(DB);

  cancelarApartado(DB, apartado.id, "el cliente no volvio", { nombre: "Gerente Ocosingo" });

  const guardado = DB.pos.ventas.find((v) => v.id === apartado.id);
  assert.strictEqual(guardado.estatus, "cancelada");
  assert.strictEqual(guardado.cancelada_por, "Gerente Ocosingo");
  assert.ok(guardado.fecha_hora_cancelacion, "tiene que quedar la hora");
  assert.strictEqual(guardado.motivo_cancelacion, "el cliente no volvio");
});

/**
 * Sin usuario NO se guarda `undefined`: se guarda la misma marca que usa
 * cancelarVenta. Un campo ausente y uno con "—" se leen distinto en una
 * auditoria: el primero parece que nadie lo escribio nunca.
 */
test("cancelar sin usuario deja la misma marca que una venta", () => {
  const DB = construirDBPrueba();
  const apartado = apartadoDePrueba(DB);

  cancelarApartado(DB, apartado.id, "sin usuario");

  const guardado = DB.pos.ventas.find((v) => v.id === apartado.id);
  assert.strictEqual(guardado.cancelada_por, "—");
  assert.ok(guardado.fecha_hora_cancelacion);
});

/**
 * El vencimiento automatico corre SOLO, a los 60 dias, cada vez que alguien
 * abre la pantalla de Apartados. Si no dice que fue el sistema, un apartado
 * grande que se deja vencer se lee igual que uno cancelado por una persona — o
 * peor, que uno que nadie cancelo. Basta con dejar vencer uno para llevarse el
 * anticipo sin que quede a nombre de nadie.
 */
test("el vencimiento automatico se registra como del sistema", () => {
  const DB = construirDBPrueba();
  const apartado = apartadoDePrueba(DB);
  DB.pos.ventas.find((v) => v.id === apartado.id).fecha_limite = "2020-01-01";

  procesarVencimientos(DB);

  const guardado = DB.pos.ventas.find((v) => v.id === apartado.id);
  assert.strictEqual(guardado.estatus, "cancelada");
  assert.match(String(guardado.cancelada_por), /sistema/i);
  assert.ok(guardado.fecha_hora_cancelacion, "tiene que quedar la hora");
});

/** La red: cancelar un apartado sigue haciendo lo que hacia. */
test("cancelar sigue devolviendo la mercancia y el anticipo al monedero", () => {
  const DB = construirDBPrueba();
  const existenciaAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  const apartado = apartadoDePrueba(DB);

  cancelarApartado(DB, apartado.id, "prueba", { nombre: "Ana" });

  const existenciaDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existenciaDespues, existenciaAntes, "la mercancia vuelve completa");
  assert.strictEqual(DB.crm.clientes.find((c) => c.id === 1).monedero, 20);
});
