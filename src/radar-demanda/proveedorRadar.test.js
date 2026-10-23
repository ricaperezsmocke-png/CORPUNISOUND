import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVEEDOR_VACIO, filtrarProveedores, validarProveedorFormulario, datosProveedor, etiquetaProveedor, textoDias,
} from "./proveedorRadar.js";

const LISTA = [
  { clave: "casa veerkamp", nombre: "Casa Veerkamp" },
  { clave: "fender mexico", nombre: "Fender México" },
  { clave: "yamaha de mexico", nombre: "Yamaha de México" },
];

test("el buscador ignora acentos y mayúsculas y pide todas las palabras", () => {
  assert.deepEqual(filtrarProveedores(LISTA, "MEXICO").map((p) => p.clave), ["fender mexico", "yamaha de mexico"]);
  assert.deepEqual(filtrarProveedores(LISTA, "  yamaha   méx ").map((p) => p.clave), ["yamaha de mexico"]);
  assert.deepEqual(filtrarProveedores(LISTA, "").length, 3);
  assert.deepEqual(filtrarProveedores(LISTA, "", 2).length, 2);
  assert.deepEqual(filtrarProveedores(LISTA, "roland"), []);
});

test("sin proveedor no se manda; otro proveedor de 2 a 120 caracteres", () => {
  assert.match(validarProveedorFormulario(PROVEEDOR_VACIO), /Elige/);
  assert.equal(validarProveedorFormulario({ modo: "lista", clave: "casa veerkamp", texto: "" }), "");
  assert.match(validarProveedorFormulario({ modo: "otro", clave: "", texto: "   " }), /Escribe/);
  assert.match(validarProveedorFormulario({ modo: "otro", clave: "", texto: " x " }), /entre 2 y 120/);
  assert.match(validarProveedorFormulario({ modo: "otro", clave: "", texto: "a".repeat(121) }), /entre 2 y 120/);
  assert.equal(validarProveedorFormulario({ modo: "otro", clave: "casa veerkamp", texto: "Distribuidora" }), "");
});

test("solo viaja uno de los dos campos", () => {
  assert.deepEqual(datosProveedor({ modo: "lista", clave: "casa veerkamp", texto: "basura" }), { proveedor_clave: "casa veerkamp" });
  assert.deepEqual(datosProveedor({ modo: "otro", clave: "casa veerkamp", texto: " Distribuidora " }), { proveedor_texto: "Distribuidora" });
});

test("etiqueta de la demanda guardada y días desde la más vieja", () => {
  assert.equal(etiquetaProveedor({}), "Sin proveedor");
  assert.equal(etiquetaProveedor({ proveedor_nombre: "Casa Veerkamp", proveedor_por_revisar: false }), "Casa Veerkamp");
  assert.equal(etiquetaProveedor({ proveedor_nombre: "Distribuidora", proveedor_por_revisar: true }), "Distribuidora (otro proveedor, por revisar)");
  assert.deepEqual([null, 0, 1, 20].map(textoDias), ["—", "hoy", "hace 1 día", "hace 20 días"]);
});
