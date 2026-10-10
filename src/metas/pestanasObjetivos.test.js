import { test } from "node:test";
import assert from "node:assert/strict";
import { pestanasObjetivos, esPestanaMetas } from "./pestanasObjetivos.js";
import * as navegacion from "./pestanasObjetivos.js";

const claves = (opciones) => pestanasObjetivos(opciones).map((p) => p.clave);

test("vendedor ligado ve sus cinco pestañas sin recibir las de tienda ni administración", () => {
  assert.deepEqual(claves({ miVendedorId: 7, permisos: ["usar_gerente_ventas"] }), [
    "mi-avance", "mi-venta", "mis-actividades", "mis-creditos", "mis-metas",
  ]);
});

test("sin vendedor ligado no hay pestañas personales, aunque tenga permisos vecinos", () => {
  assert.deepEqual(claves({ miVendedorId: null, permisos: ["usar_gerente_ventas", "ver_todas_las_sucursales"] }), []);
});

test("jefatura con alcance de tienda ve ventas y metas de tienda en orden", () => {
  assert.deepEqual(claves({ veTienda: true, permisos: ["editar_objetivos_venta"] }), [
    "tienda-avance", "tienda-venta", "tienda-actividades", "tienda-marcas", "metas-tienda",
  ]);
  assert.deepEqual(claves({ veTienda: false, permisos: ["editar_objetivos_venta"] }), []);
});

test("administrar metas permite tablero y administración sin vendedor ni acceso a ventas", () => {
  assert.deepEqual(claves({ permisos: ["administrar_metas_personalizadas"] }), ["metas-tienda", "administrar-metas"]);
});

test("anular capturas permite metas de tienda pero no administrar ni cerrar", () => {
  assert.deepEqual(claves({ permisos: ["anular_capturas_metas"] }), ["metas-tienda"]);
});

test("cerrar mes permite acceder al cierre aun sin vendedor ni otras pestañas", () => {
  assert.deepEqual(claves({ permisos: ["cerrar_mes_objetivos"] }), ["cierre-mes"]);
});

test("todos los accesos conservan el orden aprobado sin duplicar metas de tienda", () => {
  const pestañas = pestanasObjetivos({
    miVendedorId: 7, veTienda: true,
    permisos: ["administrar_metas_personalizadas", "anular_capturas_metas", "cerrar_mes_objetivos"],
  });
  assert.deepEqual(pestañas.map((p) => p.etiqueta), [
    "Mi avance", "Mi venta", "Mis actividades", "Mis créditos", "Mis metas extra",
    "Avance", "Venta", "Actividades", "Marcas, productos y créditos", "Metas extra",
    "Administrar metas extra", "Cierre del mes",
  ]);
});

const todos = () => pestanasObjetivos({
  miVendedorId: 7, veTienda: true,
  permisos: ["administrar_metas_personalizadas", "anular_capturas_metas", "cerrar_mes_objetivos"],
});

test("cada pestaña pertenece al grupo aprobado", () => {
  assert.deepEqual(todos().map(({ clave, grupo }) => [clave, grupo]), [
    ["mi-avance", "mio"], ["mi-venta", "mio"], ["mis-actividades", "mio"], ["mis-creditos", "mio"], ["mis-metas", "mio"],
    ["tienda-avance", "tienda"], ["tienda-venta", "tienda"], ["tienda-actividades", "tienda"],
    ["tienda-marcas", "tienda"], ["metas-tienda", "tienda"], ["administrar-metas", "admin"], ["cierre-mes", "admin"],
  ]);
});

test("metas extra usa ListChecks y ningún grupo repite iconos", () => {
  const pestanas = todos();
  assert.deepEqual(pestanas.filter((p) => ["mis-metas", "metas-tienda"].includes(p.clave)).map((p) => p.icono),
    ["ListChecks", "ListChecks"]);
  assert.equal(pestanas.find((p) => p.clave === "tienda-avance").icono, "BarChart3");
  assert.equal(pestanas.find((p) => p.clave === "administrar-metas").icono, "Settings2");
  for (const grupo of ["mio", "tienda", "admin"]) {
    const iconos = pestanas.filter((p) => p.grupo === grupo).map((p) => p.icono);
    assert.equal(new Set(iconos).size, iconos.length, grupo);
  }
});

test("grupos conserva el orden aprobado aunque las pestañas lleguen en otro orden", () => {
  assert.equal(typeof navegacion.gruposObjetivos, "function");
  assert.deepEqual(navegacion.gruposObjetivos(todos().reverse()), [
    { clave: "mio", etiqueta: "Lo mío" },
    { clave: "tienda", etiqueta: "La tienda" },
    { clave: "admin", etiqueta: "Administración" },
  ]);
});

test("grupos omite los vacíos, incluso con acceso exclusivo a metas o cierre", () => {
  assert.equal(typeof navegacion.gruposObjetivos, "function");
  const casos = [
    [{}, []],
    [{ miVendedorId: 7 }, [{ clave: "mio", etiqueta: "Lo mío" }]],
    [{ permisos: ["anular_capturas_metas"] }, [{ clave: "tienda", etiqueta: "La tienda" }]],
    [{ permisos: ["cerrar_mes_objetivos"] }, [{ clave: "admin", etiqueta: "Administración" }]],
    [{ permisos: ["administrar_metas_personalizadas"] }, [
      { clave: "tienda", etiqueta: "La tienda" }, { clave: "admin", etiqueta: "Administración" },
    ]],
  ];
  for (const [opciones, esperado] of casos) {
    assert.deepEqual(navegacion.gruposObjetivos(pestanasObjetivos(opciones)), esperado);
  }
});

const resolver = (opciones) => {
  assert.equal(typeof navegacion.resolverActiva, "function");
  return navegacion.resolverActiva(opciones);
};

test("al entrar abre la primera pestaña del primer grupo disponible", () => {
  assert.deepEqual(resolver({ pestanas: todos() }), { grupo: "mio", pestana: "mi-avance" });
  assert.deepEqual(resolver({ pestanas: pestanasObjetivos({ veTienda: true }) }), { grupo: "tienda", pestana: "tienda-avance" });
  assert.deepEqual(resolver({ pestanas: pestanasObjetivos({ permisos: ["cerrar_mes_objetivos"] }) }),
    { grupo: "admin", pestana: "cierre-mes" });
});

test("sin pestañas disponibles no inventa un grupo ni una pestaña", () => {
  assert.deepEqual(resolver({ pestanas: [], grupo: "mio", pestana: "mi-venta", ultimaPorGrupo: { mio: "mis-metas" } }),
    { grupo: null, pestana: null });
});

test("al cambiar a un grupo sin historial abre su primera pestaña", () => {
  assert.deepEqual(resolver({ pestanas: todos(), grupo: "tienda", ultimaPorGrupo: { mio: "mis-creditos" } }),
    { grupo: "tienda", pestana: "tienda-avance" });
});

test("al regresar recupera la última pestaña de cada grupo sin modificar el historial", () => {
  const ultimaPorGrupo = Object.freeze({ mio: "mis-creditos", tienda: "metas-tienda", admin: "cierre-mes" });
  for (const [grupo, pestana] of [["mio", "mis-creditos"], ["tienda", "metas-tienda"], ["admin", "cierre-mes"]]) {
    assert.deepEqual(resolver({ pestanas: todos(), grupo, ultimaPorGrupo }), { grupo, pestana });
  }
});

test("elegir una pestaña directamente cambia también el grupo y prevalece sobre el historial", () => {
  assert.deepEqual(resolver({ pestanas: todos(), grupo: "admin", pestana: "mi-avance", ultimaPorGrupo: { mio: "mis-metas" } }),
    { grupo: "mio", pestana: "mi-avance" });
});

test("conserva una pestaña elegida que sigue disponible", () => {
  assert.deepEqual(resolver({ pestanas: todos(), grupo: "tienda", pestana: "tienda-marcas" }),
    { grupo: "tienda", pestana: "tienda-marcas" });
});

test("si desaparece la elegida cae a la primera del grupo aunque haya otra recordada", () => {
  const pestanas = todos().filter((p) => p.clave !== "tienda-marcas");
  assert.deepEqual(resolver({ pestanas, grupo: "tienda", pestana: "tienda-marcas", ultimaPorGrupo: { tienda: "metas-tienda" } }),
    { grupo: "tienda", pestana: "tienda-avance" });
});

test("si desaparece el grupo cae a la primera pestaña del primer grupo", () => {
  assert.deepEqual(resolver({ pestanas: pestanasObjetivos({ miVendedorId: 7 }), grupo: "admin", pestana: "cierre-mes",
    ultimaPorGrupo: { mio: "mis-metas" } }), { grupo: "mio", pestana: "mi-avance" });
});

test("descarta una pestaña recordada inexistente o que pertenece a otro grupo", () => {
  for (const tienda of ["retirada", "mi-venta"]) {
    assert.deepEqual(resolver({ pestanas: todos(), grupo: "tienda", ultimaPorGrupo: { tienda } }),
      { grupo: "tienda", pestana: "tienda-avance" });
  }
});

test("solo las tres pestañas de metas usan el selector de periodo compartido", () => {
  for (const clave of ["mis-metas", "metas-tienda", "administrar-metas"]) assert.equal(esPestanaMetas(clave), true, clave);
  for (const clave of ["mi-avance", "tienda-venta", "cierre-mes", null, undefined]) assert.equal(esPestanaMetas(clave), false, clave);
});
