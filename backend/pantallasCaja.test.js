const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { PANTALLAS, estaActiva, cambiarPantalla, dineroSinCortar, estadoPantallas } = require("./pantallasCaja");

const USUARIO = { id: 9, nombre: "Victor" };

function prepararDB({ conVentas = true } = {}) {
  const DB = construirDBPrueba();
  if (!conVentas) DB.pos.ventas = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

function apagarTodoMenosCorte(DB) {
  for (const p of PANTALLAS.filter((x) => x !== "corte_caja")) cambiarPantalla(DB, { pantalla: p, activa: false }, USUARIO);
}

test("sin nada guardado todas las pantallas cuentan como encendidas", () => {
  const DB = prepararDB();
  for (const p of PANTALLAS) assert.equal(estaActiva(DB, p), true, p);
});

test("un valor guardado que no es booleano cuenta como apagado (falla cerrando)", () => {
  const DB = prepararDB();
  DB.pos.pantallas_caja = { estado: { punto_venta: "false", gastos_caja: 0, depositos: null, corte_caja: true }, historial: [] };
  assert.equal(estaActiva(DB, "punto_venta"), false);
  assert.equal(estaActiva(DB, "gastos_caja"), false);
  assert.equal(estaActiva(DB, "depositos"), false);
  assert.equal(estaActiva(DB, "corte_caja"), true);
  assert.equal(estaActiva(DB, "dinero_garantias_caja"), true, "la clave ausente sigue encendida");
});

test("pantalla desconocida o activa no booleano se rechazan con 400", () => {
  const DB = prepararDB();
  for (const datos of [{ pantalla: "inventario", activa: false }, { pantalla: "punto_venta", activa: "false" }, {}]) {
    assert.throws(() => cambiarPantalla(DB, datos, USUARIO), (e) => e.status === 400);
  }
});

test("no se apaga el corte mientras otra pantalla de dinero siga encendida", () => {
  const DB = prepararDB({ conVentas: false });
  assert.throws(() => cambiarPantalla(DB, { pantalla: "corte_caja", activa: false }, USUARIO),
    (e) => e.status === 409 && /Punto de Venta/.test(e.message));
});

test("no se apaga el corte si hay dinero sin cortar, y dice en qué tienda", () => {
  const DB = prepararDB({ conVentas: true });
  apagarTodoMenosCorte(DB);
  const pendientes = dineroSinCortar(DB);
  assert.ok(pendientes.some((p) => p.sucursal_id === 1), "la venta histórica sin caja_id de Ocosingo cuenta");
  assert.throws(() => cambiarPantalla(DB, { pantalla: "corte_caja", activa: false }, USUARIO),
    (e) => e.status === 409 && /Ocosingo/.test(e.message));
  assert.equal(estaActiva(DB, "corte_caja"), true);
});

test("la caja de MercadoLibre no cuenta como dinero sin cortar", () => {
  const DB = prepararDB({ conVentas: false });
  DB.pos.ventas.push({ id: 50, fecha: "2026-10-01", fecha_hora: "2026-10-01T10:00:00.000Z", sucursal_id: 5, total: 300,
    metodo_pago: "MERCADOLIBRE", estatus: "cerrada" });
  assert.deepEqual(dineroSinCortar(DB), []);
  apagarTodoMenosCorte(DB);
  cambiarPantalla(DB, { pantalla: "corte_caja", activa: false }, USUARIO);
  assert.equal(estaActiva(DB, "corte_caja"), false);
});

test("con el corte apagado no se enciende ninguna pantalla que mueva dinero", () => {
  const DB = prepararDB({ conVentas: false });
  apagarTodoMenosCorte(DB);
  cambiarPantalla(DB, { pantalla: "corte_caja", activa: false }, USUARIO);
  for (const p of PANTALLAS.filter((x) => x !== "corte_caja")) {
    assert.throws(() => cambiarPantalla(DB, { pantalla: p, activa: true }, USUARIO), (e) => e.status === 409, p);
  }
  cambiarPantalla(DB, { pantalla: "corte_caja", activa: true }, USUARIO);
  cambiarPantalla(DB, { pantalla: "punto_venta", activa: true }, USUARIO);
  assert.equal(estaActiva(DB, "punto_venta"), true);
});

test("cada cambio queda en el historial con quién, cuándo y de qué a qué; repetir no ensucia", () => {
  const DB = prepararDB({ conVentas: false });
  cambiarPantalla(DB, { pantalla: "punto_venta", activa: false }, USUARIO);
  cambiarPantalla(DB, { pantalla: "punto_venta", activa: false }, USUARIO);
  const { historial, pantallas } = estadoPantallas(DB);
  assert.equal(pantallas.punto_venta, false);
  assert.equal(historial.length, 1);
  const [h] = historial;
  assert.equal(h.pantalla, "punto_venta");
  assert.equal(h.de, true);
  assert.equal(h.a, false);
  assert.equal(h.usuario_id, 9);
  assert.equal(h.usuario_nombre, "Victor");
  assert.match(h.fecha_hora, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
