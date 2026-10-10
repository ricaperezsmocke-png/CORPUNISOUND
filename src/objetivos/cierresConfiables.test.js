import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const respuesta = (datos, status = 200) => ({ ok: status === 200, status, json: async () => datos });

// Como ayuda.test.js: compilar el JSX existente. Los hooks permiten volver a renderizar
// y ejecutar sus manejadores sin instalar un DOM ni un runner adicional.
async function pantalla(archivo, api) {
  const estados = new Map();
  const modulos = new Map();
  let actual;
  let indice;
  let efectos = [];
  const hooks = {
    useState(inicial) {
      const clave = `${actual}:${indice++}`;
      if (!estados.has(clave)) estados.set(clave, typeof inicial === "function" ? inicial() : inicial);
      return [estados.get(clave), (valor) => estados.set(clave, typeof valor === "function" ? valor(estados.get(clave)) : valor)];
    },
    useRef(inicial) { return hooks.useState(() => ({ current: inicial }))[0]; },
    useId() { return hooks.useState("titulo")[0]; },
    useCallback(fn, deps) {
      const clave = `${actual}:${indice++}`;
      const anterior = estados.get(clave);
      if (!anterior || deps.some((d, i) => d !== anterior.deps[i])) estados.set(clave, { fn, deps });
      return estados.get(clave).fn;
    },
    useEffect(fn, deps) {
      const clave = `${actual}:${indice++}`;
      const anterior = estados.get(clave);
      if (!anterior || !deps || deps.some((d, i) => d !== anterior.deps[i])) {
        anterior?.limpiar?.();
        const registro = { deps };
        estados.set(clave, registro);
        efectos.push(() => { registro.limpiar = fn(); });
      }
    },
  };
  async function cargar(url) {
    if (modulos.has(url.href)) return modulos.get(url.href);
    const modulo = { exports: {} };
    const fuente = readFileSync(url, "utf8");
    const codigo = (await transform(fuente, { loader: "jsx", format: "cjs", jsx: "automatic" })).code;
    const dependencias = new Map();
    for (const [, ruta] of fuente.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      if (["../api", "./api"].includes(ruta)) continue;
      const extension = /\.[a-z]+$/i.test(ruta) ? "" : /^[A-Z]/.test(ruta.split("/").at(-1)) ? ".jsx" : ".js";
      dependencias.set(ruta, await cargar(new URL(ruta + extension, url)));
    }
    const importar = (ruta) => {
      if (ruta === "react") return { ...require("react"), ...hooks };
      if (["../api", "./api"].includes(ruta)) return { apiFetch: api };
      if (!ruta.startsWith(".")) return require(ruta);
      return dependencias.get(ruta);
    };
    runInNewContext(codigo, {
      module: modulo, exports: modulo.exports, require: importar, URLSearchParams,
      Date: class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-10-09T12:00:00Z"])); } },
      document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    });
    modulos.set(url.href, modulo.exports);
    return modulo.exports;
  }
  const componentes = await cargar(new URL(archivo, import.meta.url));
  function expandir(nodo, camino = "raiz") {
    if (nodo == null || typeof nodo === "boolean") return null;
    if (Array.isArray(nodo)) return nodo.map((n, i) => expandir(n, `${camino}/${i}`));
    if (typeof nodo !== "object") return nodo;
    if (typeof nodo.type === "function") {
      actual = `${camino}/${nodo.type.name}`;
      indice = 0;
      return expandir(nodo.type(nodo.props), actual);
    }
    return { ...nodo, props: { ...nodo.props, children: expandir(nodo.props.children, `${camino}/hijos`) } };
  }
  return {
    componentes,
    render(nombre, props) {
      assert.equal(typeof componentes[nombre], "function", `Falta implementar ${nombre}`);
      return expandir({ type: componentes[nombre], props });
    },
    async efectos() {
      const pendientes = efectos;
      efectos = [];
      pendientes.forEach((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function nodos(arbol, predicado) {
  if (!arbol || typeof arbol !== "object") return [];
  if (Array.isArray(arbol)) return arbol.flatMap((n) => nodos(n, predicado));
  return [...(predicado(arbol) ? [arbol] : []), ...nodos(arbol.props.children, predicado)];
}
function texto(arbol) {
  if (arbol == null || typeof arbol === "boolean") return "";
  if (Array.isArray(arbol)) return arbol.map(texto).join("");
  return typeof arbol === "object" ? texto(arbol.props.children) : String(arbol);
}
const botones = (arbol, etiqueta) => nodos(arbol, (n) => n.type === "button" && texto(n) === etiqueta);

const linea = { vendedor_id: 1, nombre: "Ana", meta: 100, capturado: 90, marcas: [], productos: [], creditos: [], actividades: [] };
const propsCierre = { usuario: { sucursal_id: 1, sucursal_nombre: "Tienda" } };
const conflicto = "Algo cambió desde que revisaste. Revisa otra vez antes de cerrar.";

async function prepararCierre() {
  const enviados = [];
  let revisiones = 0;
  const p = await pantalla("../CierreObjetivos.jsx", async (ruta, opciones) => {
    if (ruta === "/vendedores") return respuesta([{ id: 1, nombre: "Ana" }]);
    if (ruta.endsWith("/previo-cierre")) {
      revisiones++;
      return respuesta({ lineas: [{ ...linea, capturado: revisiones > 2 ? 95 : 90 }], huella: `h${revisiones}` });
    }
    if (ruta.endsWith("/retiradas")) return respuesta([]);
    if (opciones?.method === "POST") { enviados.push(JSON.parse(opciones.body)); return respuesta({ error: conflicto }, 409); }
    return respuesta({}, 404);
  });
  p.render("default", propsCierre);
  await p.efectos();
  return { p, enviados, revisiones: () => revisiones };
}

test("mes actual no ofrece cerrar y anuncia el mes siguiente", async () => {
  const { p } = await prepararCierre();
  const arbol = p.render("default", propsCierre);
  assert.equal(botones(arbol, "Revisar y cerrar").length, 0);
  assert.match(texto(arbol), /Este mes se podrá cerrar a partir del 1 de noviembre/);
});

test("cierre envía huella; 409 refresca previo y conserva SICAR escrito", async () => {
  const { p, enviados, revisiones } = await prepararCierre();
  let arbol = p.render("default", propsCierre);
  nodos(arbol, (n) => n.type === "input" && n.props.type === "month")[0].props.onChange({ target: { value: "2026-09" } });
  p.render("default", propsCierre);
  await p.efectos();
  arbol = p.render("default", propsCierre);
  nodos(arbol, (n) => n.type === "input" && n.props.type === "number")[0].props.onChange({ target: { value: "87" } });
  arbol = p.render("default", propsCierre);
  botones(arbol, "Revisar y cerrar")[0].props.onClick();
  arbol = p.render("default", propsCierre);
  await botones(arbol, "Sellar el mes")[0].props.onClick();
  arbol = p.render("default", propsCierre);
  assert.equal(enviados[0].huella, "h2");
  assert.equal(enviados[0].reales[0].real_sicar, 87);
  assert.equal(revisiones(), 3);
  assert.equal(nodos(arbol, (n) => n.type === "input" && n.props.type === "number")[0].props.value, "87");
  assert.match(texto(arbol), /Algo cambió/);
  assert.match(texto(arbol), /95/);
  assert.equal(botones(arbol, "Sellar el mes").length, 0);
});

test("sello envía huella y ante 409 refresca la tabla sin sellar automáticamente", async () => {
  let revisiones = 0;
  const enviados = [];
  const p = await pantalla("../metas/SelloMetas.jsx", async (ruta, opciones) => {
    if (opciones?.method === "POST") { enviados.push(JSON.parse(opciones.body)); return respuesta({ error: conflicto }, 409); }
    revisiones++;
    return respuesta({ huella: `h${revisiones}`, resultados: [
      { clave: 1, nombre: "Videos", resultado: revisiones, valor_meta: 4, porcentaje: 25 },
    ] });
  });
  const props = { periodo: "mensual", inicio: "2026-09-01", hoy: "2026-10-09", sucursales: [], vendedores: [], alCambiar() {} };
  let arbol = p.render("default", props);
  await botones(arbol, "Revisar y sellar")[0].props.onClick();
  arbol = p.render("default", props);
  await botones(arbol, "Sellar")[0].props.onClick();
  arbol = p.render("default", props);
  assert.equal(enviados[0].huella, "h1");
  assert.equal(enviados.length, 1);
  assert.equal(revisiones, 2);
  assert.match(texto(arbol), /2 de 4/);
  assert.match(texto(arbol), /Algo cambió/);
});

