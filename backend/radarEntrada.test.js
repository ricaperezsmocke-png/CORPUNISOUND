const test = require("node:test");
const assert = require("node:assert/strict");

const { booleanoEstricto } = require("./radar/entrada");
const { ErrorRadar } = require("./radar/errores");

test("un booleano de verdad pasa tal cual", () => {
  assert.equal(booleanoEstricto(true, "intencion_compra"), true);
  assert.equal(booleanoEstricto(false, "intencion_compra"), false);
});

test("el campo ausente significa que no, no un error", () => {
  assert.equal(booleanoEstricto(undefined, "intencion_compra"), false);
  assert.equal(booleanoEstricto(null, "intencion_compra"), false);
});

test('la cadena "false" NO es verdadera: se rechaza', () => {
  assert.throws(() => booleanoEstricto("false", "consentimiento_aviso"), ErrorRadar);
});

test("ninguna cadena ni número cuela como booleano", () => {
  for (const valor of ["true", "0", "1", "", 0, 1, [], {}]) {
    assert.throws(
      () => booleanoEstricto(valor, "intencion_compra"),
      ErrorRadar,
      `debería rechazar ${JSON.stringify(valor)}`
    );
  }
});

test("el error dice qué campo y trae 400", () => {
  try {
    booleanoEstricto("false", "consentimiento_aviso");
    assert.fail("debió lanzar");
  } catch (error) {
    assert.equal(error.estatus, 400);
    assert.match(error.message, /consentimiento_aviso/);
  }
});
