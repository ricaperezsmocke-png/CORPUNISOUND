import { test } from "node:test";
import assert from "node:assert/strict";
import {
  incorporarImportados, guardarManual, cambiarRenglon, quitarPorUid, piezasTotales, conUid,
} from "./recepcionRenglones.js";

test("una factura con el mismo producto en dos renglones recibe los dos (3 + 5 = 8)", () => {
  const resultado = incorporarImportados([], [
    { producto_id: 7, cantidad: 3, costo: 100 },
    { producto_id: 7, cantidad: 5, costo: 90 },
  ]);
  assert.equal(resultado.length, 2);
  assert.equal(piezasTotales(resultado, 7), 8);
  assert.notEqual(resultado[0].uid, resultado[1].uid);
});

test("lo capturado a mano del mismo producto se reemplaza por la factura; lo demás se conserva", () => {
  const previos = [conUid({ producto_id: 7, cantidad: 1, costo: 50 }), conUid({ producto_id: 9, cantidad: 2, costo: 10 })];
  const resultado = incorporarImportados(previos, [{ producto_id: 7, cantidad: 3, costo: 100 }]);
  assert.deepEqual(resultado.map((r) => [r.producto_id, r.cantidad]), [[9, 2], [7, 3]]);
});

test("cambiar cantidad, descuento o quitar actúa solo sobre ese renglón, no sobre su gemelo", () => {
  const [a, b] = incorporarImportados([], [{ producto_id: 7, cantidad: 3 }, { producto_id: 7, cantidad: 5 }]);
  let renglones = [a, b];
  renglones = cambiarRenglon(renglones, a.uid, (r) => ({ cantidad: r.cantidad + 1 }));
  assert.deepEqual(renglones.map((r) => r.cantidad), [4, 5]);
  renglones = cambiarRenglon(renglones, b.uid, () => ({ descuento_porcentaje: 10 }));
  assert.equal(renglones[0].descuento_porcentaje, undefined);
  renglones = quitarPorUid(renglones, a.uid);
  assert.deepEqual(renglones.map((r) => r.cantidad), [5]);
});

test("guardarManual reemplaza el renglón que se editaba o agrega uno nuevo", () => {
  const [a, b] = incorporarImportados([], [{ producto_id: 7, cantidad: 3 }, { producto_id: 7, cantidad: 5 }]);
  const editado = guardarManual([a, b], { producto_id: 7, cantidad: 6 }, b.uid);
  assert.deepEqual(editado.map((r) => r.cantidad), [3, 6]);
  assert.equal(editado[1].uid, b.uid);
  const agregado = guardarManual([a], { producto_id: 8, cantidad: 1 }, null);
  assert.equal(agregado.length, 2);
  assert.ok(agregado[1].uid);
});
