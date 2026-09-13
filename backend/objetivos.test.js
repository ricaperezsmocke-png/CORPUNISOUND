const { test } = require("node:test");
const assert = require("node:assert");
const { fijarObjetivo, objetivoVigente, historialObjetivo } = require("./objetivos");

function prepararDB() {
  return {
    pos: {
      vendedores: [
        { id: 1, nombre: "Juan", sucursal_id: 1, activo: true },
        { id: 2, nombre: "Maria", sucursal_id: 1, activo: true },
        { id: 9, nombre: "Otro", sucursal_id: 2, activo: true },
      ],
      objetivos: [], objetivo_capturas: [], objetivo_cierres: [], objetivo_plantilla: [],
    },
  };
}
const VICTOR = { id: 1, nombre: "Victor" };

test("fijar un objetivo lo deja vigente, con quien y cuando", () => {
  const DB = prepararDB();
  const o = fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  assert.equal(o.monto, 80000);
  assert.equal(o.vigente, true);
  assert.equal(o.version, 1);
  assert.equal(o.creado_por, "Victor");
  assert.ok(o.creado_en, "sin fecha no se sabe si la meta se movio el dia 28");
});

test("cambiar la meta NO borra la anterior: crea una version nueva", () => {
  const DB = prepararDB();
  const primera = fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  const segunda = fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 50000, motivo: "bajo ventas" }, VICTOR);
  assert.equal(segunda.version, 2);
  assert.equal(segunda.reemplaza_a, primera.id);
  assert.equal(segunda.motivo, "bajo ventas");
  assert.equal(DB.pos.objetivos.length, 2, "la version vieja sigue en la base");
  assert.equal(DB.pos.objetivos.find((x) => x.id === primera.id).vigente, false);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }).monto, 50000);
});

test("el historial deja ver que la meta se bajo, y quien", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 50000 }, { nombre: "Gerente" });
  const h = historialObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => x.monto), [80000, 50000]);
  assert.equal(h[1].creado_por, "Gerente");
});

test("meses distintos no se pisan", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: 1, monto: 90000 }, VICTOR);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }).monto, 80000);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: 1 }).monto, 90000);
});

test("meta de TIENDA: vendedor_id null es una meta valida y distinta", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 300000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null }).monto, 300000);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }).monto, 80000);
});

test("se rechaza lo que no es un numero valido, sin escribir nada", () => {
  for (const malo of [-1, NaN, "abc", null, Infinity, undefined]) {
    const DB = prepararDB();
    assert.throws(
      () => fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: malo }, VICTOR),
      /monto|número|numero/i,
      `dejo pasar ${JSON.stringify(malo)}`
    );
    assert.equal(DB.pos.objetivos.length, 0, "no debe quedar nada escrito");
  }
});

test("el mes tiene que venir con formato AAAA-MM", () => {
  const DB = prepararDB();
  for (const malo of ["2026-9", "septiembre", "", null, "2026-13"]) {
    assert.throws(() => fijarObjetivo(DB, { tipo: "venta", mes: malo, sucursal_id: 1, vendedor_id: 1, monto: 1 }, VICTOR), /mes/i);
  }
  assert.equal(DB.pos.objetivos.length, 0);
});

test("un vendedor de otra sucursal no puede llevar meta de esta tienda", () => {
  const DB = prepararDB();
  assert.throws(
    () => fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 9, monto: 1000 }, VICTOR),
    /sucursal|tienda/i
  );
  assert.equal(DB.pos.objetivos.length, 0);
});
