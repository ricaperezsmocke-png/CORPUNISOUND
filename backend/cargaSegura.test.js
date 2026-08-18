/**
 * cargaSegura.test.js — Prueba el ayudante del frontend (src/cargaSegura.js).
 *
 * Vive en backend/ porque es donde corre `node --test` en este repo. El módulo
 * probado no importa nada de Vite justamente para poder llegar hasta aquí.
 *
 * Lo que se cuida: que un fallo NUNCA se pueda confundir con "no hay datos".
 * Esa confusión es la que hacía que una pantalla dijera "no hay gastos" cuando
 * en realidad no había podido preguntar.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const RUTA = pathToFileURL(path.join(__dirname, "..", "src", "cargaSegura.js")).href;
const cargar = () => import(RUTA);

/** Una respuesta de fetch de mentiras. */
function respuesta({ ok = true, cuerpo = [], revienta = false } = {}) {
  return {
    ok,
    json: async () => {
      if (revienta) throw new Error("cuerpo ilegible");
      return cuerpo;
    },
  };
}

test("éxito: devuelve los datos y NINGÚN error", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => respuesta({ cuerpo: [{ id: 1 }] }), "los gastos");
  assert.deepStrictEqual(r.datos, [{ id: 1 }]);
  assert.strictEqual(r.error, null, "un éxito no puede traer error");
});

test("lista vacía DE VERDAD: datos vacíos y sin error — es un dato, no un fallo", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => respuesta({ cuerpo: [] }), "los gastos");
  assert.deepStrictEqual(r.datos, []);
  assert.strictEqual(r.error, null, "no hay nada registrado es una respuesta legítima y NO debe alarmar");
});

test("el backend contesta error: lista vacía PERO con error — esta es la distinción", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => respuesta({ ok: false, cuerpo: { error: "No tienes permiso" } }), "los gastos");
  assert.deepStrictEqual(r.datos, []);
  assert.ok(r.error, "sin error, la pantalla diría 'no hay gastos' y estaría mintiendo");
  assert.match(r.error, /No tienes permiso/, "se conserva el motivo que dio el backend");
});

test("el mensaje de fallo desmiente explícitamente el 'no hay nada'", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => respuesta({ ok: false, cuerpo: {} }), "los gastos");
  assert.match(r.error, /NO significa que no haya datos/, "hay que decirlo con todas sus letras");
  assert.match(r.error, /los gastos/, "y nombrar qué fue lo que no se pudo cargar");
});

test("sin conexión: lista vacía con error, no una excepción que tumbe la pantalla", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => { throw new Error("failed to fetch"); }, "las sucursales");
  assert.deepStrictEqual(r.datos, []);
  assert.match(r.error, /No se pudo conectar/);
  assert.match(r.error, /NO significa que no haya datos/);
  // Nombrar QUÉ no cargó importa: una pantalla pide varias cosas a la vez, y
  // "no se pudo conectar" a secas no dice si falta el catálogo o los precios.
  assert.match(r.error, /las sucursales/);
});

test("error con cuerpo ilegible: sigue siendo un fallo, no un vacío", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => respuesta({ ok: false, revienta: true }), "los respaldos");
  assert.deepStrictEqual(r.datos, []);
  assert.ok(r.error, "que no se pueda leer el motivo no lo convierte en 'no hay nada'");
});

test("respuesta 200 que NO es lista: se trata como fallo en vez de reventar en el .map", async () => {
  const { pedirLista } = await cargar();
  const r = await pedirLista(async () => respuesta({ cuerpo: { error: "algo raro" } }), "las sucursales");
  assert.deepStrictEqual(r.datos, [], "datos siempre tiene que ser un arreglo pintable");
  assert.ok(r.error, "y avisar, porque un objeto aquí tumbaba la pantalla entera");
});

test("pedirDato: éxito devuelve el objeto sin error", async () => {
  const { pedirDato } = await cargar();
  const r = await pedirDato(async () => respuesta({ cuerpo: { total: 5 } }), "el estado de los respaldos");
  assert.deepStrictEqual(r.datos, { total: 5 });
  assert.strictEqual(r.error, null);
});

test("pedirDato: en el fallo devuelve null CON error, no un objeto vacío mentiroso", async () => {
  const { pedirDato } = await cargar();
  const r = await pedirDato(async () => respuesta({ ok: false, cuerpo: { error: "sin permiso" } }), "el corte en curso");
  assert.strictEqual(r.datos, null);
  assert.match(r.error, /sin permiso/);
});

test("pedirDato: sin conexión también avisa", async () => {
  const { pedirDato } = await cargar();
  const r = await pedirDato(async () => { throw new Error("failed to fetch"); }, "el corte en curso");
  assert.strictEqual(r.datos, null);
  assert.match(r.error, /No se pudo conectar/);
  assert.match(r.error, /el corte en curso/, "tiene que nombrar qué fue lo que no cargó");
});
