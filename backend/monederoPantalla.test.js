const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("../node_modules/react");
const { transformSync } = require("../node_modules/esbuild");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { listarCondiciones } = require("./condicionesPago");
const { crearVenta } = require("./ventas");
const { calcularCorteEnCurso } = require("./cortes");

const codigo = transformSync(fs.readFileSync(path.join(__dirname, "../src/PuntoDeVenta.jsx"), "utf8"), {
  loader: "jsx", format: "cjs", logLevel: "silent",
}).code;

// Ejecuta el componente y sus callbacks reales. Solo sustituye el alojamiento
// de hooks, iconos, temporizadores y red; ventas e importes usan el backend real.
// Complementa, no sustituye, la prueba del flujo completo en navegador.
async function prepararPantalla(saldo = 120) {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true, descuentos_pago_habilitado: false };
  DB.crm.clientes.find((c) => c.id === 1).monedero = saldo;
  DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta = 320;
  const hooks = [];
  let cursor = 0;
  let pendiente = true;
  let efectos = [];
  let arbol;
  const mismos = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function useMemo(fn, deps) {
    const i = cursor++;
    if (!hooks[i] || !mismos(hooks[i].deps, deps)) hooks[i] = { deps, valor: fn() };
    return hooks[i].valor;
  }
  const react = {
    ...React,
    useState(inicial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof inicial === "function" ? inicial() : inicial;
      return [hooks[i], (valor) => {
        const nuevo = typeof valor === "function" ? valor(hooks[i]) : valor;
        if (!Object.is(nuevo, hooks[i])) { hooks[i] = nuevo; pendiente = true; }
      }];
    },
    useRef: (valor) => useMemo(() => ({ current: valor }), []),
    useMemo,
    useCallback: (fn, deps) => useMemo(() => fn, deps),
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !mismos(hooks[i].deps, deps)) {
        hooks[i] = { deps };
        efectos.push(fn);
      }
    },
  };
  const api = {
    sucursalActiva: () => "1", cajaActiva: () => null, sinSucursalElegida: () => false,
    async apiFetch(ruta, opciones = {}) {
      let data;
      if (ruta === "/ventas" && opciones.method === "POST") {
        data = crearVenta(DB, { ...JSON.parse(opciones.body), sucursal_id: 1 });
      } else {
        const respuestas = {
          "/clientes": DB.crm.clientes,
          "/productos": DB["catalogo-productos"].productos,
          "/vendedores": DB.pos.vendedores,
          "/condiciones-pago": listarCondiciones(DB, 1),
          "/configuracion": DB.pos.configuracion,
          "/categorias": [], "/departamentos": [], "/proveedores": [],
        };
        assert.ok(Object.hasOwn(respuestas, ruta), `Ruta inesperada: ${ruta}`);
        data = respuestas[ruta];
      }
      const copia = JSON.parse(JSON.stringify(data));
      return { ok: true, json: async () => copia };
    },
  };
  const modulo = { exports: {} };
  vm.runInNewContext(codigo, {
    module: modulo, exports: modulo.exports,
    require: (nombre) => {
      if (nombre === "react") return react;
      if (nombre === "./api") return api;
      if (nombre === "lucide-react") return new Proxy({}, { get: () => () => null });
      return () => null;
    },
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout() {},
  });
  function expandir(nodo) {
    if (Array.isArray(nodo)) return nodo.map(expandir);
    if (!nodo || typeof nodo !== "object") return nodo;
    if (typeof nodo.type === "function") return expandir(nodo.type(nodo.props));
    return { ...nodo, props: { ...nodo.props, children: expandir(nodo.props.children) } };
  }
  async function actualizar() {
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      if (pendiente) {
        pendiente = false;
        cursor = 0;
        arbol = expandir(modulo.exports.default({}));
        const actuales = efectos;
        efectos = [];
        actuales.forEach((fn) => fn());
      }
      await new Promise(setImmediate);
      if (!pendiente) return;
    }
    assert.fail("La pantalla no estabiliza");
  }
  const texto = (n) => Array.isArray(n) ? n.map(texto).join("")
    : n && typeof n === "object" ? texto(n.props.children) : typeof n === "string" || typeof n === "number" ? String(n) : "";
  function encontrar(predicado, n = arbol) {
    if (Array.isArray(n)) return n.flatMap((h) => encontrar(predicado, h ?? null));
    if (!n || typeof n !== "object") return [];
    return [...(predicado(n) ? [n] : []), ...encontrar(predicado, n.props.children ?? null)];
  }
  const ui = {
    DB, texto: () => texto(arbol), encontrar,
    async click(etiqueta) {
      const boton = encontrar((n) => n.type === "button" && texto(n).startsWith(etiqueta))[0];
      assert.ok(boton, `Falta el botón ${etiqueta}`);
      assert.ok(!boton.props.disabled, `Botón deshabilitado: ${etiqueta}`);
      await boton.props.onClick();
      await actualizar();
    },
    async capturar(predicado, valor) {
      const campo = encontrar(predicado)[0];
      assert.ok(campo, "Falta el campo de captura");
      campo.props.onChange({ target: { value: valor } });
      await actualizar();
    },
    async agregar() {
      const esCodigo = (n) => n.type === "input" && n.props.placeholder?.includes("Escanea");
      await ui.capturar(esCodigo, "LI-001");
      encontrar(esCodigo)[0].props.onKeyDown({ key: "Enter" });
      await actualizar();
    },
    async elegirCliente(nombre = "Abarrotes Mary") {
      await ui.click("Cliente");
      await ui.click(nombre);
    },
  };
  await actualizar();
  return ui;
}

test("la cajera aplica 120, cobra 200 y el corte espera 200", async () => {
  const ui = await prepararPantalla();
  await ui.agregar();
  await ui.elegirCliente();
  await ui.click("Aplicar monedero");
  await ui.click("Importe");
  assert.match(ui.texto(), /Monedero aplicado.*120\.00/);
  assert.match(ui.texto(), /Total a cobrar.*200\.00/);
  await ui.capturar((n) => n.type === "input" && n.props.type === "number", "250");
  assert.match(ui.texto(), /Cambio: \$50\.00/);
  await ui.click("Confirmar cobro");
  assert.equal(ui.DB.pos.ventas.length, 1);
  assert.equal(ui.DB.pos.ventas[0].total, 320);
  assert.equal(ui.DB.pos.ventas[0].monedero_aplicado, 120);
  assert.equal(calcularCorteEnCurso(ui.DB, 1).calculado.EFECTIVO, 200);
  await ui.elegirCliente();
  assert.doesNotMatch(ui.texto(), /Aplicar monedero/);
  assert.match(ui.texto(), /Monedero: \$0\.00/);
});

test("pago completo con monedero permite confirmar sin efectivo", async () => {
  const ui = await prepararPantalla(500);
  await ui.agregar();
  await ui.elegirCliente();
  await ui.click("Aplicar monedero");
  await ui.click("Importe");
  assert.match(ui.texto(), /Total a cobrar.*0\.00/);
  await ui.click("Confirmar cobro");
  assert.equal(ui.DB.pos.ventas[0]?.monedero_aplicado, 320);
  assert.equal(calcularCorteEnCurso(ui.DB, 1).calculado.EFECTIVO, 0);
});

test("cambiar cliente quita el monedero y Público en General no lo ofrece", async () => {
  const ui = await prepararPantalla();
  await ui.agregar();
  assert.doesNotMatch(ui.texto(), /Aplicar monedero/);
  await ui.elegirCliente();
  await ui.click("Aplicar monedero");
  await ui.elegirCliente("Público en General");
  assert.doesNotMatch(ui.texto(), /Aplicar monedero|Quitar monedero/);
  await ui.elegirCliente();
  assert.match(ui.texto(), /Aplicar monedero/);
  assert.doesNotMatch(ui.texto(), /Quitar monedero/);
});

test("quitar monedero vuelve a cobrar el importe completo", async () => {
  const ui = await prepararPantalla();
  await ui.agregar();
  await ui.elegirCliente();
  await ui.click("Aplicar monedero");
  await ui.click("Quitar monedero");
  await ui.click("Importe");
  assert.match(ui.texto(), /Total a cobrar.*320\.00/);
});

test("una cotización no ofrece consumir saldo", async () => {
  const ui = await prepararPantalla();
  await ui.agregar();
  await ui.elegirCliente();
  await ui.click("Aplicar monedero");
  await ui.click("Cotiz.");
  assert.doesNotMatch(ui.texto(), /Aplicar monedero|Quitar monedero/);
  await ui.click("Importe");
  assert.match(ui.texto(), /Total a cotizar/);
  assert.equal(ui.DB.crm.clientes.find((c) => c.id === 1).monedero, 120);
});
