const { test } = require("node:test");
const assert = require("node:assert");
const { debeRespaldar, UNA_HORA_MS, HORAS_PUNTO_DIA } = require("./respaldoReloj");

// 2026-08-11 19:00 UTC = 13:00 en Chiapas (hora normal, NO punto del día)
const T_13H = Date.parse("2026-08-11T19:00:00.000Z");
// 2026-08-11 22:00 UTC = 16:00 en Chiapas (punto del día)
const T_16H = Date.parse("2026-08-11T22:00:00.000Z");
// 2026-08-11 23:00 UTC = 17:00 en Chiapas (punto del día)
const T_17H = Date.parse("2026-08-11T23:00:00.000Z");

const vacio = { ultimo_exitoso: null, copias: [] };

test("sin respaldos previos, respalda", () => {
  const r = debeRespaldar(vacio, T_13H);
  assert.strictEqual(r.respaldar, true);
  assert.strictEqual(r.tipo, "hora");
});

test("a los 30 minutos del último, NO respalda", () => {
  const estado = { ultimo_exitoso: new Date(T_13H - 30 * 60_000).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, false);
});

test("a los 61 minutos, SÍ respalda", () => {
  const estado = { ultimo_exitoso: new Date(T_13H - 61 * 60_000).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, true);
});

test("exactamente a la hora, respalda (el borde cuenta)", () => {
  const estado = { ultimo_exitoso: new Date(T_13H - UNA_HORA_MS).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, true);
});

test("a las 4 pm de Chiapas el tipo es 'dia', no 'hora'", () => {
  assert.strictEqual(debeRespaldar(vacio, T_16H).tipo, "dia");
});

test("a las 5 pm de Chiapas el tipo también es 'dia'", () => {
  assert.strictEqual(debeRespaldar(vacio, T_17H).tipo, "dia");
});

test("a las 4 pm UTC (10 am en Chiapas) el tipo NO es 'dia'", () => {
  // La trampa de zona horaria que este repo ya pagó una vez con las fechas.
  const t = Date.parse("2026-08-11T16:00:00.000Z");
  assert.strictEqual(debeRespaldar(vacio, t).tipo, "hora");
});

test("el punto del día se toma aunque falten minutos para la hora completa", () => {
  // Reinició a las 15:59 y respaldó. A las 16:05 solo pasaron 6 minutos, pero
  // el punto de las 4 pm NO se puede perder: es de los que se guardan 30 días.
  const estado = { ultimo_exitoso: new Date(T_16H - 6 * 60_000).toISOString(), copias: [] };
  const r = debeRespaldar(estado, T_16H + 5 * 60_000);
  assert.strictEqual(r.respaldar, true);
  assert.strictEqual(r.tipo, "dia");
});

test("el punto del día NO se repite si ya existe el de esa hora", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-11", hora_local: "16:00", estado: "ok" }],
  };
  const r = debeRespaldar(estado, T_16H + 20 * 60_000);
  assert.strictEqual(r.respaldar, false);
});

test("las 5 pm se toma aunque las 4 pm ya esté hecha (son dos puntos distintos)", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-11", hora_local: "16:00", estado: "ok" }],
  };
  const r = debeRespaldar(estado, T_17H);
  assert.strictEqual(r.respaldar, true);
  assert.strictEqual(r.tipo, "dia");
});

test("una copia FALLIDA del punto del día no cuenta como hecha", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H - 5 * 60_000).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-11", hora_local: "16:00", estado: "fallido" }],
  };
  assert.strictEqual(debeRespaldar(estado, T_16H).respaldar, true);
});

test("el punto del día de AYER no bloquea el de hoy", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H - 3 * 60_000).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-10", hora_local: "16:00", estado: "ok" }],
  };
  assert.strictEqual(debeRespaldar(estado, T_16H).respaldar, true);
});

test("tres reinicios en el mismo minuto NO hacen tres respaldos", () => {
  const estado = { ultimo_exitoso: new Date(T_13H).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H + 1000).respaldar, false);
  assert.strictEqual(debeRespaldar(estado, T_13H + 2000).respaldar, false);
  assert.strictEqual(debeRespaldar(estado, T_13H + 3000).respaldar, false);
});

test("un ultimo_exitoso corrupto no paraliza los respaldos", () => {
  // Falla ABIERTO a propósito: ante una fecha basura, respaldar de más es
  // inofensivo; no respaldar es el desastre que este módulo existe para evitar.
  const estado = { ultimo_exitoso: "no-es-una-fecha", copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, true);
});

test("un estado ausente no truena", () => {
  assert.strictEqual(debeRespaldar(undefined, T_13H).respaldar, true);
  assert.strictEqual(debeRespaldar(null, T_13H).respaldar, true);
});

test("HORAS_PUNTO_DIA son las 4 y 5 de la tarde que pidió Victor", () => {
  assert.deepStrictEqual(HORAS_PUNTO_DIA, [16, 17]);
});
