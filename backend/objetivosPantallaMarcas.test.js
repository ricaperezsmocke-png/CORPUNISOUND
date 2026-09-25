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

function marcasDelDia(extra) {
  const MarcasDelDia = cargar("src/objetivos/MarcasDelDia.jsx").default;
  const capturas = {
    total_por_marca: [{ marca_id: 3, total_capturado: 4000 }], total_por_producto: [],
    capturas: [
      { id: 1, tipo: "venta", fecha: "2026-09-10", monto: 8500, vigente: true, capturado_por: "Ana" },
      { id: 2, tipo: "marca", marca_id: 3, fecha: "2026-09-10", monto: 4000, vigente: true, capturado_por: "Ana" },
    ],
  };
  const objetivos = {
    cerrado: false, lineas: [],
    marcas: [{ marca_id: 3, nombre: "Yamaha", lineas: [{ vendedor_id: 7, monto: 5000 }] },
      { marca_id: 4, nombre: "Casio", lineas: [{ vendedor_id: 7, monto: 2000 }] }],
    productos: [{ producto_meta_id: 1, nombre: "Teclados", lineas: [{ vendedor_id: 7, monto: 3 }] }],
  };
  const props = { mes: "2026-09", sucursalId: "1", vendedorId: 7, fecha: "2026-09-10", objetivos, capturas, actualizar() {}, ...extra };
  return texto(renderToStaticMarkup(React.createElement(MarcasDelDia, props)));
}

test("marcas del día: letrero contra la venta, captura hecha con Corregir y marca pendiente con Guardar", () => {
  const pagina = marcasDelDia({});
  assert.match(pagina, /De tu venta de \$8,500\.00 llevas \$4,000\.00 en marcas/);
  assert.match(pagina, /Yamaha .*\$5,000\.00 .*\$4,000\.00 .*Corregir/);
  assert.match(pagina, /Casio .*\$2,000\.00 .*Guardar/);
  assert.match(pagina, /Teclados 3 piezas 0 piezas/);
});

test("marcas del día: sin venta capturada pide capturarla primero", () => {
  const pagina = marcasDelDia({ fecha: "2026-09-11" });
  assert.match(pagina, /Primero captura tu venta de ese día/);
  assert.doesNotMatch(pagina, /llevas/);
});

test("marcas del día: mes cerrado queda en solo lectura", () => {
  const MarcasDelDia = cargar("src/objetivos/MarcasDelDia.jsx").default;
  const objetivos = { cerrado: true, lineas: [], marcas: [{ marca_id: 3, nombre: "Yamaha", lineas: [{ vendedor_id: 7, monto: 1 }] }], productos: [] };
  const capturas = { capturas: [{ id: 1, tipo: "venta", fecha: "2026-09-10", monto: 10, vigente: true }] };
  const html = renderToStaticMarkup(React.createElement(MarcasDelDia, {
    mes: "2026-09", sucursalId: "1", vendedorId: 7, fecha: "2026-09-10", objetivos, capturas, actualizar() {},
  }));
  assert.doesNotMatch(html, /<input|Guardar|Corregir|otra marca/);
});

test("mis créditos: formulario con folio en mes abierto y nada que escribir en mes cerrado", () => {
  const CreditosVendedor = cargar("src/objetivos/CreditosVendedor.jsx").default;
  const render = (cerrado) => renderToStaticMarkup(React.createElement(CreditosVendedor, {
    mes: "2026-09", sucursalId: "1", vendedorId: 7, objetivos: { cerrado, creditos: [] },
  }));
  const abierto = render(false);
  assert.match(texto(abierto), /Folio de la financiera/);
  assert.match(abierto, /<button type="submit" disabled=""/, "sin datos el botón debe nacer deshabilitado");
  assert.doesNotMatch(render(true), /<form|<input|Anular/);
});

test("gerente: tabla con pendiente en palabras y sin botones de escritura en mes cerrado", () => {
  const MarcasGerente = cargar("src/objetivos/MarcasGerente.jsx").default;
  const objetivos = (cerrado) => ({
    cerrado,
    marcas: [{ marca_id: 3, nombre: "Yamaha", meta_tienda: 20000, asignado: 25000, sin_asignar: -5000, lineas: [] }],
    productos: [], creditos: [{ financiera: "atrato", etiqueta: "Atrato", meta_tienda: 3, asignado: 2, sin_asignar: 1, lineas: [] }],
  });
  const render = (cerrado) => renderToStaticMarkup(React.createElement(MarcasGerente, {
    mes: "2026-09", sucursalId: "1", objetivos: objetivos(cerrado), nombre: () => "Ana", actualizar() {},
  }));
  const abierto = texto(render(false));
  assert.match(abierto, /Yamaha pesos \$20,000\.00 \$25,000\.00 Asignaste \$5,000\.00 de más/);
  assert.match(abierto, /Atrato créditos 3 créditos 2 créditos Falta 1 crédito por repartir/);
  assert.match(abierto, /Agregar meta/);
  assert.doesNotMatch(texto(render(true)), /Agregar meta/);
});

test("listas: el gerente de una sola tienda no ve el panel; quien ve todas las tiendas sí", () => {
  const MarcasGerente = cargar("src/objetivos/MarcasGerente.jsx").default;
  const render = (permisos) => texto(renderToStaticMarkup(React.createElement(MarcasGerente, {
    mes: "2026-09", sucursalId: "1", objetivos: { cerrado: false }, nombre: () => "Ana", actualizar() {}, permisos,
  })));
  // Permisos vecinos del mismo módulo, no un arreglo vacío (CLAUDE.md: un rol sin permisos no prueba nada).
  assert.doesNotMatch(render(["editar_objetivos_venta", "usar_gerente_ventas", "cerrar_mes_objetivos"]), /Listas de marcas y productos/);
  assert.doesNotMatch(render(["ver_todas_las_sucursales", "usar_gerente_ventas"]), /Listas de marcas y productos/);
  const admin = render(["editar_objetivos_venta", "ver_todas_las_sucursales"]);
  assert.match(admin, /Listas de marcas y productos/);
  assert.doesNotMatch(admin, /Borrar|Eliminar|Reactivar/);
});
