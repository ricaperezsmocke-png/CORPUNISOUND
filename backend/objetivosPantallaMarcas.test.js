// Renderiza pantallas reales de "Mi Objetivo de Venta" con esbuild + react-dom/server.
// Cubre dos defectos que dejó el servidor de marcas mientras sus pantallas no existían:
// las capturas de marca llegan mezcladas con las de venta, y las rectificaciones de un
// elemento del cierre traen el mismo `campo` ("meta", "capturado") que las de venta.
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

test("la tabla de venta de la vendedora no pinta capturas de marca ni de producto", () => {
  const CapturaVendedor = cargar("src/objetivos/CapturaVendedor.jsx").default;
  const capturas = {
    total_capturado: 8500, dias_sin_capturar: [],
    capturas: [
      { id: 1, tipo: "venta", fecha: "2026-09-10", monto: 8500, vigente: true, capturado_por: "Ana" },
      { id: 2, tipo: "marca", marca_id: 3, fecha: "2026-09-10", monto: 77777, vigente: true, capturado_por: "Ana" },
      { id: 3, tipo: "producto", producto_meta_id: 1, fecha: "2026-09-10", monto: 66666, vigente: true, capturado_por: "Ana" },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(CapturaVendedor, {
    mes: "2026-09", vendedorId: 7, capturas, objetivos: { cerrado: true, lineas: [{ vendedor_id: 7, monto: 10000 }] },
    fecha: "2026-09-10", setFecha() {}, monto: "", setMonto() {}, capturar() {}, corregir() {},
  }));
  assert.match(texto(html), /8,500/);
  assert.doesNotMatch(texto(html), /77,777|66,666/, "una captura de marca o producto apareció como venta");
});

test("una rectificación de marca no cambia la fila de venta del cierre sellado", () => {
  const { CierreSellado } = cargar("src/CierreObjetivos.jsx");
  const cierre = {
    id: 1, cerrado_por: "Admin", cerrado_en: "2026-10-01T12:00:00Z",
    lineas: [{ vendedor_id: 7, meta: 10000, capturado: 9000, real_sicar: 9000, diferencia: 0, actividades: [],
      marcas: [{ marca_id: 3, nombre: "Yamaha", meta: 5000, capturado: 4000, real: 4000, diferencia: 0 }],
      productos: [], creditos: [] }],
    rectificaciones: [{ id: 1, vendedor_id: 7, campo: "meta", marca_id: 3, valor_anterior: 5000, valor_nuevo: 55555,
      motivo: "ajuste de marca", rectificado_por: "Admin", rectificado_en: "2026-10-02T12:00:00Z" }],
    resumen_actividades_tienda: [],
  };
  const html = renderToStaticMarkup(React.createElement(CierreSellado, { cierre, rectificar() {}, nombre: () => "Ana" }));
  assert.doesNotMatch(texto(html), /Rectificado: \$55,555/, "la rectificación de Yamaha se aplicó a la meta de venta");
  assert.doesNotMatch(texto(html), /Ana: Meta de \$5,000/, "la rectificación de marca se rotuló como meta de venta");
});

test("la barra de pestañas marca solo la activa y avisa al elegir otra", () => {
  const Pestanas = cargar("src/objetivos/Pestanas.jsx").default;
  const Icono = () => null;
  const elegidas = [];
  const elemento = Pestanas({
    activa: "b", elegir: (clave) => elegidas.push(clave),
    pestanas: [{ clave: "a", etiqueta: "Mi venta", Icono }, { clave: "b", etiqueta: "Mis créditos", Icono }],
  });
  const html = renderToStaticMarkup(elemento);
  assert.match(html, /role="toolbar"/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, /aria-pressed="true"[^>]*>.*Mis créditos/);
  elemento.props.children[0].props.onClick();
  assert.deepEqual(elegidas, ["a"]);
});
