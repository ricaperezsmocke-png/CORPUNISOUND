/**
 * radarReposicion.test.js — Cuántas piezas y cuánto dinero.
 *
 * Hasta aquí la pantalla decía "revisar para compra" y ahí se detenía: Victor
 * tenía que reconstruir a mano cuánto pedir mirando existencia, mínimo y
 * tránsito en columnas distintas. Esto da el paso que faltaba.
 *
 * LO QUE SE PUEDE CALCULAR CON HONESTIDAD:
 *
 *   piezas = mínimo − existencia − lo que ya viene en camino de otra tienda
 *
 * Y el dinero que cuesta cubrir esa brecha, usando el ÚLTIMO COSTO CONOCIDO de
 * ese producto, siempre acompañado de la fecha de ese costo: es lo que costó la
 * última vez, no una cotización de hoy.
 *
 * LO QUE NO SE INVENTA, y por qué cada caso se bloquea en vez de adivinar:
 *
 * - Sin mínimo configurado no hay objetivo que alcanzar. Poner uno por nuestra
 *   cuenta sería decidir el negocio de Victor desde el código.
 * - Con la existencia dañada o ausente, cualquier resta es basura.
 * - Si la fila ya está marcada como "ya lo pedí", no se propone cantidad: para
 *   eso se marcó.
 * - Sin costo conocido, el importe queda vacío. NUNCA cero: cero es un precio,
 *   y "no sé" no es un precio.
 *
 * Y una regla que sostiene todo lo demás: la demanda registrada NO se suma al
 * mínimo. Sirve para priorizar qué mirar primero, no para inflar la compra.
 * Sumar ventas + demanda + mínimo duplicaría la misma necesidad contada de
 * tres formas.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calcularReposicion } = require("./radarDemandaReglas");

function expediente(extra = {}) {
  return {
    producto: { producto_id: 10, sku: "CUERDA-01", nombre: "Cuerdas", producto_activo: true },
    sucursal: { sucursal_id: 1, sucursal_nombre: "Ocosingo" },
    inventario: {
      existencia_registrada: true, cantidad_actual: 2, cantidad_minima: 10, cantidad_maxima: 0,
    },
    traspasos: { cantidad_entrante_en_transito: 0, numero_traspasos_entrantes: 0 },
    compras_historicas: { ultimo_costo: 50, ultima_recepcion_fecha: "2026-07-01" },
    pedido_proveedor: { marcado: false },
    radar: { "30d": { solicitudes: 0 } },
    ...extra,
  };
}

test("la brecha es mínimo menos existencia: 10 − 2 = 8 piezas", () => {
  const r = calcularReposicion(expediente());
  assert.equal(r.piezas, 8);
  assert.equal(r.bloqueo, null);
});

test("lo que ya viene en camino de otra tienda se descuenta", () => {
  const r = calcularReposicion(expediente({
    traspasos: { cantidad_entrante_en_transito: 3, numero_traspasos_entrantes: 1 },
  }));
  assert.equal(r.piezas, 5, "10 − 2 − 3");
  assert.equal(r.incluye_transito, 3);
});

test("el importe es piezas por el último costo, y dice de cuándo es ese costo", () => {
  const r = calcularReposicion(expediente());
  assert.equal(r.importe_estimado, 400, "8 piezas × $50");
  assert.equal(r.costo_unitario, 50);
  assert.equal(r.costo_fecha, "2026-07-01");
});

test("sin costo conocido el importe queda VACÍO, nunca en cero", () => {
  const r = calcularReposicion(expediente({
    compras_historicas: { ultimo_costo: null, ultima_recepcion_fecha: null },
  }));
  assert.equal(r.piezas, 8, "las piezas sí se saben");
  assert.equal(r.importe_estimado, null, "cero sería un precio, y no lo sabemos");
  assert.equal(r.costo_unitario, null);
});

test("sin mínimo configurado no se inventa un objetivo", () => {
  const r = calcularReposicion(expediente({
    inventario: { existencia_registrada: true, cantidad_actual: 0, cantidad_minima: 0, cantidad_maxima: 0 },
  }));
  assert.equal(r.piezas, null);
  assert.equal(r.bloqueo, "MINIMO_NO_CONFIGURADO");
});

test("con la existencia ausente o dañada no se resta nada", () => {
  for (const inventario of [
    { existencia_registrada: false, cantidad_actual: null, cantidad_minima: 10 },
    { existencia_registrada: true, cantidad_actual: "muchas", cantidad_minima: 10 },
    { existencia_registrada: true, cantidad_actual: NaN, cantidad_minima: 10 },
  ]) {
    const r = calcularReposicion(expediente({ inventario }));
    assert.equal(r.piezas, null, `no debería calcular con ${JSON.stringify(inventario)}`);
    assert.equal(r.bloqueo, "EXISTENCIA_NO_CONFIABLE");
  }
});

test("si ya se marcó como pedido, no se propone cantidad: para eso se marcó", () => {
  const r = calcularReposicion(expediente({
    pedido_proveedor: { marcado: true, dias_restantes: 15, marcado_por: "Victor" },
  }));
  assert.equal(r.piezas, null);
  assert.equal(r.bloqueo, "PEDIDO_YA_MARCADO");
  assert.equal(r.importe_estimado, null);
});

test("si ya hay suficiente, la brecha es cero y se dice por qué", () => {
  const r = calcularReposicion(expediente({
    inventario: { existencia_registrada: true, cantidad_actual: 15, cantidad_minima: 10, cantidad_maxima: 0 },
  }));
  assert.equal(r.piezas, 0);
  assert.equal(r.bloqueo, "SIN_FALTANTE");
  assert.equal(r.importe_estimado, null, "no hay nada que comprar, no hay importe");
});

test("la demanda registrada NO se suma al mínimo: no infla la compra", () => {
  const sinDemanda = calcularReposicion(expediente());
  const conMuchaDemanda = calcularReposicion(expediente({
    radar: { "30d": { solicitudes: 40, cantidad_solicitada: 40 } },
  }));
  assert.equal(conMuchaDemanda.piezas, sinDemanda.piezas, "40 solicitudes no cambian cuánto se repone");
});

test("un tránsito que ya cubre el mínimo deja la brecha en cero", () => {
  const r = calcularReposicion(expediente({
    traspasos: { cantidad_entrante_en_transito: 20, numero_traspasos_entrantes: 2 },
  }));
  assert.equal(r.piezas, 0);
  assert.equal(r.bloqueo, "SIN_FALTANTE");
});

test("los importes se redondean a centavos, no arrastran decimales", () => {
  const r = calcularReposicion(expediente({
    inventario: { existencia_registrada: true, cantidad_actual: 0, cantidad_minima: 3, cantidad_maxima: 0 },
    compras_historicas: { ultimo_costo: 33.333, ultima_recepcion_fecha: "2026-07-01" },
  }));
  assert.equal(r.piezas, 3);
  assert.equal(r.importe_estimado, 100);
});

test("un costo absurdo o negativo no produce un importe", () => {
  for (const ultimo_costo of [-5, Infinity, NaN, "gratis"]) {
    const r = calcularReposicion(expediente({
      compras_historicas: { ultimo_costo, ultima_recepcion_fecha: "2026-07-01" },
    }));
    assert.equal(r.importe_estimado, null, `no debería costear con ${String(ultimo_costo)}`);
  }
});

// --- Existencia negativa ----------------------------------------------------
// Lo encontró la revisión independiente de Codex. Reproducido ejecutando:
// con existencia -5 y mínimo 10 el cálculo pedía 15 piezas y $750. Una
// existencia por debajo de cero es un inventario que no cuadra, y reponer
// "hasta el mínimo" sobre ese número compra de más basándose en un error.
// Primero se cuadra el inventario; el sistema lo dice en vez de dar una cifra.

test("una existencia NEGATIVA no produce una cantidad: primero hay que cuadrar el inventario", () => {
  const r = calcularReposicion(expediente({
    inventario: { existencia_registrada: true, cantidad_actual: -5, cantidad_minima: 10, cantidad_maxima: 0 },
  }));
  assert.equal(r.piezas, null, "pedía 15 piezas, 5 de más, por un inventario en negativo");
  assert.equal(r.bloqueo, "EXISTENCIA_NEGATIVA");
  assert.equal(r.importe_estimado, null);
});

test("cero sigue siendo un dato válido: agotado no es lo mismo que descuadrado", () => {
  const r = calcularReposicion(expediente({
    inventario: { existencia_registrada: true, cantidad_actual: 0, cantidad_minima: 10, cantidad_maxima: 0 },
  }));
  assert.equal(r.piezas, 10);
  assert.equal(r.bloqueo, null);
});

// --- Bordes numéricos -------------------------------------------------------
// También de la revisión independiente. Reproducidos ejecutando.

test("un mínimo absurdo no produce piezas infinitas que lleguen como vacías", () => {
  const r = calcularReposicion(expediente({
    inventario: { existencia_registrada: true, cantidad_actual: 0, cantidad_minima: "1e309", cantidad_maxima: 0 },
  }));
  // Antes: piezas Infinity, que JSON convierte en null — la pantalla decía
  // "sin cantidad calculable" sin poder explicar por qué.
  assert.equal(r.piezas, null);
  assert.equal(r.bloqueo, "MINIMO_NO_CONFIABLE");
  assert.equal(r.importe_estimado, null);
});

test("un tránsito NEGATIVO no infla las piezas", () => {
  const r = calcularReposicion(expediente({
    traspasos: { cantidad_entrante_en_transito: -20, numero_traspasos_entrantes: 1 },
  }));
  assert.equal(r.piezas, 8, "pedía 28: restar un tránsito negativo suma");
  assert.equal(r.incluye_transito, 0, "un tránsito imposible se ignora, no se resta");
});

test("un tránsito no numérico tampoco entra en la cuenta", () => {
  for (const cantidad_entrante_en_transito of ["mucho", NaN, Infinity, null]) {
    const r = calcularReposicion(expediente({
      traspasos: { cantidad_entrante_en_transito, numero_traspasos_entrantes: 1 },
    }));
    assert.equal(r.piezas, 8, `falló con tránsito ${String(cantidad_entrante_en_transito)}`);
  }
});
