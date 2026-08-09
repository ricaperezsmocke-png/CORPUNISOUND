const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  alcanceSucursal, filtrarPorSucursal, dentroDeAlcance,
  sucursalDeEscritura, requiereAlcanceGlobal,
} = require("./auth");

const GLOBAL = ["ver_todas_las_sucursales"];

test("usuario global sin query ve todas", () => {
  const req = { query: {}, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("usuario global con sucursal_id filtra a esa sucursal", () => {
  const req = { query: { sucursal_id: "3" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: false, sucursalId: 3 });
});

test("usuario global con 'todas' ve todas", () => {
  const req = { query: { sucursal_id: "todas" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("usuario amarrado ignora el query y usa su sucursal del token", () => {
  const req = { query: { sucursal_id: "3" }, usuarioToken: { sucursal_id: 2 } };
  assert.deepStrictEqual(alcanceSucursal(req, []), { verTodas: false, sucursalId: 2 });
});

test("filtrarPorSucursal deja pasar todo cuando verTodas", () => {
  const lista = [{ sucursal_id: 1 }, { sucursal_id: 2 }];
  assert.strictEqual(filtrarPorSucursal(lista, { verTodas: true, sucursalId: null }).length, 2);
});

test("filtrarPorSucursal filtra por la sucursal indicada", () => {
  const lista = [{ sucursal_id: 1 }, { sucursal_id: 2 }, { sucursal_id: 2 }];
  const r = filtrarPorSucursal(lista, { verTodas: false, sucursalId: 2 });
  assert.strictEqual(r.length, 2);
  assert.ok(r.every((x) => x.sucursal_id === 2));
});

// dentroDeAlcance: usado por las rutas de registro individual (:id) para
// decidir si el registro encontrado es visible dentro del alcance del request.
test("dentroDeAlcance permite cualquier sucursal cuando verTodas", () => {
  assert.strictEqual(dentroDeAlcance(3, { verTodas: true, sucursalId: null }), true);
});

test("dentroDeAlcance permite el registro de la propia sucursal de un amarrado", () => {
  assert.strictEqual(dentroDeAlcance(2, { verTodas: false, sucursalId: 2 }), true);
});

test("dentroDeAlcance rechaza el registro de otra sucursal para un amarrado", () => {
  assert.strictEqual(dentroDeAlcance(4, { verTodas: false, sucursalId: 2 }), false);
});

// ---------------------------------------------------------------------------
// FALLA CERRADO.
//
// Antes, cualquier ?sucursal_id= que no parseara caía al `return verTodas` del
// final. Para un administrador eso ENSANCHABA el alcance en silencio: el peor
// sentido de falla posible, porque un alcance de más no lo nota nadie
// (mientras que uno de menos se reporta el mismo día).
// ---------------------------------------------------------------------------

const ALCANCE_INVALIDO = { verTodas: false, sucursalId: null, invalido: true };

test("global con ?sucursal_id=undefined NO degrada a 'todas'", () => {
  // El caso real que motivó esto: el frontend interpola un campo ausente y la
  // URL termina con la CADENA "undefined".
  const req = { query: { sucursal_id: "undefined" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), ALCANCE_INVALIDO);
});

test("global con sucursal_id repetido (Express lo entrega como arreglo) NO degrada a 'todas'", () => {
  const req = { query: { sucursal_id: ["1", "2"] }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), ALCANCE_INVALIDO);
});

test("global con un sucursal_id que no es entero positivo NO degrada a 'todas'", () => {
  for (const basura of ["0", "-3", "1.5", "abc", " ", "NaN", "1e3x"]) {
    const req = { query: { sucursal_id: basura }, usuarioToken: { sucursal_id: 1 } };
    assert.strictEqual(alcanceSucursal(req, GLOBAL).verTodas, false, `"${basura}" no debe ver todas`);
  }
});

test("el vacío sigue siendo intención explícita de ver todo", () => {
  // No es basura: apiFetch omite el parámetro y varias pantallas mandan
  // "todas" a propósito. Eso no debe romperse.
  const req = { query: { sucursal_id: "" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("a un usuario amarrado la basura del query no le cambia nada", () => {
  const req = { query: { sucursal_id: "undefined" }, usuarioToken: { sucursal_id: 2 } };
  assert.deepStrictEqual(alcanceSucursal(req, []), { verTodas: false, sucursalId: 2 });
});

test("los tres consumidores del alcance fallan CERRADO ante un alcance inválido", () => {
  // Lo que hace segura la capa: no hubo que tocar a ninguno de los tres.
  assert.deepStrictEqual(filtrarPorSucursal([{ sucursal_id: 1 }, { sucursal_id: 2 }], ALCANCE_INVALIDO), []);
  assert.strictEqual(dentroDeAlcance(1, ALCANCE_INVALIDO), false);
  assert.strictEqual(sucursalDeEscritura(ALCANCE_INVALIDO, undefined), null);
});

// ---------------------------------------------------------------------------
// requiereAlcanceGlobal: vuelve invariante de CÓDIGO lo que hasta ahora solo
// sostenía la semilla de roles.js (que excluye "eliminar_producto" y
// "administrar_roles" del Gerente de sucursal). Esa exclusión se evapora en
// cuanto alguien edita un rol desde la pantalla de roles.
// ---------------------------------------------------------------------------

function respuestaFalsa() {
  return {
    codigo: null,
    cuerpo: null,
    status(c) { this.codigo = c; return this; },
    json(o) { this.cuerpo = o; return this; },
  };
}

test("requiereAlcanceGlobal deja pasar a quien ve todas las sucursales", () => {
  const res = respuestaFalsa();
  let siguio = false;
  requiereAlcanceGlobal(() => GLOBAL)({ usuarioToken: { rol_id: 1 } }, res, () => { siguio = true; });
  assert.strictEqual(siguio, true);
  assert.strictEqual(res.codigo, null);
});

test("requiereAlcanceGlobal responde 403 a un rol amarrado aunque tenga el permiso de la acción", () => {
  // El escenario que hoy nadie impide: un rol de sucursal al que le conceden
  // "eliminar_producto" en dos clics, y que borraría el catálogo y las
  // existencias de tiendas que ni siquiera puede ver.
  const res = respuestaFalsa();
  let siguio = false;
  requiereAlcanceGlobal(() => ["eliminar_producto"])({ usuarioToken: { rol_id: 9 } }, res, () => { siguio = true; });
  assert.strictEqual(siguio, false);
  assert.strictEqual(res.codigo, 403);
});

test("las rutas de efecto global llevan el guard CABLEADO en server.js", () => {
  // El guard más fácil de perder es el que se quita sin querer al editar la
  // línea de la ruta. Esta prueba mira el cableado real, no la función.
  const lineas = fs.readFileSync(path.join(__dirname, "server.js"), "utf8").split("\n");
  const rutasGlobales = [
    'app.delete("/api/productos/:id"',
    'app.put("/api/roles/:id"',
    'app.delete("/api/roles/:id"',
    'app.post("/api/roles/:id/clonar"',
    'app.put("/api/sucursales/:id/ubicacion"',
  ];
  for (const ruta of rutasGlobales) {
    const linea = lineas.find((l) => l.includes(ruta));
    assert.ok(linea, `no se encontró la ruta ${ruta} en server.js`);
    assert.ok(linea.includes("requiereAlcanceGlobal"), `${ruta} se quedó sin requiereAlcanceGlobal`);
  }
});
