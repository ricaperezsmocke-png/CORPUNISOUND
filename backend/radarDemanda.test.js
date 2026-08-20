const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearDemanda,
  actualizarDemanda,
  agregarSeguimiento,
  cambiarEstado,
  obtenerHistorial,
} = require("./radarDemanda");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }],
      vendedores: [{ id: 10, nombre: "Ana", sucursal_id: 1 }],
      ventas: [{ id: 50, sucursal_id: 1 }, { id: 60, sucursal_id: 2 }],
    },
    admin: {
      usuarios: [
        { id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: 10, activo: true },
        { id: 101, nombre: "Caja", sucursal_id: 1, vendedor_id: null, activo: true },
      ],
    },
    crm: {
      clientes: [
        { id: 0, nombre: "Público en General", sucursal_id: 1 },
        { id: 20, nombre: "María", sucursal_id: 1 },
      ],
    },
    "catalogo-productos": {
      productos: [{ id: 30, sku: "GTR-001", nombre: "Guitarra Roja", activo: true }],
    },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const ALCANCE_1 = { verTodas: false, sucursalId: 1 };

function datosValidos(extra = {}) {
  return {
    producto_id: 30,
    cantidad: 1,
    motivo_no_venta: "SIN_EXISTENCIA",
    ...extra,
  };
}

test("crear demanda con producto existente y snapshot tomado del catálogo", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos({
    producto_nombre_registrado: "Manipulado",
    producto_sku_registrado: "FALSO",
  }), { usuarioId: 100, sucursalId: 1 });

  assert.equal(demanda.producto_id, 30);
  assert.equal(demanda.producto_nombre_registrado, "Guitarra Roja");
  assert.equal(demanda.producto_sku_registrado, "GTR-001");
  assert.equal(demanda.estado, "REGISTRADA");
});

test("rechaza un producto inexistente", () => {
  const DB = construirDB();
  assert.throws(
    () => crearDemanda(DB, datosValidos({ producto_id: 999 }), { usuarioId: 100, sucursalId: 1 }),
    /Producto no encontrado/
  );
});

test("permite producto no catalogado sin crear producto", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, {
    producto_buscado: "Guitarra de doce cuerdas",
    marca_solicitada: "Marca X",
    modelo_solicitado: "Doce",
    variante_solicitada: "Negra",
    categoria_solicitada: "Guitarras",
    cantidad: 2,
    motivo_no_venta: "NO_MANEJAMOS",
  }, { usuarioId: 100, sucursalId: 1 });

  assert.equal(demanda.producto_id, null);
  assert.equal(demanda.producto_buscado, "Guitarra de doce cuerdas");
  assert.equal(DB["catalogo-productos"].productos.length, 1);
});

test("rechaza motivo fuera del catálogo controlado", () => {
  const DB = construirDB();
  assert.throws(
    () => crearDemanda(DB, datosValidos({ motivo_no_venta: "NO_SE" }), { usuarioId: 100, sucursalId: 1 }),
    /motivo de no venta no es válido/
  );
});

test("rechaza cantidad cero o negativa", () => {
  for (const cantidad of [0, -1]) {
    const DB = construirDB();
    assert.throws(
      () => crearDemanda(DB, datosValidos({ cantidad }), { usuarioId: 100, sucursalId: 1 }),
      /mayor que cero/
    );
  }
});

test("rechaza cliente inexistente", () => {
  const DB = construirDB();
  assert.throws(
    () => crearDemanda(DB, datosValidos({ cliente_id: 999 }), { usuarioId: 100, sucursalId: 1 }),
    /Cliente no encontrado/
  );
});

test("cliente es opcional", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  assert.equal(demanda.cliente_id, null);
});

test("permite usuario sin vendedor", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 101, sucursalId: 1 });
  assert.equal(demanda.usuario_id, 101);
  assert.equal(demanda.vendedor_id, null);
});

test("deriva vendedor de la cuenta y no del cuerpo", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos({ vendedor_id: 999 }), { usuarioId: 100, sucursalId: 1 });
  assert.equal(demanda.vendedor_id, 10);
});

test("seguimiento queda registrado y el historial expuesto no puede mutar el original", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  agregarSeguimiento(DB, demanda.id, { tipo: "LLAMADA", comentario: "Cliente interesado" }, ALCANCE_1, 100);

  const historial = obtenerHistorial(DB, demanda.id, ALCANCE_1);
  assert.equal(historial.length, 1);
  assert.equal(historial[0].tipo, "LLAMADA");
  historial[0].comentario = "Alterado fuera del dominio";
  assert.equal(obtenerHistorial(DB, demanda.id, ALCANCE_1)[0].comentario, "Cliente interesado");
});

test("protege campos históricos después de crear", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  assert.throws(
    () => actualizarDemanda(DB, demanda.id, { usuario_id: 101 }, ALCANCE_1),
    /histórico y no puede modificarse/
  );
});

test("acepta transición válida y registra el cambio", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  const actualizada = cambiarEstado(DB, demanda.id, "EN_SEGUIMIENTO", { comentario: "Se buscará" }, ALCANCE_1, 100);

  assert.equal(actualizada.estado, "EN_SEGUIMIENTO");
  const historial = obtenerHistorial(DB, demanda.id, ALCANCE_1);
  assert.equal(historial[0].estado_anterior, "REGISTRADA");
  assert.equal(historial[0].estado_nuevo, "EN_SEGUIMIENTO");
});

test("rechaza transición inválida desde un estado terminal", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  cambiarEstado(DB, demanda.id, "CANCELADA", {}, ALCANCE_1, 100);
  assert.throws(
    () => cambiarEstado(DB, demanda.id, "EN_SEGUIMIENTO", {}, ALCANCE_1, 100),
    /No se permite cambiar/
  );
});

test("conversión puede referenciar una venta existente sin modificarla", () => {
  const DB = construirDB();
  const ventaAntes = { ...DB.pos.ventas[0] };
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  const convertida = cambiarEstado(
    DB, demanda.id, "CONVERTIDA", { venta_recuperada_id: 50 }, ALCANCE_1, 100
  );

  assert.equal(convertida.venta_recuperada_id, 50);
  assert.deepEqual(DB.pos.ventas[0], ventaAntes);
});

test("rechaza una venta recuperada inexistente", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datosValidos(), { usuarioId: 100, sucursalId: 1 });
  assert.throws(
    () => actualizarDemanda(DB, demanda.id, { venta_recuperada_id: 999 }, ALCANCE_1),
    /Venta recuperada no encontrada/
  );
});

