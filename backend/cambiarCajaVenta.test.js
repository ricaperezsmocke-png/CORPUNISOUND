const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { construirDBPrueba, sembrarCuentas } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { calcularCorteEnCurso } = require("./cortes");
const { cambiarCajaVenta } = require("./ventas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [{
    id: 20,
    fecha: "2026-09-01",
    fecha_hora: "2026-09-01T10:00:00.000Z",
    sucursal_id: 4,
    caja_id: null,
    cliente_id: 0,
    tipo_documento: "Ticket",
    metodo_pago: "EFECTIVO",
    total: 350,
    estatus: "cerrada",
  }];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

function cajasDe(DB, sucursalId = 4) {
  return {
    administrativa: DB.pos.cajas.find((c) => c.sucursal_id === sucursalId && c.nombre === "Administrativa"),
    fiscal: DB.pos.cajas.find((c) => c.sucursal_id === sucursalId && c.nombre === "Fiscal"),
  };
}

const usuario = { id: 81, nombre: "Encargada Palenque" };

test("corrige una venta no cortada y la mueve al turno de la caja destino", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);

  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).total_calculado, 350);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).total_calculado, 0);

  cambiarCajaVenta(DB, 20, fiscal.id, usuario);

  assert.strictEqual(DB.pos.ventas[0].caja_id, fiscal.id);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).total_calculado, 0);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).total_calculado, 350);
});

test("rechaza cambiar una venta ya incluida en el corte de su caja y no altera el corte", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  DB.pos.ventas[0].caja_id = administrativa.id;
  const corte = {
    id: 30,
    sucursal_id: 4,
    caja_id: administrativa.id,
    fecha_hora: "2026-09-01T11:00:00.000Z",
    total_calculado: 350,
    ventas_incluidas: 1,
  };
  DB.pos.cortes_caja.push(corte);
  const foto = JSON.stringify(corte);

  assert.throws(
    () => cambiarCajaVenta(DB, 20, fiscal.id, usuario),
    /ya forma parte de un corte cerrado.*totales hist[oó]ricos/i
  );
  assert.strictEqual(DB.pos.ventas[0].caja_id, administrativa.id);
  assert.strictEqual(JSON.stringify(DB.pos.cortes_caja[0]), foto);
});

test("rechaza un destino cuyo ultimo corte es posterior a la venta para que el dinero no desaparezca", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);
  DB.pos.ventas[0].caja_id = administrativa.id;
  DB.pos.cortes_caja.push({
    id: 31,
    sucursal_id: 4,
    caja_id: fiscal.id,
    fecha_hora: "2026-09-01T10:30:00.000Z",
  });

  assert.throws(
    () => cambiarCajaVenta(DB, 20, fiscal.id, usuario),
    /destino.*ya cerr[oó].*no aparecer[ií]a en ning[uú]n corte/i
  );
  assert.strictEqual(DB.pos.ventas[0].caja_id, administrativa.id);
});

test("rechaza una caja destino de otra sucursal", () => {
  const DB = prepararDB();
  const fiscalAjena = cajasDe(DB, 1).fiscal;

  assert.throws(
    () => cambiarCajaVenta(DB, 20, fiscalAjena.id, usuario),
    /caja.*sucursal/i
  );
  assert.strictEqual(DB.pos.ventas[0].caja_id, null);
});

test("evalua una venta sin caja contra el corte de la predeterminada", () => {
  const DB = prepararDB();
  const { fiscal } = cajasDe(DB);
  delete DB.pos.ventas[0].fecha_hora;
  DB.pos.cortes_caja.push({
    id: 32,
    sucursal_id: 4,
    caja_id: null,
    fecha_hora: "2026-09-01T00:00:00.000Z",
  });

  assert.throws(
    () => cambiarCajaVenta(DB, 20, fiscal.id, usuario),
    /ya forma parte de un corte cerrado/i
  );
  assert.strictEqual(DB.pos.ventas[0].caja_id, null);
});

test("deja constancia de quien cambio la caja, cuando y de cual a cual", () => {
  const DB = prepararDB();
  const { administrativa, fiscal } = cajasDe(DB);

  const venta = cambiarCajaVenta(DB, 20, fiscal.id, usuario);

  assert.strictEqual(venta.cambios_caja.length, 1);
  assert.deepStrictEqual(
    { ...venta.cambios_caja[0], fecha_hora: undefined },
    {
      usuario_id: usuario.id,
      usuario_nombre: usuario.nombre,
      caja_origen_id: administrativa.id,
      caja_origen_nombre: administrativa.nombre,
      caja_destino_id: fiscal.id,
      caja_destino_nombre: fiscal.nombre,
      fecha_hora: undefined,
    }
  );
  assert.match(venta.cambios_caja[0].fecha_hora, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!Number.isNaN(Date.parse(venta.cambios_caja[0].fecha_hora)));
});

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cambiar-caja-venta-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { firmarToken } = require("./auth");

const SIN_PERMISO = firmarToken({ id: 82, nombre: "Sin permiso", rol_id: 982, sucursal_id: 1 });
let servidor = null;
let base = "";

before(async () => {
  app.DB.admin.roles.push({ id: 982, nombre: "Sin cambiar caja", permisos: [], modulos: ["pos"] });
  sembrarCuentas(app, [{ id: 82, nombre: "Sin permiso", rol_id: 982, sucursal_id: 1 }]);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

test("la ruta rechaza con 403 a quien no tiene cambiar_caja_venta", async () => {
  const respuesta = await fetch(`${base}/api/ventas/1/caja`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${SIN_PERMISO}`, "Content-Type": "application/json" },
    body: JSON.stringify({ caja_id: 1 }),
  });

  assert.strictEqual(respuesta.status, 403);
});
