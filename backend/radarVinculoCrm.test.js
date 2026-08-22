const test = require("node:test");
const assert = require("node:assert/strict");

const { crearDemandaConCRM } = require("./radarDemanda");
const { listarClientesCRM, resumenPorSucursal, rankingVendedores } = require("./crm");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      vendedores: [{ id: 10, nombre: "Ana", sucursal_id: 1 }],
      ventas: [],
      venta_detalle: [],
    },
    admin: { usuarios: [{ id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: 10, activo: true }] },
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }] },
    "catalogo-productos": { productos: [{ id: 30, sku: "GTR-001", nombre: "Guitarra Roja" }] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const contexto = { usuarioId: 100, sucursalId: 1 };

test("el prospecto que entra por Radar queda marcado como tal", () => {
  const DB = construirDB();
  crearDemandaConCRM(DB, {
    producto_id: 30, cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA",
    intencion_compra: true, consentimiento_aviso: true,
    nombre_contacto: "María López", telefono_contacto: "9612223344",
  }, contexto);
  const nuevo = DB.crm.clientes[1];
  assert.equal(nuevo.origen, "radar");
  assert.equal(nuevo.estado, "interesado");
});

test("a un cliente que ya existía no se le inventa un origen", () => {
  const DB = construirDB();
  DB.crm.clientes.push({
    id: 7, nombre: "Cliente Viejo", celular: "9613334455", sucursal_id: 1, estado: "contactado",
  });
  crearDemandaConCRM(DB, {
    producto_id: 30, cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA",
    intencion_compra: true, consentimiento_aviso: true,
    nombre_contacto: "Cliente Viejo", telefono_contacto: "9613334455",
  }, contexto);
  assert.equal(DB.crm.clientes.length, 2, "no debió crear otro");
  assert.equal(DB.crm.clientes[1].origen, undefined);
});

test('"ya compró" sale de las ventas, no de la etiqueta', () => {
  const DB = construirDB();
  DB.crm.clientes.push(
    { id: 7, nombre: "Dice que compró", sucursal_id: 1, estado: "compro" },
    { id: 8, nombre: "Sí compró", sucursal_id: 1, estado: "interesado" }
  );
  DB.pos.ventas.push({ id: 900, cliente_id: 8, sucursal_id: 1, estatus: "cerrada", fecha: "2026-08-01", total: 100 });

  const lista = listarClientesCRM(DB, { verTodas: true });
  const etiquetado = lista.find((c) => c.id === 7);
  const real = lista.find((c) => c.id === 8);

  assert.equal(etiquetado.ya_compro, false, "la etiqueta no basta");
  assert.equal(real.ya_compro, true, "la venta sí");
  assert.equal(etiquetado.origen, "", "un origen histórico ausente se expone vacío, no se inventa");
});

test("el resumen por sucursal cuenta clientes con ventas cerradas", () => {
  const DB = construirDB();
  DB.crm.clientes.push(
    { id: 7, nombre: "Etiqueta sin venta", sucursal_id: 1, estado: "compro" },
    { id: 8, nombre: "Compra real uno", sucursal_id: 1, estado: "interesado" },
    { id: 9, nombre: "Compra real dos", sucursal_id: 1, estado: "contactado" }
  );
  DB.pos.ventas.push(
    { id: 900, cliente_id: 8, sucursal_id: 1, estatus: "cerrada", fecha: "2026-08-01", total: 100 },
    { id: 901, cliente_id: 9, sucursal_id: 1, estatus: "cerrada", fecha: "2026-08-02", total: 200 }
  );

  const resumen = resumenPorSucursal(DB, { verTodas: true });

  assert.equal(resumen[0].convertidos, 2);
});

test("el ranking mide ventas cerradas y no etiquetas que mueve el vendedor", () => {
  const DB = construirDB();
  DB.pos.vendedores.push({ id: 11, nombre: "Bruno", sucursal_id: 1 });
  DB.crm.clientes.push(
    { id: 7, nombre: "Etiqueta sin venta", sucursal_id: 1, vendedor_asignado_id: 10, estado: "compro" },
    { id: 8, nombre: "Venta sin etiqueta", sucursal_id: 1, vendedor_asignado_id: 11, estado: "interesado" }
  );
  DB.pos.ventas.push({ id: 900, cliente_id: 8, sucursal_id: 1, estatus: "cerrada", fecha: "2026-08-01", total: 100 });

  const ranking = rankingVendedores(DB, { verTodas: true });
  const sinVenta = ranking.find((v) => v.vendedor_id === 10);
  const conVenta = ranking.find((v) => v.vendedor_id === 11);

  assert.equal(sinVenta.convertidos, 0);
  assert.equal(conVenta.convertidos, 1);
});
