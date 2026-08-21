const test = require("node:test");
const assert = require("node:assert/strict");

const { crearDemandaConCRM } = require("./radarDemanda");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }],
      vendedores: [{ id: 10, nombre: "Ana", sucursal_id: 1 }],
      ventas: [],
    },
    admin: { usuarios: [{ id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: 10, activo: true }] },
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }] },
    "catalogo-productos": { productos: [{ id: 30, sku: "GTR-001", nombre: "Guitarra Roja" }] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

function datos(extra = {}) {
  return {
    producto_id: 30,
    cantidad: 1,
    motivo_no_venta: "SIN_EXISTENCIA",
    ...extra,
  };
}

const contexto = { usuarioId: 100, sucursalId: 1 };

test("una consulta sin intención permanece solo en Radar", () => {
  const DB = construirDB();
  const demanda = crearDemandaConCRM(DB, datos({ nombre_contacto: "Consulta", telefono_contacto: "9611111111" }), contexto);
  assert.equal(demanda.intencion_compra, false);
  assert.equal(demanda.cliente_id, null);
  assert.equal(DB.crm.clientes.length, 1);
});

test("intención confirmada crea un único interesado en CRM y lo vincula", () => {
  const DB = construirDB();
  const demanda = crearDemandaConCRM(DB, datos({
    intencion_compra: true,
    consentimiento_aviso: true,
    nombre_contacto: "María López",
    telefono_contacto: "+52 961-222-3344",
  }), contexto);

  assert.equal(DB.crm.clientes.length, 2);
  assert.equal(DB.crm.clientes[1].estado, "interesado");
  assert.equal(DB.crm.clientes[1].celular, "9612223344");
  assert.equal(DB.crm.clientes[1].sucursal_id, 1);
  assert.equal(DB.crm.clientes[1].vendedor_asignado_id, 10);
  assert.equal(demanda.cliente_id, DB.crm.clientes[1].id);
  assert.equal(demanda.requiere_seguimiento, true);
  assert.equal(demanda.intencion_compra, true);
  assert.equal(demanda.consentimiento_aviso, true);
});

test("deduplica por teléfono normalizado dentro de la sucursal", () => {
  const DB = construirDB();
  DB.crm.clientes.push({ id: 8, nombre: "María existente", celular: "961 222 3344", sucursal_id: 1, estado: "contactado" });
  const demanda = crearDemandaConCRM(DB, datos({
    intencion_compra: true,
    consentimiento_aviso: true,
    nombre_contacto: "María",
    telefono_contacto: "+52-961-222-3344",
  }), contexto);

  assert.equal(DB.crm.clientes.length, 2);
  assert.equal(demanda.cliente_id, 8);
});

test("rechaza intención sin consentimiento y revierte todas las mutaciones", () => {
  const DB = construirDB();
  assert.throws(() => crearDemandaConCRM(DB, datos({
    intencion_compra: true,
    nombre_contacto: "María",
    telefono_contacto: "9612223344",
  }), contexto), /consentimiento/);
  assert.equal(DB.crm.clientes.length, 1);
  assert.equal(DB.radar_demanda.registros.length, 0);
  assert.equal(DB.radar_demanda.ultimo_id, 0);
});

test("rechaza contacto incompleto y no deja prospecto huérfano", () => {
  const DB = construirDB();
  assert.throws(() => crearDemandaConCRM(DB, datos({
    intencion_compra: true,
    consentimiento_aviso: true,
    nombre_contacto: "María",
    telefono_contacto: "123",
  }), contexto), /10 dígitos/);
  assert.equal(DB.crm.clientes.length, 1);
  assert.equal(DB.radar_demanda.registros.length, 0);
});
