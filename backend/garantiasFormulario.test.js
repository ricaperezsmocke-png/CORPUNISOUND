const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("../node_modules/react");
const { renderToStaticMarkup } = require("../node_modules/react-dom/server");
const { transformSync } = require("../node_modules/esbuild");

// Render de los controles reales, sin navegador, red ni dependencias nuevas.
// Las importaciones de red no se ejecutan al renderizar estos componentes.
const fuente = fs.readFileSync(path.join(__dirname, "../src/Garantias.jsx"), "utf8");
const codigo = transformSync(fuente, { loader: "jsx", format: "cjs", logLevel: "silent" }).code;
const modulo = { exports: {} };
vm.runInNewContext(codigo, {
  module: modulo, exports: modulo.exports,
  require: (nombre) => {
    if (nombre === "react") return React;
    if (nombre === "lucide-react") return require("../node_modules/lucide-react");
    return {};
  },
});
const { PagoGarantia, ResumenDineroGarantia, sugerirCajaGarantia } = modulo.exports;
const cajas = [{ id: 1, nombre: "Administrativa", predeterminada: true }, { id: 2, nombre: "Fiscal", predeterminada: false }];

test("sugerencia: acepta encabezado solo si pertenece al catálogo del caso", () => {
  assert.equal(typeof sugerirCajaGarantia, "function");
  assert.equal(sugerirCajaGarantia(cajas, "2"), "2");
  assert.equal(sugerirCajaGarantia(cajas, "9"), "1");
  assert.equal(sugerirCajaGarantia([], "9"), "");
});

for (const cobro of [true, false]) {
  test(`formulario ${cobro ? "cobro" : "gasto"} muestra destino y sentido del efectivo`, () => {
    assert.equal(typeof PagoGarantia, "function");
    const html = renderToStaticMarkup(React.createElement(PagoGarantia, {
      form: { forma_pago: "EFECTIVO", caja_id: "2" }, setForm: () => {}, cajas, sucursalNombre: "Ocosingo", cobro,
    }));
    assert.match(html, /Forma de pago/);
    assert.match(html, /EFECTIVO/);
    assert.match(html, /TARJETA/);
    assert.match(html, /TRANSFERENCIA/);
    assert.match(html, /Fiscal/);
    assert.match(html, /Ocosingo/);
    assert.match(html, cobro ? /sumará/ : /descontará/);
    assert.match(html, /value="2" selected/);
  });
}

test("transferencia no pregunta caja de efectivo ni promete mover el cajón", () => {
  assert.equal(typeof PagoGarantia, "function");
  const html = renderToStaticMarkup(React.createElement(PagoGarantia, {
    form: { forma_pago: "TRANSFERENCIA", caja_id: "1" }, setForm: () => {}, cajas, sucursalNombre: "Ocosingo", cobro: true,
  }));
  assert.doesNotMatch(html, /sumará|descontará|Caja de efectivo/);
  assert.equal((html.match(/<select/g) || []).length, 1);
});

test("saldo del caso: cobrado menos pagado, sin convertirlo en utilidad", () => {
  assert.equal(typeof ResumenDineroGarantia, "function");
  const html = renderToStaticMarkup(React.createElement(ResumenDineroGarantia, {
    cobros: [{ monto: 300 }], gastos: [{ monto: 450 }], cargando: false, error: null,
  }));
  assert.match(html, /Cobrado al cliente/);
  assert.match(html, /300\.00/);
  assert.match(html, /Pagado por la tienda/);
  assert.match(html, /450\.00/);
  assert.match(html, /-150\.00/);
  assert.doesNotMatch(html, /Utilidad/);
});

test("fallo o carga de dinero no presenta un saldo cero ficticio", () => {
  assert.equal(typeof ResumenDineroGarantia, "function");
  for (const estado of [{ cargando: true }, { error: "No se pudieron cargar los cobros" }]) {
    const html = renderToStaticMarkup(React.createElement(ResumenDineroGarantia, { cobros: [], gastos: [], ...estado }));
    assert.doesNotMatch(html, /\$0\.00/);
    assert.match(html, /Cargando|No se pudieron/);
  }
});
