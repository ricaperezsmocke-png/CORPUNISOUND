/**
 * seccionesCompras.test.js — Lo encontró la revisión independiente de Codex y
 * se reprodujo ejecutando antes de escribir una línea de arreglo.
 *
 * EL DEFECTO: al marcar un producto como "ya lo pedí", su fila pasaba de
 * "revisar para compra" a "observar". La sección de observar solo muestra
 * contradicciones, y "ya se pidió" no es una contradicción, así que la fila
 * **desaparecía de todas las secciones de la pantalla**. Con ella se iba el
 * botón para quitar la marca: un producto silenciado ya no se podía volver a
 * ver ni devolver a la lista de compras hasta que caducara solo.
 *
 * Reproducido: clasificación OBSERVAR, razones STOCK_LOCAL_CERO +
 * VENTAS_RECIENTES + PEDIDO_MARCADO_AL_PROVEEDOR, y las tres secciones
 * (prioritarias, compras, observar) devolvían false.
 *
 * Es justo lo contrario de lo que el silencio debía hacer: callar la fila, no
 * esconderla.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { repartirOportunidades, filasSinSeccion, estaMarcadaComoPedida } from "./seccionesCompras.js";

const fila = (extra = {}) => ({
  producto: { producto_id: 10, nombre: "Cuerdas" },
  sucursal: { sucursal_id: 1, sucursal_nombre: "Ocosingo" },
  clasificacion: "REVISAR_COMPRA",
  razones: ["STOCK_LOCAL_CERO", "VENTAS_RECIENTES"],
  pedido_proveedor: { marcado: false },
  ...extra,
});

const marcada = () => fila({
  clasificacion: "OBSERVAR",
  razones: ["STOCK_LOCAL_CERO", "VENTAS_RECIENTES", "PEDIDO_MARCADO_AL_PROVEEDOR"],
  pedido_proveedor: { marcado: true, dias_restantes: 18, marcado_por: "Victor" },
});

test("una fila marcada como pedida NO desaparece de la pantalla", () => {
  assert.deepEqual(filasSinSeccion([marcada()]), [], "toda fila tiene que caer en alguna sección");
});

test("y cae en su propia sección, donde se puede consultar y quitar la marca", () => {
  const s = repartirOportunidades([marcada()]);
  assert.equal(s.yaPedidas.length, 1);
  assert.equal(s.yaPedidas[0].pedido_proveedor.dias_restantes, 18);
});

test("una fila marcada sale de la lista de compras: para eso se silenció", () => {
  const s = repartirOportunidades([marcada()]);
  assert.equal(s.compras.length, 0);
  assert.equal(s.prioritarias.length, 0);
});

test("no se cuela entre las contradicciones: no es un problema, es un estado", () => {
  const s = repartirOportunidades([marcada()]);
  assert.equal(s.observar.length, 0, "mezclarla haría ruido en las dos listas");
});

test("sin marcar, la fila sigue exactamente donde estaba", () => {
  const s = repartirOportunidades([fila()]);
  assert.equal(s.compras.length, 1);
  assert.equal(s.prioritarias.length, 1);
  assert.equal(s.yaPedidas.length, 0);
});

test("las contradicciones de siempre siguen apareciendo donde siempre", () => {
  const contradiccion = fila({
    clasificacion: "OBSERVAR", razones: ["RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK"],
  });
  const s = repartirOportunidades([contradiccion]);
  assert.equal(s.observar.length, 1);
  assert.deepEqual(filasSinSeccion([contradiccion]), []);
});

test("la evidencia insuficiente tampoco se pierde", () => {
  const insuficiente = fila({ clasificacion: "EVIDENCIA_INSUFICIENTE", razones: ["SIN_FILA_EXISTENCIA"] });
  assert.equal(repartirOportunidades([insuficiente]).observar.length, 1);
  assert.deepEqual(filasSinSeccion([insuficiente]), []);
});

test("un traspaso marcado como pedido también se puede consultar", () => {
  const traspaso = fila({
    clasificacion: "REVISAR_TRASPASO", razones: ["STOCK_OTRA_SUCURSAL"],
    pedido_proveedor: { marcado: true, dias_restantes: 5 },
  });
  assert.deepEqual(filasSinSeccion([traspaso]), []);
  assert.equal(repartirOportunidades([traspaso]).yaPedidas.length, 1);
});

test("ninguna fila se queda fuera, sea cual sea su clasificación", () => {
  const todas = [
    fila(),
    fila({ clasificacion: "REVISAR_TRASPASO", razones: ["STOCK_OTRA_SUCURSAL"] }),
    fila({ clasificacion: "OBSERVAR", razones: ["STOCK_SOBRE_MAXIMO"] }),
    fila({ clasificacion: "EVIDENCIA_INSUFICIENTE", razones: ["SIN_SENALES_COMERCIALES_RECIENTES"] }),
    marcada(),
  ];
  // Solo queda fuera la de OBSERVAR sin contradicción, que es el hueco viejo
  // del módulo y se cierra aparte: esta prueba congela que no se agrandó.
  const fuera = filasSinSeccion(todas);
  assert.equal(fuera.length, 0, `quedaron fuera: ${fuera.map((f) => f.clasificacion).join(", ")}`);
});

test("estaMarcadaComoPedida no se confunde con datos ausentes", () => {
  assert.equal(estaMarcadaComoPedida(fila({ pedido_proveedor: undefined })), false);
  assert.equal(estaMarcadaComoPedida(fila({ pedido_proveedor: { marcado: "si" } })), false);
  assert.equal(estaMarcadaComoPedida(marcada()), true);
});
