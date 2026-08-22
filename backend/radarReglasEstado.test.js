const test = require("node:test");
const assert = require("node:assert/strict");

const { crearDemanda, cambiarEstado, actualizarDemanda } = require("./radarDemanda");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      vendedores: [{ id: 10, nombre: "Ana", sucursal_id: 1 }],
      ventas: [
        { id: 500, sucursal_id: 1, estatus: "cerrada" },
        { id: 501, sucursal_id: 1, estatus: "cerrada" },
      ],
    },
    admin: { usuarios: [{ id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: 10, activo: true }] },
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }] },
    "catalogo-productos": { productos: [{ id: 30, sku: "GTR-001", nombre: "Guitarra Roja" }] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const contexto = { usuarioId: 100, sucursalId: 1 };
const alcance = { verTodas: true };
const datos = { producto_id: 30, cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA" };

function crearConvertida(DB, ventaId = 500) {
  const demanda = crearDemanda(DB, datos, contexto);
  cambiarEstado(DB, demanda.id, "CONVERTIDA", { venta_recuperada_id: ventaId }, alcance, 100);
  return demanda;
}

test("no se puede dar por convertida una demanda sin venta", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  assert.throws(
    () => cambiarEstado(DB, demanda.id, "CONVERTIDA", {}, alcance, 100),
    /venta/i
  );
  assert.equal(DB.radar_demanda.registros[0].estado, "REGISTRADA", "el estado no debió moverse");
});

test("con su venta sí se convierte", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  const cerrada = cambiarEstado(DB, demanda.id, "CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100);
  assert.equal(cerrada.estado, "CONVERTIDA");
  assert.equal(cerrada.venta_recuperada_id, 500);
});

test("la misma venta no puede recuperar dos demandas", () => {
  const DB = construirDB();
  const primera = crearDemanda(DB, datos, contexto);
  const segunda = crearDemanda(DB, datos, contexto);
  cambiarEstado(DB, primera.id, "CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100);
  assert.throws(
    () => cambiarEstado(DB, segunda.id, "CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100),
    /ya est/i
  );
  assert.equal(DB.radar_demanda.registros[1].estado, "REGISTRADA");
});

test("una demanda puede conservar su propia venta al editarse", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  cambiarEstado(DB, demanda.id, "CONVERTIDA", { venta_recuperada_id: 501 }, alcance, 100);
  const { actualizarDemanda } = require("./radarDemanda");
  const editada = actualizarDemanda(DB, demanda.id, { notas: "cliente feliz" }, alcance);
  assert.equal(editada.venta_recuperada_id, 501, "su propia venta no es un duplicado");
});

test("NO_CONVERTIDA no necesita venta", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  const cerrada = cambiarEstado(DB, demanda.id, "NO_CONVERTIDA", {}, alcance, 100);
  assert.equal(cerrada.estado, "NO_CONVERTIDA");
});

test("una demanda CONVERTIDA no puede quedarse sin su venta", () => {
  const DB = construirDB();
  const demanda = crearConvertida(DB);
  assert.throws(
    () => actualizarDemanda(DB, demanda.id, { venta_recuperada_id: null }, alcance),
    /venta/i
  );
  const guardada = DB.radar_demanda.registros[0];
  assert.equal(guardada.estado, "CONVERTIDA", "el estado debe conservarse");
  assert.equal(guardada.venta_recuperada_id, 500, "la venta debe conservarse");
});

test("una demanda CONVERTIDA puede corregirse con otra venta válida y libre", () => {
  const DB = construirDB();
  const demanda = crearConvertida(DB);
  const editada = actualizarDemanda(DB, demanda.id, { venta_recuperada_id: 501 }, alcance);
  assert.equal(editada.estado, "CONVERTIDA");
  assert.equal(editada.venta_recuperada_id, 501);
});

test("una demanda CONVERTIDA puede editar otros campos y conserva su venta", () => {
  const DB = construirDB();
  const demanda = crearConvertida(DB);
  const editada = actualizarDemanda(DB, demanda.id, { notas: "entrega confirmada" }, alcance);
  assert.equal(editada.estado, "CONVERTIDA");
  assert.equal(editada.venta_recuperada_id, 500);
  assert.equal(editada.notas, "entrega confirmada");
});

test("una demanda NO_CONVERTIDA sí puede quedarse sin venta", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  cambiarEstado(DB, demanda.id, "NO_CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100);
  const editada = actualizarDemanda(DB, demanda.id, { venta_recuperada_id: null }, alcance);
  assert.equal(editada.estado, "NO_CONVERTIDA");
  assert.equal(editada.venta_recuperada_id, null);
});
