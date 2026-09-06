const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { reconciliarTrasRestaurar, validarAntesDeRestaurar } = require("./reconciliarRestauracion");
const { sembrarCajas } = require("./cajas");
const { esDeLaEraSellada } = require("./corteEpoca");

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
  const { db: DB } = reconciliarTrasRestaurar(fotoVieja());

  assert.ok(Array.isArray(DB.pos.cajas) && DB.pos.cajas.length > 0);
  for (const sucursal of DB.pos.sucursales) {
    const suyas = DB.pos.cajas.filter((c) => c.sucursal_id === sucursal.id);
    assert.strictEqual(suyas.length, 2, `${sucursal.nombre} debe quedar con sus dos cajas`);
    assert.strictEqual(suyas.filter((c) => c.predeterminada).length, 1);
  }
});

test("restaurar una foto sin marca de agua le pone una, para no volver a la regla del reloj", () => {
  const { db: DB } = reconciliarTrasRestaurar(fotoVieja());
  assert.ok(DB.pos.corte_epoca, "sin epoca vuelve la ventana de tiempo y con ella los huecos");
  assert.ok(DB.pos.corte_epoca <= new Date().toISOString());
});

test("restaurar conserva una marca de agua vieja y coherente", () => {
  const DB = fotoVieja();
  const original = "2026-09-01T09:00:00.000Z";
  DB.pos.corte_epoca = original;

  reconciliarTrasRestaurar(DB);

  assert.strictEqual(
    DB.pos.corte_epoca, original,
    "mover la epoca hacia atras volveria a tratar como historicos movimientos ya sellados"
  );
});

test("restaurar reemplaza una marca de agua futura y los movimientos nuevos se rigen por sello", () => {
  const DB = fotoVieja();
  DB.pos.corte_epoca = "2999-01-01T00:00:00.000Z";
  const antes = new Date().toISOString();

  reconciliarTrasRestaurar(DB);

  const despues = new Date().toISOString();
  assert.ok(DB.pos.corte_epoca >= antes, "la epoca corregida debe nacer al restaurar");
  assert.ok(DB.pos.corte_epoca <= despues, "la epoca corregida no puede quedar en el futuro");
  assert.strictEqual(
    esDeLaEraSellada(despues, DB), true,
    "un movimiento nuevo debe entrar a la rama que se rige por corte_id"
  );
});

test("restaurar sigue reconciliando lo que ya reconciliaba", () => {
  const DB = fotoVieja();
  delete DB.pos.tareas_venta;
  const administrador = DB.admin.roles.find((r) => r.nombre === "Administrador");
  administrador.permisos = administrador.permisos.filter((p) => p !== "restaurar_respaldo");

  reconciliarTrasRestaurar(DB);

  assert.ok(Array.isArray(DB.pos.tareas_venta?.tareas), "las tareas de venta se reconstruyen");
  assert.ok(DB.pos.sucursales.some((s) => s.nombre === "CEDIS"), "CEDIS se reconcilia");
  assert.ok(administrador.permisos.includes("restaurar_respaldo"), "los roles se reconcilian");
});

/**
 * Restaurar es la PUERTA DE EMERGENCIA. El arranque puede permitirse morir ante
 * un catalogo de cajas torcido porque existe esta salida; la salida no puede
 * morir por lo mismo, o un solo booleano mal puesto deja la tienda sin sistema
 * y sin manera de recuperarlo. Decision de Victor, 2026-09-04.
 */
test("una foto con dos predeterminadas se repara al restaurar, no se rechaza", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  // La foto viene torcida: las dos cajas de Ocosingo marcadas como la de por defecto.
  for (const caja of DB.pos.cajas.filter((c) => c.sucursal_id === 1)) caja.predeterminada = true;

  // No debe lanzar: restaurar es la puerta de emergencia y no se puede cerrar.
  assert.doesNotThrow(() => validarAntesDeRestaurar(DB));

  const { reparaciones } = reconciliarTrasRestaurar(DB);
  const deOcosingo = DB.pos.cajas.filter((c) => c.sucursal_id === 1);
  assert.strictEqual(deOcosingo.filter((c) => c.predeterminada).length, 1);
  assert.strictEqual(deOcosingo.find((c) => c.predeterminada).nombre, "Administrativa");
  assert.ok(reparaciones.some((r) => r.includes("Ocosingo")), `reparaciones: ${reparaciones}`);
});

test("una foto sin ninguna predeterminada tambien se repara", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  for (const caja of DB.pos.cajas.filter((c) => c.sucursal_id === 1)) caja.predeterminada = false;

  reconciliarTrasRestaurar(DB);
  const deOcosingo = DB.pos.cajas.filter((c) => c.sucursal_id === 1);
  assert.strictEqual(deOcosingo.filter((c) => c.predeterminada).length, 1);
  assert.strictEqual(deOcosingo.find((c) => c.predeterminada).nombre, "Administrativa");
});

/**
 * Los ids de caja NO se pueden renumerar: las ventas, los abonos, los gastos y
 * los cortes los referencian. Reparar la marca de "predeterminada" es seguro;
 * reasignar ids convertiria el dinero de una caja en dinero de otra.
 */
test("reparar no cambia los ids de las cajas existentes", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const idsAntes = DB.pos.cajas.map((c) => c.id).sort((a, b) => a - b);
  for (const caja of DB.pos.cajas.filter((c) => c.sucursal_id === 1)) caja.predeterminada = true;

  reconciliarTrasRestaurar(DB);

  assert.deepStrictEqual(DB.pos.cajas.map((c) => c.id).sort((a, b) => a - b), idsAntes);
});

test("una foto sana no reporta reparaciones que nadie hizo", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);

  const { reparaciones } = reconciliarTrasRestaurar(DB);

  assert.deepStrictEqual(reparaciones, []);
});
