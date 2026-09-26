const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearCorte, FORMAS_CORTE } = require("./cortes");
const { crearVenta, cancelarVenta } = require("./ventas");
const { crearApartado, cancelarApartado, registrarAbono } = require("./apartados");
const { crearGasto } = require("./gastos");
const { listarCategorias } = require("./gastosCategorias");
const { listarCondiciones } = require("./condicionesPago");
const { crearGarantia } = require("./garantias");
const { agregarGasto, crearCobroGarantia } = require("./garantiasGastos");
const { importarOrdenComoVenta } = require("./mercadolibre");
const importes = require("./importes");
const { TOPE_IMPORTE } = importes;

const USUARIO = { nombre: "Ana" };
const ALCANCE = { verTodas: true };
const RAPIDO = { permisos: ["agregar_articulo_rapido"] };
const ARCHIVO = { nombre_archivo: "ticket.pdf", tipo_mime: "application/pdf", contenido_base64: "cHJ1ZWJh" };

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  // Preparar el catálogo antes de fotografiar la base: su primera consulta lo siembra.
  listarCondiciones(DB, 1);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true, descuentos_pago_habilitado: false };
  return DB;
}

function apartado(DB, lineas = [{ producto_id: 1, cantidad: 1 }]) {
  return crearApartado(DB, {
    cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO", lineas,
  }, 1, USUARIO, null, RAPIDO);
}

function venta(DB, lineas = [{ producto_id: 1, cantidad: 1 }]) {
  return crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "TARJETA", lineas }, RAPIDO);
}

function rechazaSinCambios(DB, accion, mensaje) {
  const antes = structuredClone(DB);
  assert.throws(accion, mensaje);
  assert.deepEqual(DB, antes, "el rechazo no debe modificar la base");
}

for (const campo of ["contado", "retiro"]) {
  for (const forma of FORMAS_CORTE) {
    for (const valor of ["", NaN, Infinity, 1e308, -1, TOPE_IMPORTE + 1]) {
      test(`CORTE: ${campo}/${forma} rechaza ${String(valor)} sin sellar ventas`, () => {
        const DB = prepararDB();
        venta(DB);
        rechazaSinCambios(DB, () => crearCorte(DB, {
          sucursal_id: 1, [campo]: { [forma]: valor },
        }), /importe|contado|retiro/i);
      });
    }
  }
}

test("CORTE: ausentes y undefined siguen en cero; acepta cero y el límite", () => {
  const DB = prepararDB();
  const corte = crearCorte(DB, {
    sucursal_id: 1, contado: { EFECTIVO: undefined, TARJETA: TOPE_IMPORTE }, retiro: { EFECTIVO: 0 },
  });
  assert.deepEqual(corte.contado, { EFECTIVO: 0, CHEQUE: 0, VALES: 0, TARJETA: TOPE_IMPORTE });
  assert.deepEqual(corte.retiro, { EFECTIVO: 0, CHEQUE: 0, VALES: 0, TARJETA: 0 });
});

function driveSimulado() {
  const llamadas = [];
  return {
    llamadas,
    asegurarCarpetaGastosSucursal: async () => { llamadas.push("carpeta"); return "carpeta"; },
    asegurarCarpetaGarantia: async () => { llamadas.push("carpeta"); return "carpeta"; },
    subirArchivoADrive: async () => { llamadas.push("archivo"); return { id: "archivo", webViewLink: "https://drive/archivo" }; },
  };
}

for (const tipo of ["gasto", "gasto garantía", "cobro garantía"]) {
  for (const monto of [TOPE_IMPORTE + 1, 1e308]) {
    test(`GASTOS: ${tipo} rechaza ${monto} antes de DB y Drive`, async () => {
      const DB = prepararDB();
      const categoria = listarCategorias(DB, {}).find((c) => c.nombre === "Combustible");
      const garantia = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
      const drive = driveSimulado();
      const datos = { monto, concepto: "Prueba", categoria_id: categoria.id, forma_pago: "EFECTIVO", tipo: "otro", archivo: ARCHIVO };
      const antes = structuredClone(DB);
      await assert.rejects(async () => {
        if (tipo === "gasto") return crearGasto(DB, datos, 1, USUARIO, drive);
        if (tipo === "gasto garantía") return agregarGasto(DB, garantia.id, datos, USUARIO, ALCANCE, drive);
        return crearCobroGarantia(DB, garantia.id, datos, USUARIO, ALCANCE);
      }, /importe|monto/i);
      assert.deepEqual(DB, antes);
      assert.deepEqual(drive.llamadas, [], "ni siquiera se pide una carpeta en Drive");
    });
  }
}

for (const [nombre, crear] of [["VENTA", venta], ["APARTADO", apartado]]) {
  for (const catalogo of [false, true]) {
    // Antes usaba 0.5 piezas; desde 2026-09-25 solo hay piezas enteras y el precio se prueba con 1.
    test(`${nombre}: precio unitario fuera del techo con una sola pieza (${catalogo ? "catálogo" : "rápido"})`, () => {
      const DB = prepararDB();
      const precio = TOPE_IMPORTE + 1;
      DB["catalogo-productos"].productos.find((p) => p.id === 1).precio_venta = precio;
      const linea = catalogo
        ? { producto_id: 1, cantidad: 1 }
        : { descripcion: "Servicio", precio_unitario: precio, cantidad: 1 };
      rechazaSinCambios(DB, () => crear(DB, [linea]), /precio|importe/i);
    });
  }
  test(`${nombre}: cortesía y precio omitido conservan cero`, () => {
    const DB = prepararDB();
    crear(DB, [
      { producto_id: 1, cantidad: 1 },
      { descripcion: "Cortesía", cantidad: 1, precio_unitario: 0 },
      { descripcion: "Omitido", cantidad: 1 },
    ]);
    assert.deepEqual(DB.pos.venta_detalle.map((d) => d.precio_unitario), [25, 0, 0]);
  });
}

for (const [nombre, crear, cancelar] of [["VENTA", venta, cancelarVenta], ["APARTADO", apartado, cancelarApartado]]) {
  for (const saldo of [TOPE_IMPORTE, NaN, Infinity]) {
    test(`MONEDERO: cancelar ${nombre} con saldo ${String(saldo)} rechaza sin cambios`, () => {
      const DB = prepararDB();
      const documento = crear(DB);
      if (nombre === "VENTA") documento.monedero_aplicado = 1;
      DB.crm.clientes.find((c) => c.id === 1).monedero = saldo;
      rechazaSinCambios(DB, () => cancelar(DB, documento.id, "Prueba", USUARIO), /importe|monedero/i);
    });
  }
}

for (const campo of ["total", "abono previo"]) {
  for (const valor of [NaN, Infinity]) {
    test(`ABONO: ${campo} ${String(valor)} cierra la guarda sin cambios`, () => {
      const DB = prepararDB();
      const documento = apartado(DB);
      if (campo === "total") documento.total = valor;
      else DB.pos.apartado_abonos[0].monto = valor;
      rechazaSinCambios(DB, () => registrarAbono(DB, documento.id, {
        monto: 1, forma_pago: "EFECTIVO",
      }, USUARIO), /importe|saldo|total/i);
    });
  }
}

test("ABONO: monto fuera del techo se rechaza aunque el saldo histórico sea mayor", () => {
  const DB = prepararDB();
  const documento = apartado(DB);
  documento.total = TOPE_IMPORTE * 2;
  rechazaSinCambios(DB, () => registrarAbono(DB, documento.id, {
    monto: TOPE_IMPORTE + 1, forma_pago: "EFECTIVO",
  }, USUARIO), /importe.*abono/i);
});

test("IMPORTES: exigirImporteNoNegativo rechaza negativos y cifras inválidas", () => {
  assert.equal(typeof importes.exigirImporteNoNegativo, "function");
  for (const n of [-100, NaN, Infinity, 1e308, "", null]) {
    assert.throws(() => importes.exigirImporteNoNegativo(n, "orden"), /importe/i);
  }
  for (const n of [0, 125, TOPE_IMPORTE]) assert.equal(importes.exigirImporteNoNegativo(n, "orden"), n);
});

for (const existente of [false, true]) {
  for (const fallo of ["total desbordado", "total negativo", "línea inválida"]) {
    test(`ML REAL: ${fallo}, comprador ${existente ? "existente" : "nuevo"}, rechazo íntegro y reintento`, async (t) => {
      const DB = prepararDB();
      DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 5, cantidad_actual: 3 });
      DB.ml = {
        cuenta: { access_token: "prueba", expires_at: Date.now() + 300000, user_id: 123 },
        publicaciones: [], ordenes_importadas: [],
      };
      if (existente) DB.crm.clientes.push({ id: 100, clave: "ML-123", nombre: "Ana", estado: "prospecto", ultimo_contacto: "2026-01-01" });
      const orden = {
        id: 8101, status: "paid", date_created: "2026-09-12T12:00:00.000-06:00",
        total_amount: fallo === "total desbordado" ? 1e308 : fallo === "total negativo" ? -100 : 25,
        buyer: { id: 123, first_name: "Ana", last_name: "Pérez", nickname: "ana" },
        order_items: [{
          item: { id: "MLM-1", seller_sku: "AB-001", title: "Producto" },
          quantity: fallo === "línea inválida" ? 1e308 : 1, unit_price: 25,
        }],
      };
      const original = global.fetch;
      global.fetch = async () => ({ ok: true, json: async () => structuredClone(orden) });
      t.after(() => { global.fetch = original; });
      const antes = structuredClone(DB);
      await assert.rejects(importarOrdenComoVenta(DB, "8101"), /importe|cantidad/i);
      assert.deepEqual(DB, antes, "CRM, documentos, inventario y órdenes quedan intactos");
      orden.total_amount = 25;
      orden.order_items[0].quantity = 1;
      const resultado = await importarOrdenComoVenta(DB, "8101");
      assert.equal(resultado.total, 25);
      assert.equal(DB.pos.ventas.length, 1);
      assert.equal(DB.pos.venta_detalle.length, 1);
      assert.deepEqual(DB.ml.ordenes_importadas, ["8101"]);
      assert.equal(DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 5).cantidad_actual, 2);
      assert.equal(DB.crm.clientes.filter((c) => c.clave === "ML-123").length, 1);
    });
  }
}
