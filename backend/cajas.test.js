const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas, cajaPredeterminadaDeSucursal } = require("./cajas");
const { crearVenta } = require("./ventas");
const { calcularCorteEnCurso, crearCorte } = require("./cortes");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

function cajasDe(DB, sucursalId = 4) {
  return {
    administrativa: DB.pos.cajas.find(
      (c) => c.sucursal_id === sucursalId && c.nombre === "Administrativa"
    ),
    fiscal: DB.pos.cajas.find(
      (c) => c.sucursal_id === sucursalId && c.nombre === "Fiscal"
    ),
  };
}

function agregarVenta(DB, { id, caja_id, total, fecha_hora, tipo_documento = "Ticket" }) {
  DB.pos.ventas.push({
    id,
    fecha: fecha_hora.slice(0, 10),
    fecha_hora,
    sucursal_id: 4,
    caja_id,
    cliente_id: 0,
    tipo_documento,
    metodo_pago: "EFECTIVO",
    total,
    estatus: "cerrada",
  });
}

test("sembrarCajas crea exactamente Administrativa y Fiscal por sucursal y es idempotente", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = [];

  sembrarCajas(DB);
  sembrarCajas(DB);

  assert.strictEqual(DB.pos.cajas.length, DB.pos.sucursales.length * 2);
  for (const sucursal of DB.pos.sucursales) {
    const cajas = DB.pos.cajas.filter((c) => c.sucursal_id === sucursal.id);
    assert.deepStrictEqual(cajas.map((c) => c.nombre).sort(), ["Administrativa", "Fiscal"]);
    assert.strictEqual(cajas.filter((c) => c.predeterminada).length, 1);
    assert.strictEqual(cajas.find((c) => c.predeterminada).nombre, "Administrativa");
  }
});

test("cajaPredeterminadaDeSucursal devuelve null si el catalogo esta inconsistente", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);

  administrativa.predeterminada = false;
  assert.strictEqual(cajaPredeterminadaDeSucursal(DB, 4), null);

  administrativa.predeterminada = true;
  fiscal.predeterminada = true;
  assert.strictEqual(cajaPredeterminadaDeSucursal(DB, 4), null);
});

test("sembrarCajas grita si una sucursal no queda con exactamente las dos cajas fijas", () => {
  const DB = prepararDB();
  DB.pos.cajas.push({
    id: 999,
    nombre: "Fiscal",
    sucursal_id: 4,
    predeterminada: false,
  });

  assert.throws(() => sembrarCajas(DB), /exactamente las cajas Administrativa y Fiscal/i);
});

test("crearVenta rechaza una caja de otra sucursal", () => {
  const DB = prepararDB();
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  const cajaAjena = cajasDe(DB, 1).fiscal;

  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 4,
      caja_id: cajaAjena.id,
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }],
      total: 100,
    }),
    /caja.*sucursal/i
  );
  assert.strictEqual(DB.pos.ventas.length, 0);
});

test("crearVenta conserva sus validaciones de negocio si la base no trae sucursales", () => {
  const DB = construirDBPrueba();
  delete DB.pos.sucursales;
  DB.pos.cajas = [];
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };

  assert.deepStrictEqual(sembrarCajas(DB), []);

  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 1,
      vendedor_id: 3,
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }],
      total: 100,
    }),
    /no vende en esta sucursal/i
  );
});

test("crearVenta usa la Administrativa de su sucursal cuando no se declara caja", () => {
  const DB = prepararDB();
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }],
    total: 100,
  });

  assert.strictEqual(venta.caja_id, cajasDe(DB).administrativa.id);
});

test("crearVenta sin catalogo de cajas no lanza y guarda caja_id null", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  delete DB.pos.cajas;
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 70 }],
    total: 70,
  });

  assert.strictEqual(venta.caja_id, null);
});

test("la Administrativa absorbe una venta creada antes de sembrar el catalogo de cajas", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  delete DB.pos.cajas;
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };

  crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 70 }],
    total: 70,
  });
  sembrarCajas(DB);

  const { administrativa, fiscal } = cajasDe(DB);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).total_calculado, 70);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).total_calculado, 0);
});

test("las cajas de una sucursal no se roban ventas", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: administrativa.id, total: 120, fecha_hora: "2026-09-01T10:00:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: fiscal.id, total: 80, fecha_hora: "2026-09-01T10:05:00.000Z" });

  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).total_calculado, 120);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).total_calculado, 80);
});

test("cerrar una caja no mueve la linea de tiempo de la otra", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: administrativa.id, total: 120, fecha_hora: "2026-09-01T10:00:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: fiscal.id, total: 80, fecha_hora: "2026-09-01T10:05:00.000Z" });

  const corteAdministrativa = crearCorte(
    DB,
    { sucursal_id: 4, caja_id: administrativa.id, contado: {}, retiro: {} }
  );

  assert.strictEqual(corteAdministrativa.caja_id, administrativa.id);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).ventas_incluidas, 0);
  const corteFiscal = calcularCorteEnCurso(DB, 4, fiscal.id);
  assert.strictEqual(corteFiscal.ventas_incluidas, 1);
  assert.strictEqual(corteFiscal.total_calculado, 80);
});

test("solo la Administrativa absorbe una venta historica sin caja y no la cuenta dos veces", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: null, total: 70, fecha_hora: "2026-09-01T09:00:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: administrativa.id, total: 30, fecha_hora: "2026-09-01T10:00:00.000Z" });

  const corteAdministrativa = calcularCorteEnCurso(DB, 4, administrativa.id);
  const corteFiscal = calcularCorteEnCurso(DB, 4, fiscal.id);

  assert.strictEqual(corteAdministrativa.ventas_incluidas, 2);
  assert.strictEqual(corteAdministrativa.total_calculado, 100);
  assert.strictEqual(corteFiscal.ventas_incluidas, 0);
  assert.strictEqual(corteFiscal.total_calculado, 0);
});

test("un corte historico sin caja limita el turno de la Administrativa", () => {
  const DB = prepararDB();
  const { administrativa } = cajasDe(DB);
  DB.pos.cortes_caja.push({ id: 1, sucursal_id: 4, caja_id: null, fecha_hora: "2026-09-01T09:30:00.000Z" });
  agregarVenta(DB, { id: 1, caja_id: null, total: 70, fecha_hora: "2026-09-01T09:00:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: null, total: 30, fecha_hora: "2026-09-01T10:00:00.000Z" });

  const corte = calcularCorteEnCurso(DB, 4, administrativa.id);

  assert.strictEqual(corte.desde, "2026-09-01T09:30:00.000Z");
  assert.strictEqual(corte.ventas_incluidas, 1);
  assert.strictEqual(corte.total_calculado, 30);
});

test("los apartados siguen contando por abono real una sola vez con cajas", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  agregarVenta(DB, {
    id: 1,
    caja_id: administrativa.id,
    total: 500,
    fecha_hora: "2026-09-01T10:00:00.000Z",
    tipo_documento: "Apartado",
  });
  DB.pos.apartado_abonos.push({
    id: 1,
    venta_id: 1,
    sucursal_id: 4,
    monto: 125,
    forma_pago: "EFECTIVO",
    fecha_hora: "2026-09-01T10:00:00.000Z",
  });

  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).total_calculado, 125);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).total_calculado, 0);
});

test("los gastos en efectivo usan la ventana temporal de la caja correcta", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  DB.pos.cortes_caja.push({
    id: 1,
    sucursal_id: 4,
    caja_id: administrativa.id,
    fecha_hora: "2026-09-01T11:00:00.000Z",
  });
  DB.pos.cortes_caja.push({
    id: 2,
    sucursal_id: 4,
    caja_id: fiscal.id,
    fecha_hora: "2026-09-01T09:00:00.000Z",
  });
  DB.gastos.gastos.push({
    id: 1,
    sucursal_id: 4,
    monto: 40,
    forma_pago: "EFECTIVO",
    estatus: "activo",
    fecha_hora: "2026-09-01T10:00:00.000Z",
  });

  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).gastos_efectivo, 0);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).gastos_efectivo, 40);
});

/**
 * La red de seguridad de todo este trabajo.
 *
 * Donde el concepto de caja no existe —una base sin catalogo sembrado, o
 * cualquier prueba historica— el corte tiene que comportarse EXACTAMENTE como
 * antes: agrupar por sucursal y tiempo, sin filtrar por caja. Si esto se
 * rompe, se rompen de golpe todas las cuentas que ya funcionaban: apartados,
 * gastos y el calculado del turno.
 *
 * Ya paso una vez: al hacer que la resolucion devolviera null sin catalogo, el
 * corte le leyo `.predeterminada` a ese null y cayeron 13 pruebas del dinero.
 */
test("sin catalogo de cajas, el corte se comporta igual que antes de existir las cajas", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = []; // sin sembrar a proposito

  agregarVenta(DB, { id: 1, caja_id: null, total: 100, fecha_hora: "2026-09-01T10:00:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: null, total: 250, fecha_hora: "2026-09-01T11:00:00.000Z" });

  const enCurso = calcularCorteEnCurso(DB, 4);

  assert.strictEqual(
    enCurso.calculado.EFECTIVO, 350,
    "sin catalogo, el turno son todas las ventas de la sucursal, como siempre"
  );
  assert.strictEqual(enCurso.ventas_incluidas, 2);
});

test("sin catalogo de cajas, los abonos de apartados se siguen contando", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.cajas = [];
  DB.pos.apartado_abonos = [
    { id: 1, sucursal_id: 4, venta_id: 99, monto: 500, forma_pago: "EFECTIVO", fecha_hora: "2026-09-01T10:00:00.000Z" },
  ];

  const enCurso = calcularCorteEnCurso(DB, 4);

  assert.strictEqual(
    enCurso.calculado.EFECTIVO, 500,
    "el dinero de un abono no puede desaparecer porque no haya catalogo de cajas"
  );
});
