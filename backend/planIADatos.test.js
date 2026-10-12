const { test } = require("node:test");
const assert = require("node:assert/strict");
const { armarDatosPlan, quitarNombres, FACTOR_PERIODO } = require("./planIADatos");

const HOY = "2026-10-12";
function dbFalso() {
  return {
    admin: { usuarios: [{ id: 9, nombre: "Rosa Pérez", usuario: "rosa" }] },
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }],
      vendedores: [
        { id: 1, nombre: "Ana López", sucursal_id: 1, activo: true },
        { id: 2, nombre: "Carlos Ruiz", sucursal_id: 1, activo: false },
        { id: 3, nombre: "María Díaz", sucursal_id: 2 },
      ],
      ventas: [
        { id: 1, fecha: "2026-09-10", sucursal_id: 1, vendedor_id: 1, estatus: "cerrada", total: 1500, cliente_nombre: "Juan Cliente",
          cliente_telefono: "9191234567", costo_total: 900 },
        { id: 2, fecha: "2026-08-02", sucursal_id: 1, vendedor_id: 1, estatus: "cerrada", total: 2000 },
        { id: 3, fecha: "2026-09-01", sucursal_id: 2, vendedor_id: 3, estatus: "cerrada", total: 999 },
        { id: 4, fecha: "2026-09-11", sucursal_id: 1, vendedor_id: 1, estatus: "cancelada", total: 5000 },
        { id: 5, fecha: "2026-10-05", sucursal_id: 1, vendedor_id: 1, estatus: "cerrada", total: 700 },
      ],
      objetivos: [{ id: 1, tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: null, actividad: null, marca_id: null,
        producto_meta_id: null, financiera: null, monto: 50000, vigente: true }],
      objetivo_actividades: [
        { id: 1, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: true },
        { id: 2, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: true },
        { id: 3, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: false },
        { id: 4, mes: "2026-08", sucursal_id: 1, actividad: "iglesia", vigente: true },
      ],
      metas_personalizadas: [{ id: 1, clave: 1, vigente: true, nombre: "Videos de tips", unidad: "videos", prueba: "liga",
        valor_meta: 4, periodo: "semanal", inicio: "2026-09-07", alcance: "tienda", sucursal_id: 1 }],
      meta_capturas: [
        { id: 1, meta_clave: 1, sucursal_id: 1, cantidad: 3, anulada: null },
        { id: 2, meta_clave: 1, sucursal_id: 1, cantidad: 2, anulada: { motivo: "x" } },
      ],
      objetivo_marcas: [{ id: 1, nombre: "Yamaha", activo: true }, { id: 2, nombre: "Vieja", activo: false }],
    },
  };
}

test("armarDatosPlan: solo cifras agregadas de la tienda, sin nombres, clientes, telefonos ni costos", () => {
  const { datos } = armarDatosPlan(dbFalso(), { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  const texto = JSON.stringify(datos);
  for (const prohibido of ["Ana", "Carlos", "Rosa", "Juan", "9191234567", "900", "vendedor_id", "costo"]) {
    assert.ok(!texto.includes(prohibido), `no debe aparecer ${prohibido}`);
  }
  assert.equal(datos.tienda, "Ocosingo");
  assert.deepEqual(datos.venta_por_mes.map((m) => m.mes), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.equal(datos.venta_por_mes.find((m) => m.mes === "2026-09").venta, 1500); // ni cancelada ni otra tienda
  assert.deepEqual(datos.venta_mes_actual, { mes: "2026-10", meta: 50000, vendido_hasta_hoy: 700 });
  assert.equal(datos.personas_activas, 1);
  assert.equal(datos.actividades_por_mes.find((m) => m.mes === "2026-09").grupos, 2); // la anulada no cuenta
  assert.deepEqual(datos.metas_anteriores, [{ nombre: "Videos de tips", unidad: "videos", periodo: "semanal", valor_meta: 4, resultado: 3 }]);
  assert.deepEqual(datos.marcas, ["Yamaha"]);
});

test("armarDatosPlan: catalogo y maximos mensuales por accion", () => {
  const { catalogo, maximos, sinHistorial } = armarDatosPlan(dbFalso(), { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  assert.ok(catalogo.some((c) => c.accion === "actividad:grupos" && c.prueba === "liga"));
  assert.ok(catalogo.some((c) => c.accion === "actividad:iglesia" && c.prueba === "foto"));
  assert.ok(catalogo.some((c) => c.accion === "meta:Videos de tips" && c.unidad === "videos"));
  assert.equal(maximos["actividad:grupos"], 2);
  assert.equal(maximos["actividad:volanteo"], 0);
  assert.equal(maximos["meta:Videos de tips"], 12); // 3 en una semana = 12 al mes
  assert.equal(sinHistorial, false);
});

test("armarDatosPlan: toda la empresa suma tiendas; tienda sin historial se marca", () => {
  const db = dbFalso();
  const { datos } = armarDatosPlan(db, { sucursal_id: null, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  assert.equal(datos.tienda, "toda la empresa");
  assert.equal(datos.venta_por_mes.find((m) => m.mes === "2026-09").venta, 2499);
  db.pos.sucursales.push({ id: 7, nombre: "Innotec" });
  assert.equal(armarDatosPlan(db, { sucursal_id: 7, periodo: "mensual", inicio: "2026-11-01" }, HOY).sinHistorial, true);
});

test("armarDatosPlan: cifrasPermitidas trae los numeros enviados", () => {
  const { cifrasPermitidas } = armarDatosPlan(dbFalso(), { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  for (const n of [1500, 2000, 50000, 700, 2, 3, 4]) assert.ok(cifrasPermitidas.includes(n), `falta ${n}`);
});

test("quitarNombres: cambia nombres de personal y usuarios sin importar acentos ni mayusculas", () => {
  const texto = quitarNombres(dbFalso(), "Que ana lopez y ROSA vendan más guitarras; María también");
  assert.equal(texto, "Que [persona] [persona] y [persona] vendan más guitarras; [persona] también");
});

test("metas anteriores: sin metas de una sola persona y sin nombres de personal en el nombre", () => {
  const db = dbFalso();
  db.pos.metas_personalizadas.push({ id: 2, clave: 2, vigente: true, nombre: "Reto de Ana", unidad: "u", prueba: "ninguna", valor_meta: 2,
    periodo: "semanal", inicio: "2026-09-14", alcance: "tienda", sucursal_id: 1 }, { id: 3, clave: 3, vigente: true, nombre: "Solo Carlos",
    unidad: "u", prueba: "ninguna", valor_meta: 2, periodo: "semanal", inicio: "2026-09-14", alcance: "persona", sucursal_id: 1, vendedor_id: 2 });
  const { datos, catalogo } = armarDatosPlan(db, { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  const texto = JSON.stringify({ datos, catalogo });
  assert.ok(!texto.includes("Ana") && !texto.includes("Carlos"));
  assert.ok(datos.metas_anteriores.some((m) => m.nombre === "Reto de [persona]"));
});

test("quitarNombres: tapa telefonos escritos en el objetivo", () => {
  assert.equal(quitarNombres(dbFalso(), "Llamar a la escuela 961 123 4567 y 9191234567, meta 120"),
    "Llamar a la escuela [número] y [número], meta 120");
});

test("FACTOR_PERIODO convierte a escala mensual", () => {
  assert.deepEqual(FACTOR_PERIODO, { semanal: 0.25, mensual: 1, trimestral: 3 });
});

test("quitarNombres: los conectores de nombres compuestos no se tachan", () => {
  const db = dbFalso();
  db.pos.vendedores.push({ id: 9, nombre: "Lupita de los Santos", sucursal_id: 1 });
  assert.equal(quitarNombres(db, "Vender los teclados de Lupita"), "Vender los teclados de [persona]");
});
