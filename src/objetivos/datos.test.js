import { test } from "node:test";
import assert from "node:assert/strict";
import { diasDeAtraso, finDelMes, hoyLocal, leer, sugerenciaGuardada } from "./datos.js";

test("hoy usa el día de Chiapas al cambiar el mes en UTC", () => {
  assert.equal(hoyLocal(new Date("2026-10-01T02:00:00Z")), "2026-09-30");
});

test("el atraso compara días de Chiapas y no el día UTC de la marca", () => {
  assert.equal(diasDeAtraso({ fecha: "2026-09-15", capturado_en: "2026-09-16T02:00:00Z" }), 0);
  assert.equal(diasDeAtraso({ fecha: "2026-09-13", capturado_en: "2026-09-16T02:00:00Z" }), 2);
  assert.equal(diasDeAtraso({ fecha: "2026-08-31", capturado_en: "2026-09-02T06:00:00Z" }), 2);
});

test("el límite de desde respeta febrero bisiesto y diciembre", () => {
  assert.equal(finDelMes("2024-02"), "2024-02-29");
  assert.equal(finDelMes("2026-02"), "2026-02-28");
  assert.equal(finDelMes("2026-12"), "2026-12-31");
});

test("la lectura conserva texto y 404 para avisar de una cuenta mal ligada", async () => {
  const respuesta = new Response(JSON.stringify({ error: "Vendedor no encontrado" }), { status: 404 });
  await assert.rejects(leer(respuesta, "Error genérico"), { message: "Vendedor no encontrado", status: 404 });
});

test("una sugerencia queda guardada solo al coincidir persona y monto vigente", () => {
  const lineas = [{ vendedor_id: 1, monto: 1 }, { vendedor_id: 2, monto: 0 }];
  assert.equal(sugerenciaGuardada({ vendedor_id: 1, monto: 1 }, lineas), true);
  assert.equal(sugerenciaGuardada({ vendedor_id: 2, monto: 2 }, lineas), false);
  assert.equal(sugerenciaGuardada({ vendedor_id: 2, monto: 1 }, lineas), false);
});

test("comparar sugerencias normaliza ids y montos numéricos recibidos como texto", () => {
  assert.equal(sugerenciaGuardada({ vendedor_id: "9", monto: "1250.50" }, [{ vendedor_id: 9, monto: 1250.5 }]), true);
  assert.equal(sugerenciaGuardada({ vendedor_id: 9, monto: 1250.5 }, [{ vendedor_id: "9", monto: "1250.50" }]), true);
  assert.equal(sugerenciaGuardada({ vendedor_id: 9, monto: 1250.5 }, [{ vendedor_id: 9, monto: 1250.51 }]), false);
});

test("cero coincide con cero vigente, pero una persona ausente no se considera guardada", () => {
  const sugerencia = { vendedor_id: 1, monto: 0 };
  assert.equal(sugerenciaGuardada(sugerencia, [{ vendedor_id: 1, monto: 0 }]), true);
  assert.equal(sugerenciaGuardada(sugerencia, []), false);
  assert.equal(sugerenciaGuardada(sugerencia, [{ vendedor_id: 2, monto: 0 }]), false);
});
