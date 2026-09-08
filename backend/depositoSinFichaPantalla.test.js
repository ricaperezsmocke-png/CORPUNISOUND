/**
 * La pantalla del Estado de Cuenta tiene que GRITAR cuando un depósito va sin
 * ficha: hasta hoy respondía "✅ Depósito registrado" en verde, igual que si
 * tuviera respaldo, y en la lista quedaba un guion gris entre treinta renglones.
 *
 * Decisión de Victor (2026-09-07): que grite, pero que deje registrar. Guardar
 * sin ficha sigue siendo posible —Drive se cae y la ficha suele llegar más
 * tarde— pero exige un acto consciente, y el dinero sin respaldo se queda a la
 * vista hasta que alguien suba el papel.
 *
 * Ejecuta el componente real con esbuild + vm, igual que monederoPantalla.test.js.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("../node_modules/react");
const { transformSync } = require("../node_modules/esbuild");
const { crearDeposito } = require("./depositos");
const { estadoCuenta } = require("./estadoCuenta");

const codigo = transformSync(fs.readFileSync(path.join(__dirname, "../src/EstadoCuenta.jsx"), "utf8"), {
  loader: "jsx", format: "cjs", logLevel: "silent",
}).code;

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const driveFalso = {
  asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive/file-1" }),
};

async function prepararPantalla({ sinFicha = 0, conFicha = 0 } = {}) {
  const DB = {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }] },
    cuenta_comun: { depositos: [], deposito_movimientos: [], ultimo_id: 0 },
    inventario: { traspasos: [] },
    "catalogo-productos": { productos: [] },
  };
  const usuario = { id: 1, nombre: "Ana", sucursal_id: 1 };
  const ficha = { nombre_archivo: "f.pdf", tipo_mime: "application/pdf", contenido_base64: Buffer.from("f").toString("base64") };
  for (let i = 0; i < sinFicha; i++) await crearDeposito(DB, { monto: 10000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  for (let i = 0; i < conFicha; i++) await crearDeposito(DB, { monto: 2000, forma_pago: "EFECTIVO", archivo: ficha }, 1, usuario, driveFalso);

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
      if (!hooks[i] || !mismos(hooks[i].deps, deps)) { hooks[i] = { deps }; efectos.push(fn); }
    },
  };

  const enviados = [];
  const api = {
    sucursalActiva: () => "1",
    async apiFetch(ruta, opciones = {}) {
      let data;
      if (ruta.startsWith("/depositos") && opciones.method === "POST") {
        const cuerpo = JSON.parse(opciones.body);
        enviados.push(cuerpo);
        data = await crearDeposito(DB, cuerpo, 1, usuario, driveFalso);
      } else if (ruta.startsWith("/estado-cuenta")) {
        data = estadoCuenta(DB, {}, ALCANCE_TODAS);
      } else if (ruta.startsWith("/depositos")) {
        data = DB.cuenta_comun.depositos;
      } else {
        assert.fail(`Ruta inesperada: ${ruta}`);
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
      if (nombre === "./fechas") return { hoyLocal: () => "2026-09-07", haceDiasLocal: () => "2026-08-08" };
      if (nombre === "./comprimirImagen") return { comprimirImagen: async (f) => f };
      if (nombre === "./reportes/exportarCSV.js") return { descargarCSV: () => {} };
      if (nombre === "./cargaSegura") return {
        pedirLista: async (fn) => ({ datos: await (await fn()).json(), error: null }),
        pedirDato: async (fn) => ({ datos: await (await fn()).json(), error: null }),
      };
      return () => null;
    },
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn) => fn && fn(),
    URLSearchParams, Buffer, console,
  });

  function expandir(nodo) {
    if (Array.isArray(nodo)) return nodo.map(expandir);
    if (!nodo || typeof nodo !== "object") return nodo;
    if (typeof nodo.type === "function") return expandir(nodo.type(nodo.props));
    return { ...nodo, props: { ...nodo.props, children: expandir(nodo.props.children) } };
  }
  async function actualizar() {
    for (let vuelta = 0; vuelta < 25; vuelta++) {
      if (pendiente) {
        pendiente = false;
        cursor = 0;
        arbol = expandir(modulo.exports.default({ onVolver() {}, permisos: null, usuario }));
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
  await actualizar();
  return {
    DB, enviados, encontrar, actualizar,
    texto: () => texto(arbol),
    async click(etiqueta) {
      const boton = encontrar((n) => n.type === "button" && texto(n).includes(etiqueta))[0];
      assert.ok(boton, `Falta el botón ${etiqueta}`);
      await boton.props.onClick?.({ preventDefault() {} });
      await actualizar();
    },
    async llenarMonto(valor) {
      const campo = encontrar((n) => n.type === "input" && n.props.type === "number" && n.props.required)[0];
      assert.ok(campo, "Falta el campo del monto");
      campo.props.onChange({ target: { value: valor } });
      await actualizar();
    },
    async enviarFormulario() {
      const form = encontrar((n) => n.type === "form" && n.props.id === "form-deposito")[0];
      assert.ok(form, "Falta el formulario del depósito");
      await form.props.onSubmit({ preventDefault() {} });
      await actualizar();
    },
  };
}

test("el tablero avisa cuánto dinero lleva sin comprobante", async () => {
  const ui = await prepararPantalla({ sinFicha: 2, conFicha: 1 });
  const t = ui.texto();
  assert.match(t, /sin comprobante/i, "la pantalla tiene que nombrar el problema");
  assert.match(t, /20,?000\.00/, "y decir cuánto dinero es");
});

test("sin depósitos pendientes no se inventa una alarma", async () => {
  const ui = await prepararPantalla({ conFicha: 2 });
  assert.doesNotMatch(ui.texto(), /sin comprobante/i);
});

test("guardar sin ficha NO registra a la primera: pide confirmar", async () => {
  const ui = await prepararPantalla();
  await ui.click("Registrar depósito");
  await ui.llenarMonto("10000");
  await ui.enviarFormulario();

  assert.equal(ui.enviados.length, 0, "no puede irse al servidor sin que alguien lo confirme");
  assert.match(ui.texto(), /sin comprobante/i, "y tiene que decir por qué se detuvo");
});

test("tras confirmar, el depósito sin ficha SÍ se registra: no se bloquea a nadie", async () => {
  const ui = await prepararPantalla();
  await ui.click("Registrar depósito");
  await ui.llenarMonto("10000");
  await ui.enviarFormulario();

  // El botón cambia de cara: deja de decir "Guardar depósito". Es type="submit"
  // con form=, como el resto de los modales de este sistema, así que confirmar
  // es volver a enviar el formulario — lo que hace el navegador al pulsarlo.
  const confirmar = ui.encontrar((n) => n.type === "button" && n.props.type === "submit" && n.props.form === "form-deposito")[0];
  assert.ok(confirmar, "Falta el botón de confirmar");
  assert.match(JSON.stringify(confirmar.props.children), /Registrar sin comprobante/, "el botón tiene que decir lo que va a hacer");
  await ui.enviarFormulario();

  assert.equal(ui.enviados.length, 1, "el depósito se registra igual");
  assert.equal(ui.enviados[0].monto, "10000");
  assert.ok(!ui.enviados[0].archivo, "y va sin ficha, como se pidió");
});
