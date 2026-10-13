// Pantallas de "Mi avance" y "Avance de la tienda" renderizadas con esbuild + react-dom/server.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { transformSync } = require("../node_modules/esbuild");
const { readFileSync, existsSync } = require("node:fs");

const raiz = path.join(__dirname, "..");
const requerirDeRaiz = createRequire(path.join(raiz, "package.json"));
const React = requerirDeRaiz("react");
const { renderToStaticMarkup } = requerirDeRaiz("react-dom/server");

function cargar(relativo, estados = []) {
  let indice = 0;
  const reactConDatos = { ...React, useState: (inicial) => React.useState(indice < estados.length ? estados[indice++] : inicial) };
  const cache = new Map();
  // Transformar fuentes conocidas evita que el bundler recorra directorios fuera del worktree.
  function modulo(archivo) {
    if (cache.has(archivo)) return cache.get(archivo).exports;
    const mod = { exports: {} };
    cache.set(archivo, mod);
    const { code } = transformSync(readFileSync(archivo, "utf8"), {
      loader: "jsx", format: "cjs", jsx: "automatic", define: { "import.meta.env": "{}" },
    });
    const requerir = (nombre) => {
      if (nombre === "react") return reactConDatos;
      if (!nombre.startsWith(".")) return requerirDeRaiz(nombre);
      const base = path.resolve(path.dirname(archivo), nombre);
      const destino = [base, `${base}.js`, `${base}.jsx`].find((ruta) => existsSync(ruta));
      return modulo(destino);
    };
    new Function("module", "exports", "require", code)(mod, mod.exports, requerir);
    return mod.exports;
  }
  return modulo(path.join(raiz, relativo));
}

const texto = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("Mi avance presenta el cierre y motivo de corrección sin reemplazar el anillo capturado", () => {
  const propio = { venta: { meta: 120, capturado: 90, porcentaje: 75 }, serie: [], marcas: [], productos: [], creditos: [], actividades: [],
    cierre: { cerrado_en: "2026-10-01T18:00:00Z", cerrado_por: "Victor",
      venta: { meta: 120, declarado: 90, real_sicar: 80, diferencia: 10 },
      rectificaciones: [{ campo: "real_sicar", valor_anterior: 100, valor_nuevo: 80, motivo: "Devolución", rectificado_en: "2026-10-02T18:00:00Z" }] } };
  const Avance = cargar("src/objetivos/AvanceVendedor.jsx", [{ propio }]).default;
  const pagina = texto(renderToStaticMarkup(React.createElement(Avance, { mes: "2026-09", sucursalId: 1 })));
  assert.match(pagina, /Mes cerrado el/);
  assert.match(pagina, /Declaraste \$90\.00 · Real de SICAR \$80\.00 · Diferencia \$10\.00/);
  assert.match(pagina, /Corrección: real de SICAR de \$100\.00 a \$80\.00.*Motivo: Devolución/);
  assert.match(pagina, /\$90\.00 de \$120\.00/);
});

test("Mis metas conserva metas históricas visibles aunque ya no permitan Hecho", () => {
  const meta = { clave: 1, nombre: "Videos históricos", alcance: "tienda", resultado: 3, valor_meta: 10,
    porcentaje: 30, semaforo: "verde", unidad: "videos", puede_capturar: false, mis_capturas: [{ id: 1, cantidad: 3 }] };
  const MisMetas = cargar("src/metas/MisMetas.jsx", [{ okrs: [], sueltas: [meta], retiradas: [], sellado: false, fin: "2026-09-30" }]).default;
  const pagina = texto(renderToStaticMarkup(React.createElement(MisMetas, { periodo: "mensual", inicio: "2026-09-01", hoy: "2026-10-09" })));
  assert.match(pagina, /Videos históricos/);
  assert.match(pagina, /Ver lo que capturé \(1\)/);
  assert.doesNotMatch(pagina, /Hecho/);
});

test("Mis metas muestra retiradas con capturas y auditoría sin acciones de captura o anulación", () => {
  const meta = { clave: 1, nombre: "Videos retirados", unidad: "videos",
    retirada: { por_nombre: "Victor", en: "2026-10-02T18:00:00Z", motivo: "Cambio de campaña" },
    mis_capturas: [
      { id: 1, fecha: "2026-09-03", cantidad: 3, evidencia: null },
      { id: 2, fecha: "2026-09-04", cantidad: 1, evidencia: { tipo: "foto", drive_link: "https://drive/foto" },
        anulada: { por_nombre: "Victor", en: "2026-10-01T18:00:00Z", motivo: "Duplicada" } },
    ] };
  const MisMetas = cargar("src/metas/MisMetas.jsx", [{ okrs: [], sueltas: [], retiradas: [meta], sellado: false }]).default;
  const html = renderToStaticMarkup(React.createElement(MisMetas, { periodo: "mensual", inicio: "2026-09-01", hoy: "2026-10-09" }));
  const pagina = texto(html);
  assert.match(html, /<details/);
  assert.match(html, /line-through[^>]*>Videos retirados/);
  assert.match(pagina, /Metas retiradas.*Retirada por Victor el.*Motivo: Cambio de campaña/);
  assert.match(pagina, /03\/09.*3.*04\/09.*1.*Ver foto.*Duplicada/);
  assert.doesNotMatch(pagina, /Hecho|Quitar/);
});

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
