const test = require("node:test");
const assert = require("node:assert/strict");

const { sucursalDeEscritura } = require("./auth");
const {
  crearDemanda,
  listarDemandas,
  obtenerDemanda,
  actualizarDemanda,
} = require("./radarDemanda");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }],
      vendedores: [],
      ventas: [],
    },
    admin: {
      usuarios: [
        { id: 1, nombre: "Uno", sucursal_id: 1, vendedor_id: null, activo: true },
        { id: 2, nombre: "Dos", sucursal_id: 2, vendedor_id: null, activo: true },
        { id: 99, nombre: "Admin", sucursal_id: 1, vendedor_id: null, activo: true },
      ],
    },
    crm: { clientes: [] },
    "catalogo-productos": { productos: [] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

function datos(nombre) {
  return { producto_buscado: nombre, cantidad: 1, motivo_no_venta: "NO_MANEJAMOS" };
}

const SUCURSAL_1 = { verTodas: false, sucursalId: 1 };
const SUCURSAL_2 = { verTodas: false, sucursalId: 2 };
const TODAS = { verTodas: true, sucursalId: null };

test("sucursal de una cuenta limitada se deriva del alcance y no del body", () => {
  const DB = construirDB();
  const solicitadaEnBody = 2;
  const sucursalId = sucursalDeEscritura(SUCURSAL_1, solicitadaEnBody);
  const demanda = crearDemanda(DB, datos("Pedal"), { usuarioId: 1, sucursalId });
  assert.equal(demanda.sucursal_id, 1);
});

test("usuario limitado no puede consultar una demanda de otra sucursal", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos("Teclado"), { usuarioId: 2, sucursalId: 2 });
  assert.deepEqual(listarDemandas(DB, SUCURSAL_1), []);
  assert.throws(() => obtenerDemanda(DB, demanda.id, SUCURSAL_1), /Demanda no encontrada/);
});

test("usuario limitado no puede modificar una demanda de otra sucursal", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos("Teclado"), { usuarioId: 2, sucursalId: 2 });
  assert.throws(
    () => actualizarDemanda(DB, demanda.id, { notas: "Intento ajeno" }, SUCURSAL_1),
    /Demanda no encontrada/
  );
  assert.equal(obtenerDemanda(DB, demanda.id, SUCURSAL_2).notas, "");
});

test("administrador puede consultar demandas de múltiples sucursales", () => {
  const DB = construirDB();
  crearDemanda(DB, datos("Pedal"), { usuarioId: 1, sucursalId: 1 });
  crearDemanda(DB, datos("Teclado"), { usuarioId: 2, sucursalId: 2 });
  assert.equal(listarDemandas(DB, TODAS).length, 2);
});

test("administrador en Todas no puede escribir sin seleccionar sucursal", () => {
  const DB = construirDB();
  const sucursalId = sucursalDeEscritura(TODAS, null);
  assert.equal(sucursalId, null);
  assert.throws(
    () => crearDemanda(DB, datos("Pedal"), { usuarioId: 99, sucursalId }),
    /Selecciona una sucursal concreta/
  );
});

test("administrador en Todas puede escribir al seleccionar una sucursal concreta", () => {
  const DB = construirDB();
  const sucursalId = sucursalDeEscritura(TODAS, 2);
  const demanda = crearDemanda(DB, datos("Pedal"), { usuarioId: 99, sucursalId });
  assert.equal(demanda.sucursal_id, 2);
});

