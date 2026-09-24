const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  FINANCIERAS, registrarCredito, anularCredito, creditosDelMes, resumenCreditos,
} = require("./objetivosCreditos");

const USUARIO = { id: 7, nombre: "María" };
const DATOS = {
  mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1, vendedor_id: 1,
  financiera: "coppel_pay", folio: " cp 123 ", monto: 1500.50,
};
const FILTRO = { mes: "2026-09", sucursal_id: 1 };

function prepararDB() {
  return { pos: {
    vendedores: [
      { id: 1, nombre: "Juan", sucursal_id: 1, activo: true },
      { id: 2, nombre: "María", sucursal_id: 1, activo: true },
      { id: 9, nombre: "Ana", sucursal_id: 2, activo: true },
    ],
    objetivo_plantilla: [], objetivo_creditos: [],
  } };
}

function rechazaSinCambios(DB, datos, mensaje) {
  const antes = structuredClone(DB);
  assert.throws(() => registrarCredito(DB, { ...DATOS, ...datos }, USUARIO), mensaje);
  assert.deepEqual(DB, antes);
}

test("registra folio normalizado, monto, nota y auditoría sin aceptar campos de auditoría del cuerpo", () => {
  const DB = prepararDB();
  const inicio = Date.now();
  const registro = registrarCredito(DB, {
    ...DATOS, nota: "  Crédito aprobado  ", id: 99, vigente: false, registrado_por: "Intruso", anulado_por: "Intruso",
  }, USUARIO);
  assert.deepEqual(registro, {
    id: 1, mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1, vendedor_id: 1,
    financiera: "coppel_pay", folio: "CP123", monto: 1500.50, nota: "Crédito aprobado",
    registrado_por: "María", registrado_en: registro.registrado_en,
    vigente: true, anulado_por: null, anulado_en: null, motivo_anulacion: null,
  });
  assert.ok(Date.parse(registro.registrado_en) >= inicio && Date.parse(registro.registrado_en) <= Date.now());
  assert.match(registro.registrado_en, /Z$/);
  assert.deepEqual(DB.pos.objetivo_creditos, [registro]);
});

test("normaliza ids de texto y permite varios créditos distintos el mismo día", () => {
  const DB = prepararDB();
  const primero = registrarCredito(DB, { ...DATOS, sucursal_id: "1", vendedor_id: "1" }, USUARIO);
  const segundo = registrarCredito(DB, { ...DATOS, folio: "\tc p\n124\r " }, USUARIO);
  assert.equal(primero.sucursal_id, 1);
  assert.equal(primero.vendedor_id, 1);
  assert.equal(segundo.folio, "CP124");
  assert.equal(segundo.id, 2);
  assert.equal(primero.nota, null);
});

test("folio repetido por la misma persona u otra se rechaza con quién lo registró y fecha", () => {
  const DB = prepararDB();
  registrarCredito(DB, DATOS, { nombre: "Juan" });
  for (const vendedor_id of [1, 2]) {
    rechazaSinCambios(DB, { vendedor_id, folio: "c P 1 2 3" }, /Juan.*2026-09-03/);
  }
});

test("el mismo folio de otra financiera se acepta", () => {
  const DB = prepararDB();
  registrarCredito(DB, DATOS, USUARIO);
  const atrato = registrarCredito(DB, { ...DATOS, financiera: "atrato" }, USUARIO);
  assert.equal(atrato.financiera, "atrato");
  assert.equal(atrato.folio, "CP123");
  assert.equal(DB.pos.objetivo_creditos.length, 2);
});

test("folio de otra tienda se rechaza sin revelar nombre, fecha ni datos del registro", () => {
  const DB = prepararDB();
  registrarCredito(DB, { ...DATOS, sucursal_id: 2, vendedor_id: 9 }, { nombre: "Ana" });
  rechazaSinCambios(DB, {}, { message: "ya registrado en otra tienda" });
});

test("la unicidad del folio también abarca meses anteriores", () => {
  const DB = prepararDB();
  registrarCredito(DB, { ...DATOS, mes: "2026-08", fecha: "2026-08-02" }, { nombre: "Juan" });
  rechazaSinCambios(DB, { vendedor_id: 2 }, /Juan.*2026-08-02/);
});

test("anular conserva el registro, audita el motivo y libera el folio sin reutilizar ids", () => {
  const DB = prepararDB();
  const registro = registrarCredito(DB, DATOS, USUARIO);
  const antes = structuredClone(registro);
  const inicio = Date.now();
  assert.equal(anularCredito(DB, String(registro.id), "  Folio equivocado  ", USUARIO), registro);
  assert.deepEqual(registro, {
    ...antes, vigente: false, anulado_por: "María", anulado_en: registro.anulado_en, motivo_anulacion: "Folio equivocado",
  });
  assert.ok(Date.parse(registro.anulado_en) >= inicio && Date.parse(registro.anulado_en) <= Date.now());
  assert.match(registro.anulado_en, /Z$/);
  const nuevo = registrarCredito(DB, { ...DATOS, vendedor_id: 2 }, USUARIO);
  assert.equal(nuevo.id, 2);
  assert.equal(nuevo.folio, antes.folio);
  assert.equal(nuevo.vigente, true);
  assert.equal(DB.pos.objetivo_creditos.length, 2);
});

test("anular requiere motivo de texto, registro existente y vigente; el rechazo no muta", () => {
  const DB = prepararDB();
  const registro = registrarCredito(DB, DATOS, USUARIO);
  for (const motivo of [undefined, null, "", "   ", 123, {}]) {
    const antes = structuredClone(DB);
    assert.throws(() => anularCredito(DB, registro.id, motivo, USUARIO), /motivo/i);
    assert.deepEqual(DB, antes);
  }
  assert.throws(() => anularCredito(DB, 99, "Error", USUARIO), /existe|encontr/i);
  anularCredito(DB, registro.id, "Error", USUARIO);
  const antes = structuredClone(DB);
  assert.throws(() => anularCredito(DB, registro.id, "Otro motivo", USUARIO), /anulad|vigente/i);
  assert.deepEqual(DB, antes);
});

for (const financiera of [undefined, null, "", "coppel", "Coppel Pay", "ATRATO", "otra", {}, true]) {
  test(`rechaza financiera inválida: ${JSON.stringify(financiera)}`, () => {
    rechazaSinCambios(prepararDB(), { financiera }, /financiera/i);
  });
}

for (const monto of [0, -1, NaN, Infinity, -Infinity, undefined, null, "1500", true]) {
  test(`rechaza monto no finito, no numérico o no positivo: ${String(monto)}`, () => {
    rechazaSinCambios(prepararDB(), { monto }, /monto/i);
  });
}

for (const folio of [undefined, null, "", " \t\n ", "a b", "a".repeat(41), 123, {}]) {
  test(`rechaza folio ausente, inválido o fuera de 3 a 40 caracteres: ${JSON.stringify(folio)}`, () => {
    rechazaSinCambios(prepararDB(), { folio }, /folio/i);
  });
}

test("los límites de folio y nota se aplican después de recortar y normalizar", () => {
  const DB = prepararDB();
  const primero = registrarCredito(DB, { ...DATOS, folio: " a b c ", nota: " x " }, USUARIO);
  const segundo = registrarCredito(DB, { ...DATOS, folio: ` ${"a ".repeat(40)}`, nota: ` ${"ñ".repeat(300)} ` }, USUARIO);
  assert.equal(primero.folio, "ABC");
  assert.equal(primero.nota, "x");
  assert.equal(segundo.folio, "A".repeat(40));
  assert.equal(segundo.nota, "ñ".repeat(300));
  for (const nota of ["ñ".repeat(301), 123, {}, true]) {
    rechazaSinCambios(DB, { folio: "OTRO", nota }, /nota/i);
  }
  for (const nota of [undefined, null, "  "]) {
    assert.equal(registrarCredito(prepararDB(), { ...DATOS, nota }, USUARIO).nota, null);
  }
});

for (const [datos, mensaje] of [
  [{ mes: "2026-13" }, /mes.*AAAA-MM/],
  [{ fecha: "2026-09-31" }, /fecha.*válida/],
  [{ fecha: "2026-08-03" }, /dentro del mes/],
  [{ mes: "2099-09", fecha: "2099-09-03" }, /futura/],
  [{ vendedor_id: 999 }, /vendedor no existe/],
  [{ sucursal_id: 2 }, /no pertenece/],
  [{ sucursal_id: null }, /sucursal/i],
  [{ sucursal_id: true }, /sucursal/i],
  [{ vendedor_id: true }, /vendedor/i],
]) {
  test(`rechaza fecha, mes o persona inválida: ${JSON.stringify(datos)}`, () => {
    rechazaSinCambios(prepararDB(), datos, mensaje);
  });
}

test("valida la plantilla del día incluyendo traslados y días fuera de plantilla", () => {
  const DB = prepararDB();
  DB.pos.vendedores[0].sucursal_id = 2;
  DB.pos.objetivo_plantilla.push(
    { mes: "2026-09", vendedor_id: 1, sucursal_id: 1, desde: "2026-09-03", hasta: "2026-09-10" },
    { mes: "2026-09", vendedor_id: 1, sucursal_id: 2, desde: "2026-09-12", hasta: null }
  );
  for (const datos of [{ fecha: "2026-09-02" }, { fecha: "2026-09-11" }, { sucursal_id: 2 }]) {
    rechazaSinCambios(DB, datos, /no estás en la plantilla/);
  }
  assert.equal(registrarCredito(DB, DATOS, USUARIO).sucursal_id, 1);
  const trasladado = registrarCredito(DB, { ...DATOS, fecha: "2026-09-12", sucursal_id: 2, folio: "CP124" }, USUARIO);
  assert.equal(trasladado.sucursal_id, 2);
});

test("lista vigentes y anulados por mes, tienda y persona, sin mutar ni reordenar la base", () => {
  const DB = prepararDB();
  const primero = registrarCredito(DB, { ...DATOS, fecha: "2026-09-05" }, USUARIO);
  const segundo = registrarCredito(DB, { ...DATOS, vendedor_id: 2, folio: "CP124" }, USUARIO);
  anularCredito(DB, segundo.id, "Error", USUARIO);
  registrarCredito(DB, { ...DATOS, mes: "2026-08", fecha: "2026-08-01", folio: "CP125" }, USUARIO);
  registrarCredito(DB, { ...DATOS, sucursal_id: 2, vendedor_id: 9, folio: "CP126" }, USUARIO);
  const antes = structuredClone(DB);
  assert.deepEqual(creditosDelMes(DB, FILTRO).map((item) => item.id), [segundo.id, primero.id]);
  assert.deepEqual(creditosDelMes(DB, { ...FILTRO, sucursal_id: "1", vendedor_id: "1" }), [primero]);
  assert.deepEqual(creditosDelMes(DB, { ...FILTRO, vendedor_id: null }).map((item) => item.id), [segundo.id, primero.id]);
  assert.deepEqual(DB, antes);
});

test("resumen cuenta créditos vigentes por financiera, no montos ni anulados, respetando filtros", () => {
  const DB = prepararDB();
  registrarCredito(DB, DATOS, USUARIO);
  registrarCredito(DB, { ...DATOS, vendedor_id: 2, folio: "CP124", monto: 1 }, USUARIO);
  const anulado = registrarCredito(DB, { ...DATOS, folio: "CP125" }, USUARIO);
  anularCredito(DB, anulado.id, "Error", USUARIO);
  registrarCredito(DB, { ...DATOS, financiera: "atrato" }, USUARIO);
  registrarCredito(DB, { ...DATOS, mes: "2026-08", fecha: "2026-08-01", folio: "CP126" }, USUARIO);
  registrarCredito(DB, { ...DATOS, sucursal_id: 2, vendedor_id: 9, folio: "CP127" }, USUARIO);
  const antes = structuredClone(DB);
  assert.deepEqual(FINANCIERAS, [
    { clave: "coppel_pay", etiqueta: "Coppel Pay" }, { clave: "atrato", etiqueta: "Atrato" },
  ]);
  assert.deepEqual(resumenCreditos(DB, FILTRO), [
    { financiera: "coppel_pay", etiqueta: "Coppel Pay", registrados: 2 },
    { financiera: "atrato", etiqueta: "Atrato", registrados: 1 },
  ]);
  assert.deepEqual(resumenCreditos(DB, { ...FILTRO, vendedor_id: "2" }), [
    { financiera: "coppel_pay", etiqueta: "Coppel Pay", registrados: 1 },
    { financiera: "atrato", etiqueta: "Atrato", registrados: 0 },
  ]);
  assert.deepEqual(DB, antes);
});

test("base antigua sin créditos se consulta sin mutar y conserva registros viejos al registrar y anular", () => {
  const DB = prepararDB();
  delete DB.pos.objetivo_creditos;
  DB.pos.objetivos = [{ id: 1, tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 100, vigente: true }];
  DB.pos.objetivo_capturas = [{ id: 1, tipo: "venta", mes: "2026-09", fecha: "2026-09-03", vendedor_id: 1, monto: 50, vigente: true }];
  DB.pos.objetivo_cierres = [{ id: 1, mes: "2026-08", sucursal_id: 1, lineas: [], foto: {} }];
  const antes = structuredClone(DB);
  assert.deepEqual(creditosDelMes(DB, FILTRO), []);
  assert.deepEqual(resumenCreditos(DB, FILTRO), [
    { financiera: "coppel_pay", etiqueta: "Coppel Pay", registrados: 0 },
    { financiera: "atrato", etiqueta: "Atrato", registrados: 0 },
  ]);
  assert.deepEqual(DB, antes);
  rechazaSinCambios(DB, { monto: 0 }, /monto/i);
  const registro = registrarCredito(DB, DATOS, USUARIO);
  anularCredito(DB, registro.id, "Error", USUARIO);
  assert.deepEqual(DB.pos.objetivos, antes.pos.objetivos);
  assert.deepEqual(DB.pos.objetivo_capturas, antes.pos.objetivo_capturas);
  assert.deepEqual(DB.pos.objetivo_cierres, antes.pos.objetivo_cierres);
});

test("el mismo folio con guiones, puntos o diagonales no se puede registrar otra vez", () => {
  const DB = prepararDB();
  registrarCredito(DB, { ...DATOS, folio: "CP123" }, USUARIO);
  for (const variante of ["CP-123", "cp.123", "C/P 1-2-3", "CP_123"]) {
    rechazaSinCambios(DB, { vendedor_id: 2, folio: variante }, /ya lo registró/);
  }
  assert.throws(() => registrarCredito(DB, { ...DATOS, folio: "--" }, USUARIO), /entre 3 y 40/);
});
