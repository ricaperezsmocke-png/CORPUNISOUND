// Pantallas de "Mi avance" y "Avance de la tienda" renderizadas con esbuild + react-dom/server.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { buildSync } = require("../node_modules/esbuild");

const raiz = path.join(__dirname, "..");
const requerirDeRaiz = createRequire(path.join(raiz, "package.json"));
const React = requerirDeRaiz("react");
const { renderToStaticMarkup } = requerirDeRaiz("react-dom/server");

function cargar(relativo) {
  const { outputFiles } = buildSync({
    entryPoints: [path.join(raiz, relativo)], bundle: true, write: false, format: "cjs", platform: "node",
    jsx: "automatic", external: ["react", "react-dom", "lucide-react"], logLevel: "silent",
    define: { "import.meta.env": "{}" },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(mod, mod.exports, requerirDeRaiz);
  return mod.exports;
}

const texto = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("las barras de la vendedora muestran su cifra y el porcentaje de la tienda, nunca cifras de tienda", () => {
  const { BarrasMetas } = cargar("src/objetivos/GraficasAvance.jsx");
  const avance = {
    marcas: [{ marca_id: 3, nombre: "Yamaha", meta: 5000, capturado: 4000, porcentaje: 80 }],
    productos: [], creditos: [{ financiera: "atrato", etiqueta: "Atrato", meta: 4, registrados: 1, porcentaje: 25 }],
    actividades: [
      { actividad: "grupos", etiqueta: "Publicación en grupos", meta: 5, declaradas: 3, porcentaje: 60 },
      { actividad: "iglesia", etiqueta: "Salida a iglesia", meta: 0, declaradas: 0, porcentaje: null },
    ],
  };
  const tienda = { marcas: [{ marca_id: 3, nombre: "Yamaha", porcentaje: 64 }], productos: [], creditos: [], actividades: [] };
  const pagina = texto(renderToStaticMarkup(React.createElement(BarrasMetas, { avance, porcentajesTienda: tienda })));
  assert.match(pagina, /Yamaha 80 % \$4,000\.00 de \$5,000\.00 Tienda 64 %/);
  assert.match(pagina, /Atrato 25 % 1 crédito de 4 créditos Tienda — /);
  assert.match(pagina, /Declaradas, no verificadas/);
  assert.match(pagina, /3 de 5 declaradas/);
  assert.doesNotMatch(pagina, /Salida a iglesia/, "una actividad sin meta ni registros no se dibuja");
});

test("el anillo sin meta no divide y lo dice", () => {
  const { Anillo } = cargar("src/objetivos/GraficasAvance.jsx");
  const pagina = texto(renderToStaticMarkup(React.createElement(Anillo, { titulo: "Mi meta", porcentaje: null, estado: "sin-meta", detalle: "" })));
  assert.match(pagina, /Sin meta asignada este mes/);
  assert.doesNotMatch(pagina, /NaN|Infinity/);
});

test("la línea del mes dice cuánto falta por día en un mes en curso", () => {
  const { LineaMes } = cargar("src/objetivos/GraficasAvance.jsx");
  const pagina = texto(renderToStaticMarkup(React.createElement(LineaMes, {
    serie: [{ fecha: "2026-09-01", monto: 21600 }], meta: 30000, capturado: 21600, mes: "2026-09", hoy: "2026-09-24", porcentaje: 72,
  })));
  assert.match(pagina, /Te faltan \$8,400\.00; son \$1,200\.00 por día en los 7 días que quedan/);
  const pasado = texto(renderToStaticMarkup(React.createElement(LineaMes, {
    serie: [], meta: 30000, capturado: 21600, mes: "2026-08", hoy: "2026-09-24", porcentaje: 72,
  })));
  assert.match(pasado, /Terminó el mes con 72 %/);
});

test("el cruce con el porcentaje de tienda tolera ids como texto", () => {
  const { BarrasMetas } = cargar("src/objetivos/GraficasAvance.jsx");
  const avance = { marcas: [{ marca_id: 3, nombre: "Yamaha", meta: 5000, capturado: 4000, porcentaje: 80 }], productos: [], creditos: [], actividades: [] };
  const tienda = { marcas: [{ marca_id: "3", nombre: "Yamaha", porcentaje: 64 }], productos: [], creditos: [], actividades: [] };
  assert.match(texto(renderToStaticMarkup(React.createElement(BarrasMetas, { avance, porcentajesTienda: tienda }))), /Tienda 64 %/);
});

test("un mes terminado con la meta lograda dice con cuánto terminó", () => {
  const { LineaMes } = cargar("src/objetivos/GraficasAvance.jsx");
  const pagina = texto(renderToStaticMarkup(React.createElement(LineaMes, {
    serie: [], meta: 1000, capturado: 1100, mes: "2026-08", hoy: "2026-09-24", porcentaje: 110,
  })));
  assert.match(pagina, /Terminó el mes con 110 %/);
});

test("la tabla por persona incluye actividades y cruza ids como texto", () => {
  const AvanceTienda = cargar("src/objetivos/AvanceTienda.jsx").default;
  const { tablaPorPersona } = cargar("src/objetivos/AvanceTienda.jsx");
  const tienda = {
    marcas: [{ marca_id: 3, nombre: "Yamaha" }], productos: [], creditos: [],
    actividades: [{ actividad: "grupos", etiqueta: "Publicación en grupos", meta: 5 }, { actividad: "iglesia", etiqueta: "Salida a iglesia", meta: 0 }],
  };
  const personas = [{ vendedor_id: 7, venta: { meta: 10, capturado: 5, porcentaje: 50 },
    marcas: [{ marca_id: "3", meta: 5000, capturado: 4000, porcentaje: 80 }], productos: [], creditos: [],
    actividades: [{ actividad: "grupos", meta: 5, declaradas: 3, porcentaje: 60 }, { actividad: "iglesia", meta: 0, declaradas: 0, porcentaje: null }] }];
  assert.ok(AvanceTienda);
  const html = texto(renderToStaticMarkup(tablaPorPersona({ tienda, personas, nombre: () => "Ana" })));
  assert.match(html, /Publicación en grupos/);
  assert.doesNotMatch(html, /Salida a iglesia/, "una actividad sin meta ni declaradas en la tienda no ocupa columna");
  assert.match(html, /80 %.*\$4,000\.00 de \$5,000\.00/);
  assert.match(html, /60 %.*3 de 5 declaradas/);
});
