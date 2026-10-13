import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { estadoInicial, faltanPorDecidir, puedeCrear, cuerpoValidacion, resumenConfirmacion } from "./planIA.js";

const PLAN = { id: 4, entrada: { periodo: "mensual", inicio: "2026-11-01" }, propuesta: {
  okr: { titulo: "Más acústicas", descripcion: null },
  metas: [{ indice: 0, nombre: "Publicar", unidad: "pub", prueba: "liga", valor_meta: 4 },
    { indice: 1, nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1 }] } };

test("nada viene decidido al empezar", () => {
  const e = estadoInicial(PLAN);
  assert.equal(e.okr.decision, null);
  assert.ok(e.metas.every((m) => m.decision === null));
  assert.equal(faltanPorDecidir(e), 3);
  assert.equal(puedeCrear(e), false);
});

test("puedeCrear exige decidir todo, aceptar algo y elegir persona si se cambio a persona", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "rechazar"; e.metas[0].decision = "rechazar";
  assert.equal(puedeCrear(e), false); // falta la meta 1
  e.metas[1].decision = "rechazar";
  assert.equal(puedeCrear(e), false); // nada aceptado
  e.metas[1].decision = "aceptar"; e.metas[1].alcance = "persona";
  assert.equal(puedeCrear(e), false); // sin persona
  e.metas[1].vendedor_id = "3";
  assert.equal(puedeCrear(e), true);
});

test("cuerpoValidacion manda solo lo que cambio y la persona como numero", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "aceptar"; e.okr.form.titulo = "Más guitarras";
  e.metas[0].decision = "aceptar"; e.metas[0].form.valor_meta = "6";
  e.metas[1].decision = "aceptar"; e.metas[1].alcance = "persona"; e.metas[1].vendedor_id = "3";
  assert.deepEqual(cuerpoValidacion(PLAN, e), {
    okr: { decision: "aceptar", cambios: { titulo: "Más guitarras" } },
    metas: [{ indice: 0, decision: "aceptar", cambios: { valor_meta: 6 }, alcance: "base" },
      { indice: 1, decision: "aceptar", cambios: {}, alcance: "persona", vendedor_id: 3 }],
  });
});

test("resumenConfirmacion cuenta lo aceptado", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "aceptar"; e.metas[0].decision = "aceptar"; e.metas[1].decision = "rechazar";
  assert.equal(resumenConfirmacion(PLAN, e, "Ocosingo"), "Vas a crear 1 OKR y 1 meta para Ocosingo, Noviembre de 2026");
  e.okr.decision = "rechazar"; e.metas[1].decision = "aceptar";
  assert.equal(resumenConfirmacion(PLAN, e, "toda la empresa"), "Vas a crear 2 metas para toda la empresa, Noviembre de 2026");
});

test("metas aceptadas exigen cifra entera positiva, nombre y unidad", async () => {
  const { errorParaCrear } = await import("./planIA.js");
  for (const [campo, valor] of [["valor_meta", ""], ["valor_meta", "2.5"], ["valor_meta", "0"],
    ["valor_meta", "-1"], ["nombre", " "], ["unidad", ""]]) {
    const e = estadoInicial(PLAN);
    e.okr.decision = "aceptar";
    e.metas.forEach((m) => { m.decision = "aceptar"; });
    e.metas[0].form[campo] = valor;
    assert.equal(puedeCrear(e), false, campo + valor);
    assert.match(errorParaCrear(e), /meta 1/i);
    e.metas[0].decision = "rechazar";
    assert.equal(puedeCrear(e), true);
  }
});

test("confirmacion perdida consulta el registro y recupera solo el mismo plan validado", async () => {
  const { confirmarPlan } = await import("./planIA.js");
  const e = estadoInicial(PLAN);
  const llamadas = [];
  const pedir = async (ruta, opciones) => {
    llamadas.push([ruta, opciones?.method || "GET"]);
    if (opciones?.method === "POST") throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => ({ planes: [{ id: PLAN.id, estado: "validado" }] }) };
  };
  assert.equal((await confirmarPlan(PLAN, e, pedir)).estado, "validado");
  assert.deepEqual(llamadas.map((l) => l[1]), ["POST", "GET"]);
  for (const planes of [[{ id: 999, estado: "validado" }], [{ id: PLAN.id, estado: "borrador" }]]) {
    await assert.rejects(confirmarPlan(PLAN, e, async (_, opciones) => {
      if (opciones?.method === "POST") throw new TypeError("Failed to fetch");
      return { ok: true, json: async () => ({ planes }) };
    }), /Failed to fetch/);
  }
});

test("borrador abre revision con su periodo, destino, ajuste y etiquetas", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  process.env.ESBUILD_WORKER_THREADS = "0";
  const { transformSync } = require("esbuild");
  const { readFileSync, existsSync } = require("node:fs");
  const { resolve, dirname } = require("node:path");
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  const cargar = (archivo) => {
    archivo = resolve(archivo);
    const resultado = transformSync(readFileSync(archivo, "utf8"), { loader: "jsx", format: "cjs", jsx: "automatic",
      define: { "import.meta.env.VITE_API_URL": '"http://localhost:4000/api"' } });
    const modulo = { exports: {} };
    const importar = (ruta) => {
      if (!ruta.startsWith(".")) return require(ruta);
      const base = resolve(dirname(archivo), ruta);
      return cargar([base, `${base}.js`, `${base}.jsx`].find(existsSync));
    };
    new Function("require", "module", "exports", resultado.code)(importar, modulo, modulo.exports);
    return modulo.exports;
  };
  const plan = structuredClone(PLAN);
  plan.entrada.sucursal_id = 1;
  plan.propuesta.metas[0] = { ...plan.propuesta.metas[0], ajustada: true, propuesta_ia: 40 };
  const sucursales = [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }];
  const html = renderToStaticMarkup(React.createElement(cargar("src/metas/PlaneadorIA.jsx").default, {
    plan, periodo: "mensual", inicio: "2026-12-01", sucursales,
    vendedores: [{ id: 1, sucursal_id: 1, nombre: "Ana" }, { id: 2, sucursal_id: 2, nombre: "Bea" }],
  }));
  for (const texto of ["Noviembre", "Ocosingo", "Pedir ajuste", "Cifra", "Unidad", "Prueba", "Para quién", "La IA propuso 40", "Objetivo general"]) {
    assert.ok(html.includes(texto), texto);
  }
  assert.ok(!html.includes("Diciembre") && !html.includes("Bea"));
  const registro = renderToStaticMarkup(React.createElement(cargar("src/metas/PlanesIA.jsx").default, {
    planes: [{ ...plan, estado: "borrador" }], sucursales,
  }));
  assert.ok(registro.includes("Continuar revisión") && registro.includes("Descartar"));
});
