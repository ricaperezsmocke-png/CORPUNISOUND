const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { reconciliarTrasRestaurar } = require("./reconciliarRestauracion");

/**
 * Restaurar reemplaza colecciones enteras con una foto vieja. Estas pruebas
 * cuidan el caso que la auditoria encontro: una foto anterior a las cajas
 * dejaba el sistema sin catalogo y sin marca de agua hasta el siguiente
 * reinicio — con el corte bloqueado, las ventas guardandose sin caja, y la
 * regla vieja de tiempo de vuelta, que es la que deja movimientos que ningun
 * corte reclama.
 */
function fotoVieja() {
  const DB = construirDBPrueba();
  delete DB.pos.cajas;        // el respaldo es anterior a las cajas
  delete DB.pos.corte_epoca;  // y anterior al sellado
  return DB;
}

test("restaurar una foto anterior a las cajas deja las cajas sembradas", () => {
  const DB = reconciliarTrasRestaurar(fotoVieja(), () => {});

  assert.ok(Array.isArray(DB.pos.cajas) && DB.pos.cajas.length > 0);
  for (const sucursal of DB.pos.sucursales) {
    const suyas = DB.pos.cajas.filter((c) => c.sucursal_id === sucursal.id);
    assert.strictEqual(suyas.length, 2, `${sucursal.nombre} debe quedar con sus dos cajas`);
    assert.strictEqual(suyas.filter((c) => c.predeterminada).length, 1);
  }
});

test("restaurar una foto sin marca de agua le pone una, para no volver a la regla del reloj", () => {
  const DB = reconciliarTrasRestaurar(fotoVieja(), () => {});
  assert.ok(DB.pos.corte_epoca, "sin epoca vuelve la ventana de tiempo y con ella los huecos");
  assert.ok(DB.pos.corte_epoca <= new Date().toISOString());
});

test("restaurar NO retrocede una marca de agua que ya existe", () => {
  const DB = fotoVieja();
  const original = "2026-09-01T09:00:00.000Z";
  DB.pos.corte_epoca = original;

  reconciliarTrasRestaurar(DB, () => {});

  assert.strictEqual(
    DB.pos.corte_epoca, original,
    "mover la epoca hacia atras volveria a tratar como historicos movimientos ya sellados"
  );
});

test("restaurar sigue reconciliando lo que ya reconciliaba", () => {
  const DB = fotoVieja();
  delete DB.pos.tareas_venta;

  reconciliarTrasRestaurar(DB, () => {});

  assert.ok(Array.isArray(DB.pos.tareas_venta?.tareas), "las tareas de venta se reconstruyen");
  assert.ok(DB.pos.sucursales.some((s) => s.nombre === "CEDIS"), "CEDIS se reconcilia");
});
