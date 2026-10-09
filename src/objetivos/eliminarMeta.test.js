import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const llave = { tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: null };
const respuesta = (datos, ok = true) => ({ ok, json: async () => datos });

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
    useCallback(fn) { return fn; },
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
      if (ruta === "../api") continue;
      const extension = /\.[a-z]+$/i.test(ruta) ? "" : /^[A-Z]/.test(ruta.split("/").at(-1)) ? ".jsx" : ".js";
      dependencias.set(ruta, await cargar(new URL(ruta + extension, url)));
    }
    const importar = (ruta) => {
      if (ruta === "react") return { ...require("react"), ...hooks };
      if (ruta === "../api") return { apiFetch: api };
      if (!ruta.startsWith(".")) return require(ruta);
      return dependencias.get(ruta);
    };
    runInNewContext(codigo, {
      module: modulo, exports: modulo.exports, require: importar, URLSearchParams,
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

test("EliminarMeta exige motivo, envía la llave exacta y termina solo tras la respuesta", async () => {
  const peticiones = [];
  let resolver;
  let terminadas = 0;
  const p = await pantalla("./DialogosObjetivos.jsx", (...args) => {
    peticiones.push(args);
    return new Promise((resolve) => { resolver = resolve; });
  });
  const props = { llave, titulo: "Tienda", cerrar() {}, alTerminar() { terminadas++; } };
  let arbol = p.render("EliminarMeta", props);
  assert.equal(botones(arbol, "Eliminar")[0].props.disabled, true);
  nodos(arbol, (n) => n.type === "textarea")[0].props.onChange({ target: { value: "   " } });
  arbol = p.render("EliminarMeta", props);
  assert.equal(botones(arbol, "Eliminar")[0].props.disabled, true);
  nodos(arbol, (n) => n.type === "textarea")[0].props.onChange({ target: { value: "  Error de captura  " } });
  arbol = p.render("EliminarMeta", props);
  assert.equal(botones(arbol, "Eliminar")[0].props.disabled, false);
  const envio = botones(arbol, "Eliminar")[0].props.onClick();
  assert.equal(terminadas, 0);
  assert.equal(botones(p.render("EliminarMeta", props), "Eliminar")[0].props.disabled, true);
  assert.equal(peticiones[0][0], "/objetivos/retirar");
  assert.equal(peticiones[0][1].method, "POST");
  assert.deepEqual(JSON.parse(peticiones[0][1].body), { ...llave, motivo: "Error de captura" });
  resolver(respuesta({ vigente: false }));
  await envio;
  assert.equal(terminadas, 1);
  assert.ok(nodos(arbol, (n) => n.props.role === "dialog" && n.props.className.includes("overflow-y-auto")).length);
  for (const b of nodos(arbol, (n) => n.type === "button")) assert.equal(b.props.type, "button");
});

for (const falla of ["http", "red"]) {
  test(`EliminarMeta muestra error ${falla} y conserva abierto el diálogo`, async () => {
    let terminadas = 0;
    let cerradas = 0;
    const p = await pantalla("./DialogosObjetivos.jsx", async () => {
      if (falla === "red") throw new Error("Sin conexión");
      return respuesta({ error: "El mes ya está cerrado" }, false);
    });
    const props = { llave, titulo: "Tienda", cerrar() { cerradas++; }, alTerminar() { terminadas++; } };
    let arbol = p.render("EliminarMeta", props);
    nodos(arbol, (n) => n.type === "textarea")[0].props.onChange({ target: { value: "error" } });
    arbol = p.render("EliminarMeta", props);
    await botones(arbol, "Eliminar")[0].props.onClick();
    arbol = p.render("EliminarMeta", props);
    assert.equal(texto(nodos(arbol, (n) => n.props.role === "alert")), falla === "red" ? "Sin conexión" : "El mes ya está cerrado");
    assert.equal(terminadas, 0);
    assert.equal(cerradas, 0);
  });
}

test("HistorialMetas conserva la versión retirada e informa quién, fecha y motivo", async () => {
  const p = await pantalla("./DialogosObjetivos.jsx", async () => respuesta([]));
  const arbol = p.render("HistorialMetas", {
    historial: { vendedor_id: null, datos: [{ id: 1, version: 2, monto: 100, vigente: false,
      retirada: { por_nombre: "Victor", motivo: "error", en: "2026-10-08T12:00:00Z" } }] },
    nombre: () => "Ana", cerrar() {},
  });
  assert.match(texto(arbol), /Versión 2/);
  assert.match(texto(arbol), /Eliminada por Victor/);
  assert.match(texto(arbol), /Motivo: error/);
  assert.ok(texto(arbol).includes(new Date("2026-10-08T12:00:00Z").toLocaleString("es-MX")));
});

test("el botón consulta vigencia: incluye cero vigente y oculta ausentes, retiradas y mes cerrado", async () => {
  for (const [versiones, cerrado, visible] of [[[], false, false], [[{ vigente: false }], false, false],
    [[{ vigente: true, monto: 0 }], false, true], [[{ vigente: true }], true, false]]) {
    const peticiones = [];
    const p = await pantalla("./DialogosObjetivos.jsx", async (ruta) => { peticiones.push(ruta); return respuesta(versiones); });
    const props = { llave, titulo: "Tienda", cerrado, revision: {}, abrir() {} };
    p.render("BotonEliminarMeta", props);
    await p.efectos();
    const arbol = p.render("BotonEliminarMeta", props);
    assert.equal(botones(arbol, "Eliminar").length, Number(visible));
    assert.deepEqual(peticiones, cerrado ? [] : ["/objetivos/2026-10/1/historial/tienda?tipo=venta"]);
  }
});

const pantallas = [
  ["venta", "./RepartoGerente.jsx", {}],
  ["marca", "./MarcasGerente.jsx", { marca_id: 3 }],
  ["producto", "./MarcasGerente.jsx", { producto_meta_id: 4 }],
  ["credito", "./MarcasGerente.jsx", { financiera: "atrato" }],
  ["actividad", "./ActividadesGerente.jsx", { actividad: "publicaciones" }],
];

for (const [tipo, archivo, referencia] of pantallas) {
  for (const vendedor_id of [null, 7]) {
    test(`${tipo}: elimina la meta de ${vendedor_id ?? "tienda"} con su llave y recarga`, async () => {
      const peticiones = [];
      const recargas = [];
      const p = await pantalla(archivo, async (ruta, opciones) => {
        if (opciones?.method === "POST") {
          peticiones.push([ruta, JSON.parse(opciones.body)]);
          return respuesta({ vigente: false });
        }
        if (ruta.includes("/historial/")) return respuesta([{ vigente: true, monto: 0 }]);
        if (ruta.includes("/catalogo/")) return respuesta([]);
        return respuesta({ registros: [], resumen_tienda: tipo === "actividad" ? [] : {}, resumen_por_persona: [] });
      });
      const reparto = { meta_tienda: 0, asignado: 0, sin_asignar: 0, lineas: [{ vendedor_id: 7, monto: 0 }] };
      const objetivos = {
        ...reparto, cerrado: false, plantilla: [{ vendedor_id: 7 }],
        marcas: tipo === "marca" ? [{ ...reparto, marca_id: 3, nombre: "Yamaha" }] : [],
        productos: tipo === "producto" ? [{ ...reparto, producto_meta_id: 4, nombre: "Guitarra" }] : [],
        creditos: tipo === "credito" ? [{ ...reparto, financiera: "atrato" }] : [],
        actividades: [{ ...reparto, actividad: "publicaciones", etiqueta: "Publicaciones" }], inventarios: reparto,
      };
      const props = {
        mes: "2026-10", sucursalId: "1", objetivos, nombre: () => "Ana", equipo: [], permisos: [],
        actualizar: async (...args) => { recargas.push(args); },
      };
      let arbol = p.render("default", props);
      await p.efectos();
      arbol = p.render("default", props);
      if (["marca", "producto", "credito"].includes(tipo)) {
        nodos(arbol, (n) => n.type === "tr" && n.props.onClick)[0].props.onClick();
      }
      if (tipo === "actividad") {
        nodos(arbol, (n) => n.type === "button" && n.props["aria-expanded"] === false)[0]
          .props.onClick({ stopPropagation() {} });
      }
      arbol = p.render("default", props);
      await p.efectos();
      arbol = p.render("default", props);
      const eliminar = botones(arbol, "Eliminar");
      assert.equal(eliminar.length, 2, "Tienda y persona con meta vigente deben ofrecer Eliminar");
      eliminar[vendedor_id == null ? 0 : 1].props.onClick();
      arbol = p.render("default", props);
      const dialogo = nodos(arbol, (n) => n.props.role === "dialog")[0];
      nodos(dialogo, (n) => n.type === "textarea")[0].props.onChange({ target: { value: "error" } });
      arbol = p.render("default", props);
      await botones(nodos(arbol, (n) => n.props.role === "dialog")[0], "Eliminar")[0].props.onClick();
      assert.deepEqual(peticiones, [["/objetivos/retirar", {
        tipo, mes: "2026-10", sucursal_id: 1, vendedor_id, ...referencia, motivo: "error",
      }]]);
      assert.deepEqual(JSON.parse(JSON.stringify(recargas)), tipo === "marca" || tipo === "producto" || tipo === "credito"
        ? [[]] : [[{ silenciosa: true }]]);
      arbol = p.render("default", props);
      assert.equal(nodos(arbol, (n) => n.props.role === "dialog").length, 0);
      objetivos.cerrado = true;
      assert.equal(botones(p.render("default", props), "Eliminar").length, 0);
    });
  }
}
