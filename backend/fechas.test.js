const { test } = require("node:test");
const assert = require("node:assert");
const { fechaLocal, ahora, ZONA_TIENDA } = require("./fechas");

test("la zona de la tienda es la de México, no un desfase escrito a mano", () => {
  assert.strictEqual(ZONA_TIENDA, "America/Mexico_City");
});

test("fechaLocal: un instante de la NOCHE pertenece al día que la tienda vivió", () => {
  // Chiapas es UTC-6. Las 8 de la noche del 31 de julio son las 02:00 UTC del
  // 1 de agosto. Antes de este arreglo, el sistema guardaba "2026-08-01" y el
  // gasto se contaba en el mes equivocado.
  assert.strictEqual(fechaLocal("2026-08-01T02:00:00.000Z"), "2026-07-31");
  assert.strictEqual(fechaLocal("2026-08-01T05:59:00.000Z"), "2026-07-31");
});

test("fechaLocal: la frontera real del día son las 06:00 UTC", () => {
  assert.strictEqual(fechaLocal("2026-08-01T05:59:59.000Z"), "2026-07-31");
  assert.strictEqual(fechaLocal("2026-08-01T06:00:00.000Z"), "2026-08-01");
});

test("fechaLocal: un instante de la mañana no se mueve", () => {
  assert.strictEqual(fechaLocal("2026-07-31T15:00:00.000Z"), "2026-07-31");
});

test("fechaLocal: acepta Date, string ISO, y sin argumento devuelve hoy", () => {
  assert.strictEqual(fechaLocal(new Date("2026-08-01T02:00:00.000Z")), "2026-07-31");
  assert.match(fechaLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test("fechaLocal: siempre devuelve el formato YYYY-MM-DD, con ceros a la izquierda", () => {
  assert.strictEqual(fechaLocal("2026-03-05T18:00:00.000Z"), "2026-03-05");
  assert.strictEqual(fechaLocal("2026-01-01T06:00:00.000Z"), "2026-01-01");
});

test("las fechas locales se pueden ordenar y comparar como texto", () => {
  // De esto dependen todos los filtros de rango de los reportes (enRango).
  assert.ok(fechaLocal("2026-07-31T18:00:00.000Z") < fechaLocal("2026-08-02T18:00:00.000Z"));
});

test("fechaLocal: da el mismo día sin importar si el ISO trae el desfase local incrustado o está normalizado a Z", () => {
  // Esto documenta por qué mercadolibre.js usa fechaLocal(orden.date_created) en vez
  // de orden.date_created?.slice(0, 10): la API de ML podría mandar cualquiera de
  // los dos formatos y ambos son el MISMO instante (20:56 del 31 de julio en
  // Chiapas). Un slice(0, 10) solo acierta en el primer caso; fechaLocal() acierta
  // en los dos.
  assert.strictEqual(fechaLocal("2026-07-31T20:56:35.000-06:00"), "2026-07-31");
  assert.strictEqual(fechaLocal("2026-08-01T02:56:35.000Z"), "2026-07-31");
});

test("fechaLocal: una fecha inválida cae en HOY en vez de reventar", () => {
  // fechaLocal() alimenta fecha, fecha_alta, ultimo_contacto, etc. de ventas, cortes
  // y gastos. La única llamada que recibe un dato de fuera del sistema es la de
  // mercadolibre.js (orden.date_created). Si la API de ML llegara a mandar algo
  // malformado, es preferible una fecha de respaldo a que reviente toda la
  // importación de la orden — igual que ya pasa con undefined/null/"".
  assert.match(fechaLocal("basura"), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(fechaLocal("2026-13-45"), /^\d{4}-\d{2}-\d{2}$/);
});

test("ahora() sigue devolviendo un instante ISO en UTC", () => {
  // Las marcas de tiempo NO se localizan: la lógica de turnos del corte las
  // compara entre sí y mezclar marcos la rompería.
  const t = ahora();
  assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
