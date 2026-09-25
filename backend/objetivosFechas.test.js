const { test } = require("node:test");
const assert = require("node:assert/strict");

function prepararDB() {
  return { pos: {
    vendedores: [{ id: 1, nombre: "Juan", sucursal_id: 1 }],
    objetivo_plantilla: [],
  } };
}

const DATOS = { mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1, vendedor_id: 1 };

test("validador compartido devuelve al vendedor sin modificar la base", () => {
  const { validarFechaYPlantilla } = require("./objetivosFechas");
  const DB = prepararDB();
  const antes = structuredClone(DB);
  assert.equal(validarFechaYPlantilla(DB, DATOS), DB.pos.vendedores[0]);
  assert.deepEqual(DB, antes);
});

for (const [cambios, mensaje] of [
  [{ mes: "2026-13" }, "El mes debe tener formato AAAA-MM, con mes entre 01 y 12"],
  [{ fecha: "2026-09-31" }, "La fecha debe tener formato AAAA-MM-DD y ser válida"],
  [{ fecha: "2026-9-03" }, "La fecha debe tener formato AAAA-MM-DD y ser válida"],
  [{ mes: "2025-02", fecha: "2025-02-29" }, "La fecha debe tener formato AAAA-MM-DD y ser válida"],
  [{ fecha: "2026-08-03" }, "La fecha debe caer dentro del mes indicado"],
  [{ mes: "2099-09", fecha: "2099-09-03" }, "No se puede capturar una fecha futura o adelantada"],
  [{ sucursal_id: 0 }, "La sucursal debe tener un identificador válido"],
  [{ vendedor_id: 999 }, "El vendedor no existe"],
  [{ sucursal_id: 2 }, "El vendedor no pertenece a esta sucursal"],
]) {
  test(`fecha y plantilla conservan el rechazo: ${JSON.stringify(cambios)}`, () => {
    const { validarFechaYPlantilla } = require("./objetivosFechas");
    const DB = prepararDB();
    const antes = structuredClone(DB);
    assert.throws(() => validarFechaYPlantilla(DB, { ...DATOS, ...cambios }), { message: mensaje });
    assert.deepEqual(DB, antes);
  });
}

test("fecha compartida acepta 29 de febrero bisiesto", () => {
  const { validarFechaYPlantilla } = require("./objetivosFechas");
  const DB = prepararDB();
  assert.equal(validarFechaYPlantilla(DB, {
    ...DATOS, mes: "2024-02", fecha: "2024-02-29",
  }), DB.pos.vendedores[0]);
});

test("plantilla decide la tienda histórica y rechaza los días fuera de sus intervalos", () => {
  const { validarFechaYPlantilla } = require("./objetivosFechas");
  const DB = prepararDB();
  DB.pos.vendedores[0].sucursal_id = 2;
  DB.pos.objetivo_plantilla.push(
    { ...DATOS, desde: "2026-09-03", hasta: "2026-09-10" },
    { ...DATOS, sucursal_id: 2, desde: "2026-09-12", hasta: null }
  );
  for (const fecha of ["2026-09-03", "2026-09-10"]) {
    assert.equal(validarFechaYPlantilla(DB, { ...DATOS, fecha }).id, 1);
  }
  assert.equal(validarFechaYPlantilla(DB, { ...DATOS, sucursal_id: 2, fecha: "2026-09-12" }).id, 1);
  for (const cambios of [{ fecha: "2026-09-02" }, { fecha: "2026-09-11" }, { sucursal_id: 2 }]) {
    assert.throws(() => validarFechaYPlantilla(DB, { ...DATOS, ...cambios }), {
      message: "Ese día no estás en la plantilla de esta tienda",
    });
  }
});
