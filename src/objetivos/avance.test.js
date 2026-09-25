import { test } from "node:test";
import assert from "node:assert/strict";
import { diasDelMes, diasRestantes, estadoMeta, faltantePorDia, serieConRitmo } from "./avance.js";

test("días del mes respetan febrero bisiesto y diciembre", () => {
  assert.equal(diasDelMes("2024-02"), 29);
  assert.equal(diasDelMes("2026-02"), 28);
  assert.equal(diasDelMes("2026-09"), 30);
  assert.equal(diasDelMes("2026-12"), 31);
});

test("días restantes cuentan hoy; mes pasado 0; mes futuro el mes completo", () => {
  assert.equal(diasRestantes("2026-09", "2026-09-24"), 7);
  assert.equal(diasRestantes("2026-09", "2026-09-30"), 1);
  assert.equal(diasRestantes("2026-09", "2026-09-01"), 30);
  assert.equal(diasRestantes("2026-08", "2026-09-24"), 0);
  assert.equal(diasRestantes("2026-10", "2026-09-24"), 31);
});

test("la serie acumula, mantiene el acumulado en días sin captura y no dibuja días futuros", () => {
  const serie = [{ fecha: "2026-09-01", monto: 100.1 }, { fecha: "2026-09-03", monto: 0.2 }];
  const puntos = serieConRitmo(serie, 3000, "2026-09", "2026-09-04");
  assert.equal(puntos.length, 30);
  assert.deepEqual(puntos.slice(0, 5).map((p) => [p.dia, p.fecha, p.acumulado]), [
    [1, "2026-09-01", 100.1], [2, "2026-09-02", 100.1], [3, "2026-09-03", 100.3], [4, "2026-09-04", 100.3], [5, "2026-09-05", null],
  ]);
  assert.equal(puntos[0].ritmo, 100);
  assert.equal(puntos[29].ritmo, 3000);
});

test("en un mes pasado la serie llega al último día; en uno futuro no hay acumulado", () => {
  const pasado = serieConRitmo([{ fecha: "2026-08-31", monto: 50 }], 0, "2026-08", "2026-09-24");
  assert.equal(pasado[30].acumulado, 50);
  assert.equal(pasado[30].ritmo, 0);
  const futuro = serieConRitmo([], 1000, "2026-10", "2026-09-24");
  assert.ok(futuro.every((p) => p.acumulado === null));
});

test("lo que falta por día se calcula en centavos y redondea hacia arriba para sí llegar", () => {
  assert.deepEqual(faltantePorDia(30000, 21600, 7), { faltante: 8400, porDia: 1200 });
  assert.deepEqual(faltantePorDia(100, 0.01, 3), { faltante: 99.99, porDia: 33.33 });
  assert.deepEqual(faltantePorDia(100, 0, 3), { faltante: 100, porDia: 33.34 });
  assert.equal(faltantePorDia(0, 0, 5), null, "sin meta no se divide");
  assert.equal(faltantePorDia(1000, 1000, 5), null, "ya llegó");
  assert.equal(faltantePorDia(1000, 10, 0), null, "mes terminado");
});

test("el estado distingue sin meta, en camino y lograda (en centavos)", () => {
  assert.equal(estadoMeta(0, 50), "sin-meta");
  assert.equal(estadoMeta(null, 0), "sin-meta");
  assert.equal(estadoMeta(71.6, 71.60000000000001), "lograda");
  assert.equal(estadoMeta(71.6, 71.59), "en-camino");
});
