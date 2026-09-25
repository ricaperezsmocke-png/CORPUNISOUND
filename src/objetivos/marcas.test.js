import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esCapturaDeVenta, pesosConCentavos, textoPendiente, capturasDelDia, resumenMarcasDelDia,
  esRectificacionDeElemento, vigenteDeElemento, armarRealesCierre, camposFaltantesCierre, llaveCampo, renglonesDelDia,
  creditoCompleto, filasMetasTienda, consultaElemento, formatoUnidad, resumenAntesDeSellar, restarEnCentavos,
} from "./marcas.js";

test("una captura sin tipo es de venta; marca y producto no", () => {
  assert.equal(esCapturaDeVenta({ monto: 1 }), true);
  assert.equal(esCapturaDeVenta({ tipo: "venta" }), true);
  assert.equal(esCapturaDeVenta({ tipo: "marca", marca_id: 1 }), false);
  assert.equal(esCapturaDeVenta({ tipo: "producto", producto_meta_id: 1 }), false);
});

test("los pesos del cierre llevan centavos", () => {
  assert.equal(pesosConCentavos(1234.5), "$1,234.50");
  assert.equal(pesosConCentavos(0), "$0.00");
  assert.equal(pesosConCentavos(null), "$0.00");
});

test("el pendiente del reparto se dice con palabras, nunca negativo", () => {
  assert.equal(textoPendiente(0, "pesos"), "Reparto completo");
  assert.equal(textoPendiente(1500, "pesos"), "Faltan $1,500.00 por repartir");
  assert.equal(textoPendiente(-2, "piezas"), "Asignaste 2 piezas de más");
  assert.equal(textoPendiente(1, "creditos"), "Falta 1 crédito por repartir");
  assert.equal(textoPendiente(3, "creditos"), "Faltan 3 créditos por repartir");
});

const capturas = [
  { id: 1, tipo: "venta", fecha: "2026-09-10", monto: 8500, vigente: true },
  { id: 2, tipo: "marca", marca_id: 1, fecha: "2026-09-10", monto: 4000, vigente: true },
  { id: 3, tipo: "marca", marca_id: 2, fecha: "2026-09-10", monto: 2000, vigente: true },
  { id: 4, tipo: "marca", marca_id: 2, fecha: "2026-09-10", monto: 9000, vigente: false },
  { id: 5, tipo: "producto", producto_meta_id: 1, fecha: "2026-09-10", monto: 2, vigente: true },
  { id: 6, fecha: "2026-09-11", monto: 100, vigente: true },
];

test("capturas del día filtra por fecha, tipo y vigencia", () => {
  assert.deepEqual(capturasDelDia(capturas, "2026-09-10", "marca").map((c) => c.id), [2, 3]);
  assert.deepEqual(capturasDelDia(capturas, "2026-09-11", "venta").map((c) => c.id), [6]);
});

test("el letrero de marcas compara lo capturado con la venta vigente del día", () => {
  assert.deepEqual(resumenMarcasDelDia(capturas, "2026-09-10"), { venta: 8500, enMarcas: 6000 });
  assert.deepEqual(resumenMarcasDelDia(capturas, "2026-09-12"), { venta: null, enMarcas: 0 });
});

test("una rectificación con referencia es de elemento, no de venta", () => {
  assert.equal(esRectificacionDeElemento({ campo: "meta" }), false);
  assert.equal(esRectificacionDeElemento({ campo: "meta", marca_id: 3 }), true);
  assert.equal(esRectificacionDeElemento({ campo: "real", financiera: "atrato" }), true);
  assert.equal(esRectificacionDeElemento({ campo: "real", producto_meta_id: 0 }), true);
});

test("el vigente de un elemento aplica solo sus rectificaciones, en orden", () => {
  const marca = { marca_id: 3, meta: 100, capturado: 80, real: 70 };
  const rect = [
    { campo: "real", marca_id: 3, valor_nuevo: 75 },
    { campo: "real", marca_id: 4, valor_nuevo: 1 },
    { campo: "meta", valor_nuevo: 999 },
    { campo: "real", marca_id: 3, valor_nuevo: 78 },
  ];
  assert.deepEqual(vigenteDeElemento(marca, rect, "marca_id"), { meta: 100, capturado: 80, real: 78 });
  const credito = { financiera: "atrato", meta: 2, registrados: 1, real: 1 };
  assert.deepEqual(vigenteDeElemento(credito, [{ campo: "capturado", financiera: "atrato", valor_nuevo: 2 }], "financiera"),
    { meta: 2, capturado: 2, real: 1 });
});

const previo = [{
  vendedor_id: 7, meta: 1000, capturado: 900,
  marcas: [{ marca_id: 3, nombre: "Yamaha", meta: 500, capturado: 400 }],
  productos: [{ producto_meta_id: 1, nombre: "Teclados", meta: 2, capturado: 1 }],
  creditos: [{ financiera: "coppel_pay", meta: 0, registrados: 1 }],
}];

test("el cuerpo del cierre lleva SICAR y los tres grupos con números", () => {
  const valores = {
    [llaveCampo(7, "sicar", "")]: "950.5", [llaveCampo(7, "marcas", 3)]: "410",
    [llaveCampo(7, "productos", 1)]: "1", [llaveCampo(7, "creditos", "coppel_pay")]: "1",
  };
  assert.deepEqual(armarRealesCierre(previo, valores), [{
    vendedor_id: 7, real_sicar: 950.5,
    marcas: [{ marca_id: 3, real: 410 }],
    productos: [{ producto_meta_id: 1, real: 1 }],
    creditos: [{ financiera: "coppel_pay", real: 1 }],
  }]);
});

test("un campo vacío del cierre se reporta; cero no es vacío", () => {
  const valores = {
    [llaveCampo(7, "sicar", "")]: "0", [llaveCampo(7, "marcas", 3)]: "",
    [llaveCampo(7, "productos", 1)]: "0",
  };
  assert.deepEqual(camposFaltantesCierre(previo, valores), [llaveCampo(7, "marcas", 3), llaveCampo(7, "creditos", "coppel_pay")]);
});

test("los renglones del día juntan metas propias, capturas del día y agregados, sin repetir", () => {
  const capturasMes = [
    { id: 10, tipo: "marca", marca_id: 5, fecha: "2026-09-10", monto: 300, vigente: true },
    { id: 11, tipo: "marca", marca_id: 3, fecha: "2026-09-09", monto: 900, vigente: true },
  ];
  const renglones = renglonesDelDia({
    clave: "marca_id", tipo: "marca", fecha: "2026-09-10", vendedorId: "7", extras: [8, 3],
    elementosMeta: [
      { marca_id: 3, nombre: "Yamaha", lineas: [{ vendedor_id: 7, monto: 5000 }, { vendedor_id: 9, monto: 1 }] },
      { marca_id: 4, nombre: "Casio", lineas: [{ vendedor_id: 9, monto: 2000 }] },
    ],
    catalogo: [{ id: 3, nombre: "Yamaha" }, { id: 5, nombre: "Fender" }, { id: 8, nombre: "Roland" }],
    capturas: capturasMes, totales: [{ marca_id: 3, total_capturado: 900 }],
  });
  assert.deepEqual(renglones.map((r) => [r.id, r.nombre, r.meta, r.totalMes, r.captura?.id ?? null]), [
    [3, "Yamaha", 5000, 900, null],
    [5, "Fender", null, 0, 10],
    [8, "Roland", null, 0, null],
  ]);
});

test("un elemento capturado que ya no está en el catálogo conserva un nombre", () => {
  const renglones = renglonesDelDia({
    clave: "producto_meta_id", tipo: "producto", fecha: "2026-09-10", vendedorId: 7, extras: [],
    elementosMeta: [], catalogo: [], totales: [],
    capturas: [{ id: 1, tipo: "producto", producto_meta_id: 2, fecha: "2026-09-10", monto: 1, vigente: true }],
  });
  assert.equal(renglones[0].nombre, "Elemento #2");
});

test("el formulario de crédito exige financiera, fecha, monto mayor que cero y folio", () => {
  const completo = { financiera: "atrato", fecha: "2026-09-10", monto: "1500", folio: "AT-9" };
  assert.equal(creditoCompleto(completo), true);
  assert.equal(creditoCompleto({ ...completo, folio: "   " }), false);
  assert.equal(creditoCompleto({ ...completo, monto: "0" }), false);
  assert.equal(creditoCompleto({ ...completo, monto: "" }), false);
  assert.equal(creditoCompleto({ ...completo, financiera: "" }), false);
  assert.equal(creditoCompleto({ ...completo, fecha: "" }), false);
});

test("la tabla del gerente junta marcas, productos y créditos con su unidad", () => {
  const filas = filasMetasTienda({
    marcas: [{ marca_id: 3, nombre: "Yamaha", meta_tienda: 20000, asignado: 10000, sin_asignar: 10000, lineas: [] }],
    productos: [{ producto_meta_id: 1, nombre: "Teclados", meta_tienda: 6, asignado: 6, sin_asignar: 0, lineas: [] }],
    creditos: [{ financiera: "atrato", etiqueta: "Atrato", meta_tienda: 2, asignado: 3, sin_asignar: -1, lineas: [] }],
  });
  assert.deepEqual(filas.map((f) => [f.llave, f.tipo, f.clave, f.id, f.nombre, f.unidad]), [
    ["marca|3", "marca", "marca_id", 3, "Yamaha", "pesos"],
    ["producto|1", "producto", "producto_meta_id", 1, "Teclados", "piezas"],
    ["credito|atrato", "credito", "financiera", "atrato", "Atrato", "creditos"],
  ]);
  assert.deepEqual(filasMetasTienda({}), []);
});

test("la consulta de un elemento lleva su tipo y su referencia", () => {
  assert.equal(consultaElemento({ tipo: "marca", clave: "marca_id", id: 3 }), "tipo=marca&marca_id=3");
  assert.equal(consultaElemento({ tipo: "credito", clave: "financiera", id: "coppel_pay" }), "tipo=credito&financiera=coppel_pay");
});

test("cada unidad se escribe como la entiende la tienda", () => {
  assert.equal(formatoUnidad("pesos", 1500), "$1,500.00");
  assert.equal(formatoUnidad("piezas", 1), "1 pieza");
  assert.equal(formatoUnidad("creditos", 3), "3 créditos");
});

test("el resumen antes de sellar cuenta personas con diferencia por grupo", () => {
  const previoDos = [
    ...previo,
    { vendedor_id: 8, meta: 0, capturado: 500, marcas: [], productos: [], creditos: [{ financiera: "atrato", meta: 1, registrados: 1 }] },
  ];
  const valores = {
    [llaveCampo(7, "sicar", "")]: "900", [llaveCampo(7, "marcas", 3)]: "410",
    [llaveCampo(7, "productos", 1)]: "1", [llaveCampo(7, "creditos", "coppel_pay")]: "1",
    [llaveCampo(8, "sicar", "")]: "450", [llaveCampo(8, "creditos", "atrato")]: "1",
  };
  assert.deepEqual(resumenAntesDeSellar(previoDos, valores), {
    personas: 2, conDiferencia: { venta: 1, marcas: 1, productos: 0, creditos: 0 },
  });
});

test("una persona solo con créditos también envía su real de crédito", () => {
  const soloCreditos = [{ vendedor_id: 9, meta: 0, capturado: 0, marcas: [], productos: [],
    creditos: [{ financiera: "atrato", meta: 0, registrados: 2 }] }];
  const valores = { [llaveCampo(9, "sicar", "")]: "0", [llaveCampo(9, "creditos", "atrato")]: "2" };
  assert.deepEqual(armarRealesCierre(soloCreditos, valores),
    [{ vendedor_id: 9, real_sicar: 0, marcas: [], productos: [], creditos: [{ financiera: "atrato", real: 2 }] }]);
  assert.deepEqual(camposFaltantesCierre(soloCreditos, { [llaveCampo(9, "sicar", "")]: "0" }), [llaveCampo(9, "creditos", "atrato")]);
});

test("las sumas y restas de pesos se hacen en centavos exactos", () => {
  const conCentavos = [
    { id: 1, tipo: "venta", fecha: "2026-09-10", monto: 71.6, vigente: true },
    { id: 2, tipo: "marca", marca_id: 1, fecha: "2026-09-10", monto: 1.4, vigente: true },
    { id: 3, tipo: "marca", marca_id: 2, fecha: "2026-09-10", monto: 70.2, vigente: true },
  ];
  assert.deepEqual(resumenMarcasDelDia(conCentavos, "2026-09-10"), { venta: 71.6, enMarcas: 71.6 });
  assert.equal(restarEnCentavos(80.5, 70.2), 10.3);
  assert.equal(restarEnCentavos(71.60000000000001, 71.6), 0);
  const previoCentavos = [{ vendedor_id: 1, capturado: 71.60000000000001, marcas: [{ marca_id: 1, capturado: 0.30000000000000004 }],
    productos: [], creditos: [] }];
  const valores = { [llaveCampo(1, "sicar", "")]: "71.6", [llaveCampo(1, "marcas", 1)]: "0.3" };
  assert.deepEqual(resumenAntesDeSellar(previoCentavos, valores).conDiferencia, { venta: 0, marcas: 0, productos: 0, creditos: 0 });
});
