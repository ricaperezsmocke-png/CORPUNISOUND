/**
 * Reproducciones de la auditoria de dinero 2026-09.
 *
 * NO es una prueba de regresion: cada caso AFIRMA EL DEFECTO tal como existe
 * hoy en master (9fdf45d). Cuando se arregle, el caso correspondiente se pone
 * rojo, y eso es lo esperado.
 *
 * Correr desde backend/ (para que dotenv encuentre su .env):
 *   cd backend
 *   node --preserve-symlinks --preserve-symlinks-main --test ../docs/auditorias/2026-09-dinero/reproducir.test.cjs
 *
 * Levanta el servidor real en un puerto libre con una base temporal y ataca la
 * API con tokens de los roles sembrados: 2 = Gerente de sucursal, 3 = Cajero.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND = path.join(__dirname, "..", "..", "..", "backend");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auditoria-dinero-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require(path.join(BACKEND, "server"));
const { sembrarCuentas } = require(path.join(BACKEND, "testHelpers"));
const { firmarToken } = require(path.join(BACKEND, "auth"));
const { calcularCorteEnCurso, crearCorte } = require(path.join(BACKEND, "cortes"));
const { agregarGasto } = require(path.join(BACKEND, "garantiasGastos"));

const CAJERA = firmarToken({ id: 901, nombre: "Cajera Ocosingo", rol_id: 3, sucursal_id: 1 });
const GERENTE = firmarToken({ id: 902, nombre: "Gerente Ocosingo", rol_id: 2, sucursal_id: 1 });
const GUITARRA = 9001;

let servidor = null;
let base = "";

function api(token, metodo, ruta, cuerpo) {
  return fetch(`${base}/api${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

/** Lo que el corte de la caja predeterminada de Ocosingo espera en efectivo. */
const efectivoEsperado = () => calcularCorteEnCurso(app.DB, 1, null).calculado.EFECTIVO;
const existencia = () => app.DB.inventario.existencias
  .find((e) => e.producto_id === GUITARRA && e.sucursal_id === 1).cantidad_actual;

/** Deja el turno en cero para que cada caso mida solo lo suyo. */
function cerrarTurno() {
  crearCorte(app.DB, { sucursal_id: 1, caja_id: null, usuario_nombre: "auditoria", contado: {}, retiro: {} });
}

before(async () => {
  sembrarCuentas(app, [
    { id: 901, nombre: "Cajera Ocosingo", rol_id: 3, sucursal_id: 1 },
    { id: 902, nombre: "Gerente Ocosingo", rol_id: 2, sucursal_id: 1 },
  ]);
  app.DB["catalogo-productos"].productos.push({
    id: GUITARRA, sku: "GTR-AUD", nombre: "Guitarra de auditoria", precio_venta: 12000, costo: 8000, activo: true,
  });
  app.DB.inventario.existencias.push({ producto_id: GUITARRA, sucursal_id: 1, cantidad_actual: 50 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

test("H1: la cajera se da de alta un cliente con $12,000 de monedero y se lleva la guitarra sin que el corte espere un peso", async () => {
  cerrarTurno();
  const alta = await api(CAJERA, "POST", "/clientes", { nombre: "Primo de la cajera", monedero: 12000 });
  assert.equal(alta.status, 200, JSON.stringify(alta.body));
  assert.equal(alta.body.monedero, 12000, "el servidor acepto el saldo que mando la cajera");

  const antes = existencia();
  const venta = await api(CAJERA, "POST", "/ventas", {
    cliente_id: alta.body.id, metodo_pago: "EFECTIVO", monedero_aplicado: 12000,
    lineas: [{ producto_id: GUITARRA, cantidad: 1 }],
  });
  assert.equal(venta.status, 200, JSON.stringify(venta.body));
  console.log("H1 venta:", { total: venta.body.total, monedero_aplicado: venta.body.monedero_aplicado });
  assert.equal(existencia(), antes - 1, "la guitarra salio del inventario");
  assert.equal(efectivoEsperado(), 0, "el corte no espera nada de efectivo por la guitarra");
});

test("H2: la cajera manda tipo_documento 'Apartado' en una venta normal y el corte no la cobra nunca", async () => {
  cerrarTurno();
  const antes = existencia();
  const venta = await api(CAJERA, "POST", "/ventas", {
    tipo_documento: "Apartado", metodo_pago: "EFECTIVO", lineas: [{ producto_id: GUITARRA, cantidad: 1 }],
  });
  assert.equal(venta.status, 200, JSON.stringify(venta.body));
  console.log("H2 venta:", { total: venta.body.total, estatus: venta.body.estatus, tipo: venta.body.tipo_documento });
  assert.equal(venta.body.total, 11280, "12,000 con 6% de efectivo");
  assert.equal(existencia(), antes - 1, "la guitarra salio del inventario");
  assert.equal(efectivoEsperado(), 0, "el corte excluye todo lo que diga 'Apartado'");
  assert.equal(app.DB.pos.apartado_abonos.filter((a) => a.venta_id === venta.body.id).length, 0, "y no hay abono que lo cobre");

  const lista = await api(GERENTE, "GET", "/apartados");
  assert.ok(!lista.body.some((a) => a.id === venta.body.id), "tampoco aparece en la lista de apartados");
  const cancelar = await api(GERENTE, "PUT", `/ventas/${venta.body.id}/cancelar`, { motivo: "prueba" });
  assert.equal(cancelar.status, 400, "ni se puede cancelar: se enruta a cancelarApartado y rebota");
  console.log("H2 cancelar:", cancelar.body);
});

test("H3: F3 'Cambiar precio' baja el precio en pantalla; el servidor guarda el de catalogo y el faltante cae en la cajera", async () => {
  cerrarTurno();
  // Es exactamente el cuerpo que arma PuntoDeVenta.jsx tras F3 = 9,000 en TARJETA (0% de descuento).
  const venta = await api(GERENTE, "POST", "/ventas", {
    metodo_pago: "TARJETA", subtotal: 9000, descuento: 0, total: 9000,
    lineas: [{ producto_id: GUITARRA, cantidad: 1, precio_unitario: 9000, descuento_pct: 0 }],
  });
  assert.equal(venta.status, 200, JSON.stringify(venta.body));
  console.log("H3 pantalla cobro 9000; servidor guardo:", venta.body.total);
  assert.equal(venta.body.total, 12000, "el servidor ignora el precio y el total de la pantalla SIN avisar");
  assert.equal(calcularCorteEnCurso(app.DB, 1, null).calculado.TARJETA, 12000, "el corte espera 12,000 en tarjeta");
});

test("H4: el gerente cobra, cancela en el mismo turno sin motivo, y el corte deja de esperar el dinero", async () => {
  cerrarTurno();
  const antes = existencia();
  const venta = await api(GERENTE, "POST", "/ventas", {
    metodo_pago: "EFECTIVO", lineas: [{ producto_id: GUITARRA, cantidad: 1 }],
  });
  assert.equal(efectivoEsperado(), 11280);
  const cancelar = await api(GERENTE, "PUT", `/ventas/${venta.body.id}/cancelar`, {});
  assert.equal(cancelar.status, 200, JSON.stringify(cancelar.body));
  console.log("H4 cancelada:", { motivo: cancelar.body.motivo_cancelacion, por: cancelar.body.cancelada_por });
  assert.equal(cancelar.body.motivo_cancelacion, "", "se acepta sin motivo");
  assert.equal(efectivoEsperado(), 0, "el corte ya no espera los 11,280");
  assert.equal(existencia(), antes, "y el sistema dice que la guitarra sigue en tienda");
  assert.equal(calcularCorteEnCurso(app.DB, 1, null).cancelado_de_cortes_anteriores, 0, "sin aviso: no la conto ningun corte");
});

test("H5: la venta no guarda quien la cobro", async () => {
  const venta = await api(CAJERA, "POST", "/ventas", {
    metodo_pago: "EFECTIVO", lineas: [{ producto_id: GUITARRA, cantidad: 1 }],
  });
  const campos = Object.keys(venta.body);
  console.log("H5 campos de la venta:", campos.join(", "));
  assert.ok(!campos.some((c) => /usuario|cajer|cobrad|creada_por/i.test(c)), "ningun campo dice quien cobro");
});

test("H6: el gerente sube el descuento de efectivo de su tienda al 30% y no queda bitacora de quien lo hizo", async () => {
  cerrarTurno();
  const condicion = app.DB.pos.condiciones_pago.find((c) => c.sucursal_id === 1 && c.nombre === "EFECTIVO");
  const r = await api(GERENTE, "PUT", `/condiciones-pago/${condicion.id}`, { descuento_pct: 30 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ["activo", "descuento_pct", "id", "nombre", "sucursal_id"],
    "la condicion no guarda quien ni cuando la cambio");
  const venta = await api(CAJERA, "POST", "/ventas", {
    metodo_pago: "EFECTIVO", lineas: [{ producto_id: GUITARRA, cantidad: 1 }],
  });
  console.log("H6 venta en efectivo con 30%:", venta.body.total);
  assert.equal(efectivoEsperado(), 8400, "el corte espera 8,400 por una guitarra de 12,000");
  await api(GERENTE, "PUT", `/condiciones-pago/${condicion.id}`, { descuento_pct: 6 });
});

test("H7: lo que se deja en el cajon despues del retiro no lo espera el siguiente corte", async () => {
  cerrarTurno();
  await api(CAJERA, "POST", "/ventas", { metodo_pago: "EFECTIVO", lineas: [{ producto_id: GUITARRA, cantidad: 1 }] });
  // Se contaron 11,280 y se retiraron 10,000: quedan 1,280 fisicos en el cajon.
  const corte = crearCorte(app.DB, {
    sucursal_id: 1, caja_id: null, usuario_nombre: "Cajera turno 1",
    contado: { EFECTIVO: 11280 }, retiro: { EFECTIVO: 10000 },
  });
  assert.equal(corte.diferencia.EFECTIVO, 0);
  console.log("H7 siguiente turno espera en efectivo:", efectivoEsperado());
  assert.equal(efectivoEsperado(), 0, "el turno 2 arranca esperando 0 aunque hay 1,280 en el cajon");
  // El retiro tampoco se valida contra lo contado.
  const raro = crearCorte(app.DB, {
    sucursal_id: 1, caja_id: null, usuario_nombre: "x", contado: { EFECTIVO: 0 }, retiro: { EFECTIVO: 50000 },
  });
  assert.equal(raro.retiro.EFECTIVO, 50000, "se acepta retirar 50,000 de un cajon contado en 0");
});

test("H8: un gasto de garantia en efectivo baja lo que el corte espera sin comprobante", async () => {
  cerrarTurno();
  app.DB.inventario.garantias.push({ id: 7001, folio: "GAR-AUD", sucursal_origen_id: 1, cliente_id: null, estatus: "recibida" });
  const antes = efectivoEsperado();
  await agregarGasto(app.DB, 7001, { tipo: "traslado", monto: 3000, forma_pago: "EFECTIVO" },
    { id: 902, nombre: "Gerente Ocosingo" }, { verTodas: false, sucursalId: 1 }, {});
  console.log("H8 efectivo esperado antes/despues:", antes, efectivoEsperado());
  assert.equal(efectivoEsperado(), antes - 3000);
  const gasto = app.DB.inventario.garantia_gastos.at(-1);
  assert.equal(gasto.drive_file_id, null, "sin comprobante");
});
