const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("../node_modules/react");
const { transformSync } = require("../node_modules/esbuild");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { listarGastos, corregirOrigenGasto } = require("./gastos");
const { listarCategorias } = require("./gastosCategorias");

// Mismo montaje del componente real que depositoSinFichaPantalla.test.js.
// Solo se sustituye el transporte HTTP; listado y corrección usan las funciones reales del backend.
const codigo = transformSync(fs.readFileSync(path.join(__dirname, "../src/Gastos.jsx"), "utf8"), {
  loader: "jsx", format: "cjs", logLevel: "silent",
}).code;
const TODAS = { verTodas: true, sucursalId: null };
const PERMISOS = ["ver_gastos", "registrar_gastos", "cancelar_gastos", "registrar_gasto_caja_fuerte"];

function prepararDB(gastos) {
  const DB = construirDBPrueba();
  sembrarCajas(DB);
  const categoria = DB.gastos.categorias.find((c) => c.categoria_padre_id != null);
  DB.gastos.gastos = gastos.map((extra, i) => ({
    id: i + 1, folio: `GAS-${i + 1}`, fecha: "2026-09-10", fecha_hora: "2026-09-10T18:00:00.000Z",
    sucursal_id: 1, caja_id: 1, categoria_id: categoria.id, concepto: `Gasto ${i + 1}`,
    descripcion: "", monto: 100, forma_pago: "EFECTIVO", origen: "CAJON",
    proveedor_id: null, numero_factura: "", nombre_archivo: "f.pdf",
    drive_file_id: `file-${i + 1}`, drive_link: `https://drive/file-${i + 1}`,
    usuario: "Ana", estatus: "activo", motivo_cancelacion: null, corte_id: null,
    ...extra,
  }));
  return DB;
}

async function prepararPantalla({ gastos = [{}], permisos = PERMISOS, encabezado = "1", cortePosterior = false } = {}) {
  const DB = prepararDB(gastos);
  if (cortePosterior) DB.pos.cortes_caja.push({
    id: 9, sucursal_id: 1, caja_id: 1, fecha_hora: "2026-09-10T19:00:00.000Z",
  });
  const usuario = { id: 1, nombre: "Ana", sucursal_id: 1 };
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
  const solicitudes = [];
  const api = {
    sucursalActiva: () => encabezado,
    cajaActiva: () => "1",
    async apiFetch(ruta, opciones = {}) {
      const url = new URL(ruta, "http://prueba");
      const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
      solicitudes.push({ ruta, metodo: opciones.method || "GET", cuerpo });
      let datos;
      let ok = true;
      if (url.pathname === "/gastos/categorias") {
        datos = listarCategorias(DB, { solo_activas: true });
      } else if (url.pathname === "/gastos") {
        const sucursal = url.searchParams.get("sucursal_id") || encabezado;
        const alcanceLista = sucursal === "todas" ? TODAS : { verTodas: false, sucursalId: Number(sucursal) };
        datos = listarGastos(DB, Object.fromEntries(url.searchParams), alcanceLista);
      } else if (url.pathname === "/proveedores") {
        datos = [];
      } else if (url.pathname === "/cajas") {
        const sucursal = url.searchParams.get("sucursal_id") || encabezado;
        datos = DB.pos.cajas.filter((c) => c.sucursal_id === Number(sucursal));
      } else if (/^\/gastos\/\d+\/origen$/.test(url.pathname) && opciones.method === "PUT") {
        try {
          // El alcance del guard por id viene de la sesión, nunca del encabezado.
          datos = corregirOrigenGasto(DB, url.pathname.split("/")[2], cuerpo, usuario, TODAS);
        } catch (error) { ok = false; datos = { error: error.message }; }
      } else {
        assert.fail(`Ruta inesperada: ${ruta}`);
      }
      const copia = JSON.parse(JSON.stringify(datos));
      return { ok, json: async () => copia };
    },
  };
  const modulo = { exports: {} };
  vm.runInNewContext(codigo, {
    module: modulo, exports: modulo.exports,
    require: (nombre) => {
      if (nombre === "react") return react;
      if (nombre === "./api") return api;
      if (nombre === "lucide-react") return new Proxy({}, { get: () => () => null });
      if (nombre === "./fechas") return { hoyLocal: () => "2026-09-11", haceDiasLocal: () => "2026-08-12" };
      if (nombre === "./comprimirImagen") return { comprimirImagen: async (f) => f };
      if (nombre === "./cargaSegura") return {
        pedirLista: async (fn) => ({ datos: await (await fn()).json(), error: null }),
      };
      if (["./ModalConfirmar", "./ModalPedirTexto"].includes(nombre)) return () => null;
      assert.fail(`Importación inesperada: ${nombre}`);
    },
    // Conserva los avisos para inspeccionarlos; no hace falta esperar cuatro segundos.
    setTimeout: () => 0,
    URLSearchParams, console,
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
        arbol = expandir(modulo.exports.default({ onVolver() {}, permisos, usuario }));
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
    DB, solicitudes, encontrar, actualizar,
    texto: () => texto(arbol),
    async click(etiqueta) {
      const boton = encontrar((n) => n.type === "button" && texto(n).includes(etiqueta))[0]
        || encontrar((n) => n.type === "button" && n.props.title === etiqueta)[0];
      assert.ok(boton, `Falta el botón ${etiqueta}`);
      assert.ok(!boton.props.disabled, `El botón ${etiqueta} está deshabilitado`);
      await boton.props.onClick?.({ preventDefault() {} });
      await actualizar();
    },
    async elegir(id, valor) {
      const campo = encontrar((n) => n.type === "select" && n.props.id === id)[0];
      assert.ok(campo, `Falta el selector ${id}`);
      campo.props.onChange({ target: { value: valor } });
      await actualizar();
    },
    async enviar() {
      const form = encontrar((n) => n.type === "form" && n.props.id === "form-origen-gasto")[0];
      assert.ok(form, "Falta el formulario de corrección");
      const boton = encontrar((n) => n.type === "button" && n.props.type === "submit" && n.props.form === form.props.id)[0];
      assert.ok(boton, "Guardar debe enviar el formulario, como en los modales vecinos");
      assert.ok(!boton.props.disabled);
      await form.props.onSubmit({ preventDefault() {} });
      await actualizar();
    },
  };
}

const accionesCorregir = (ui) => ui.encontrar((n) => n.type === "button" && n.props.title === "Corregir origen");

test("el filtro ofrece Todos, Cajón y Caja fuerte y filtra filas, conteo y total", async () => {
  const ui = await prepararPantalla({ gastos: [
    { concepto: "Cajón actual", monto: 100 },
    { concepto: "Resguardo", origen: "CAJA_FUERTE", monto: 200 },
    { concepto: "Histórico", origen: undefined, monto: 50 },
    { concepto: "Transferencia", forma_pago: "TRANSFERENCIA", monto: 400 },
  ] });
  const filtro = ui.encontrar((n) => n.type === "select" && n.props.id === "filtro-origen")[0];
  assert.ok(filtro, "Falta el filtro por origen");
  assert.deepEqual(ui.encontrar((n) => n.type === "option", filtro).map((n) => [n.props.value, n.props.children]), [
    ["", "Todos"], ["CAJON", "Cajón"], ["CAJA_FUERTE", "Caja fuerte"],
  ]);
  await ui.elegir("filtro-origen", "CAJON");
  assert.match(ui.texto(), /Cajón actual/);
  assert.match(ui.texto(), /Histórico/);
  assert.doesNotMatch(ui.texto(), /Resguardo|Transferencia/);
  assert.match(ui.texto(), /2 gasto\(s\)/);
  assert.match(ui.texto(), /Total activo: \$150\.00/);
  await ui.elegir("filtro-origen", "CAJA_FUERTE");
  assert.match(ui.texto(), /Resguardo/);
  assert.doesNotMatch(ui.texto(), /Cajón actual|Histórico|Transferencia/);
  assert.match(ui.texto(), /1 gasto\(s\)/);
  assert.match(ui.texto(), /Total activo: \$200\.00/);
  await ui.elegir("filtro-origen", "");
  assert.match(ui.texto(), /Transferencia/);
  assert.match(ui.texto(), /4 gasto\(s\)/);
  assert.match(ui.texto(), /Total activo: \$750\.00/);
});

test("un gasto activo sin sellar ofrece corregir y el modal se puede cerrar sin guardar", async () => {
  const ui = await prepararPantalla();
  assert.equal(accionesCorregir(ui).length, 1);
  await ui.click("Corregir origen");
  assert.equal(ui.encontrar((n) => n.type === "form" && n.props.id === "form-origen-gasto").length, 1);
  await ui.click("Cancelar");
  assert.equal(ui.encontrar((n) => n.type === "form" && n.props.id === "form-origen-gasto").length, 0);
  assert.equal(ui.solicitudes.filter((r) => r.metodo === "PUT").length, 0);
});

test("la red: un gasto sellado no ofrece corregir, incluso con el sello como texto", async () => {
  const ui = await prepararPantalla({ gastos: [{ corte_id: 9 }, { corte_id: "9" }] });
  assert.match(ui.texto(), /GAS-1/);
  assert.match(ui.texto(), /GAS-2/);
  assert.equal(accionesCorregir(ui).length, 0);
});

test("la red: un gasto cancelado no ofrece corregir", async () => {
  const ui = await prepararPantalla({ gastos: [{ estatus: "cancelado" }] });
  const estatus = ui.encontrar((n) => n.type === "select" && n.props.value === "activo")[0];
  assert.ok(estatus);
  // El selector de estatus ya existe antes de esta tarea.
  estatus.props.onChange({ target: { value: "cancelado" } });
  await ui.actualizar();
  assert.match(ui.texto(), /GAS-1/);
  assert.equal(accionesCorregir(ui).length, 0);
});

test("la red: los permisos vecinos de Gastos no autorizan corregir el origen", async () => {
  const ui = await prepararPantalla({ permisos: ["ver_gastos", "registrar_gastos", "cancelar_gastos"] });
  assert.match(ui.texto(), /GAS-1/);
  assert.equal(accionesCorregir(ui).length, 0);
});

test("guardar envía el origen y la caja a PUT /origen y refresca la lista filtrada", async () => {
  const ui = await prepararPantalla();
  await ui.elegir("filtro-origen", "CAJON");
  await ui.click("Corregir origen");
  await ui.elegir("origen-gasto", "CAJA_FUERTE");
  await ui.enviar();
  const enviada = ui.solicitudes.find((r) => r.metodo === "PUT");
  assert.equal(new URL(enviada.ruta, "http://prueba").pathname, "/gastos/1/origen");
  assert.deepEqual(enviada.cuerpo, { origen: "CAJA_FUERTE", caja_id: "1" });
  assert.equal(ui.DB.gastos.gastos[0].origen, "CAJA_FUERTE");
  assert.equal(ui.DB.gastos.gasto_movimientos.length, 1);
  assert.doesNotMatch(ui.texto(), /GAS-1/);
  assert.match(ui.texto(), /0 gasto\(s\)/);
});

test("desde Todas se corrige con cajas de la sucursal del gasto y admite ids de texto", async () => {
  const ui = await prepararPantalla({ encabezado: "todas", gastos: [{ sucursal_id: 2, caja_id: 3, origen: "CAJA_FUERTE" }] });
  await ui.click("Corregir origen");
  const caja = ui.encontrar((n) => n.type === "select" && n.props.id === "caja-origen-gasto")[0];
  assert.ok(caja);
  assert.deepEqual(ui.encontrar((n) => n.type === "option" && n.props.value !== "", caja).map((n) => String(n.props.value)), ["3", "4"]);
  await ui.elegir("origen-gasto", "CAJON");
  await ui.elegir("caja-origen-gasto", "4");
  await ui.enviar();
  assert.deepEqual(ui.solicitudes.find((r) => r.metodo === "PUT").cuerpo, { origen: "CAJON", caja_id: "4" });
  assert.equal(ui.DB.gastos.gastos[0].caja_id, 4);
  assert.equal(ui.DB.gastos.gastos[0].origen, "CAJON");
  assert.match(ui.texto(), /Fiscal/);
});

test("si el servidor rechaza por un corte posterior, muestra su mensaje intacto y conserva el modal", async () => {
  const ui = await prepararPantalla({ cortePosterior: true });
  await ui.click("Corregir origen");
  await ui.elegir("origen-gasto", "CAJA_FUERTE");
  await ui.enviar();
  const mensajeServidor = "Este gasto ya entro en un corte cerrado y su origen no se puede cambiar";
  assert.ok(ui.texto().includes(mensajeServidor));
  assert.equal(ui.DB.gastos.gastos[0].origen, "CAJON");
  assert.equal(ui.DB.gastos.gasto_movimientos.length, 0);
  assert.equal(ui.encontrar((n) => n.type === "form" && n.props.id === "form-origen-gasto").length, 1);
});
