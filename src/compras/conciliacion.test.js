import { test } from "node:test";
import assert from "node:assert/strict";
import { textoUnion, textoAutor, puedeConciliar, textoViejas, avisosRojos, motivoConciliacionValido } from "./conciliacion.js";

test("unión muestra fecha, folio y centavos con formato de la app", () => {
  assert.equal(textoUnion({ folio: "A123", fecha: "2026-11-03T12:00:00", total_centavos: 1621800 }),
    "Llegó · compra SICAR A123 del 03/11/2026 · $16,218.00");
});

test("autor distingue unión automática y nombre confirmado por el servidor", () => {
  assert.equal(textoAutor({ modo: "automatica", actor: "sicar" }), "Unida sola");
  assert.equal(textoAutor({ modo: "manual", actor: "992", actor_nombre: "Ana" }), "Confirmada por Ana");
  assert.equal(textoAutor({ modo: "manual", actor_nombre: "Usuario #992" }), "Confirmada por Usuario #992");
});

test("botones de conciliación ocultos con permisos vecinos", () => {
  assert.equal(puedeConciliar(["ver_facturas_por_llegar", "registrar_facturas_por_llegar"]), false);
  assert.equal(puedeConciliar(undefined), false);
  assert.equal(puedeConciliar(["conciliar_facturas"]), true);
});

test("motivo de conciliación rechaza vacío y espacios sin imponer el límite de cancelar", () => {
  assert.equal(motivoConciliacionValido("   "), false);
  assert.equal(motivoConciliacionValido(undefined), false);
  assert.equal(motivoConciliacionValido("a"), true);
  assert.equal(motivoConciliacionValido("x".repeat(201)), true);
});

test("rojos conservan selección del servidor y ordenan más días primero sin mutar", () => {
  const resumen = {
    facturas_sin_compra_15: [{ id: 1, creada_en: "2026-10-15T12:00:00Z" }],
    compras_sin_factura_15: [{ com_id: "2", fecha: "2026-10-01T23:00:00" }],
    canceladas_despues: [{ id: 3 }],
    cambiaron: [{ id: 4, total_al_unir_centavos: 123456, total_centavos: 125000 }],
  };
  const copia = structuredClone(resumen);
  const avisos = avisosRojos(resumen, new Date("2026-11-04T05:30:00Z"));
  assert.deepEqual(avisos.map(a => a.texto), [
    "Compra de SICAR sin factura desde hace 33 días",
    "Factura sin compra en SICAR desde hace 19 días",
    "La compra se canceló en SICAR después de unida",
    "La compra cambió en SICAR después de unida: antes $1,234.56, ahora $1,250.00",
  ]);
  assert.deepEqual(resumen, copia);
  assert.deepEqual(avisosRojos(null), []);
});

test("compras históricas se muestran aparte sin rojo", () => {
  assert.equal(textoViejas(1399), "1399 compras anteriores sin factura (no se marcan en rojo)");
  assert.equal(textoViejas(0), "0 compras anteriores sin factura (no se marcan en rojo)");
});
