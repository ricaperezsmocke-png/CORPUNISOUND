import { test } from "node:test";
import assert from "node:assert/strict";
import { pestanasObjetivos, esPestanaMetas } from "./pestanasObjetivos.js";

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
    "Mi avance", "Mi venta", "Mis actividades", "Mis créditos", "Mis metas",
    "Avance de la tienda", "Venta de la tienda", "Actividades de la tienda", "Marcas, productos y créditos", "Metas de la tienda",
    "Administrar metas", "Cierre del mes",
  ]);
});

test("solo las tres pestañas de metas usan el selector de periodo compartido", () => {
  for (const clave of ["mis-metas", "metas-tienda", "administrar-metas"]) assert.equal(esPestanaMetas(clave), true, clave);
  for (const clave of ["mi-avance", "tienda-venta", "cierre-mes", null, undefined]) assert.equal(esPestanaMetas(clave), false, clave);
});
