import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIAS } from "./menuCategorias.js";

// Una pantalla que falta en MODULOS de App.jsx se dibuja con el asistente de Inicio debajo (pasó con
// "Seguimiento de Facturas CEDIS" el 2026-11-05). Y una que falta en ICONOS sale en el menú sin ícono.
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const barra = readFileSync(new URL("./BarraLateral.jsx", import.meta.url), "utf8");
const modulos = new Set([...app.match(/const MODULOS = \[([\s\S]*?)\];/)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
const iconos = new Set([...barra.match(/const ICONOS = \{([\s\S]*?)\};/)[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]));
const delMenu = CATEGORIAS.flatMap((c) => c.modulos.map((m) => m.id));

test("toda pantalla que App dibuja está en MODULOS (si no, le sale el asistente de Inicio abajo)", () => {
  const dibujadas = [...new Set([...app.matchAll(/vista === "([a-z_]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(dibujadas.filter((v) => !modulos.has(v)), []);
});

test("toda entrada del menú tiene su ícono", () => {
  assert.deepEqual(delMenu.filter((id) => !iconos.has(id)), []);
});
