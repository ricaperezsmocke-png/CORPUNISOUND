import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parametrosTraspasos, alertasDeTraspaso, resumenDeAlertas, etiquetaFueraDeRango, textoComparacion, formatoCantidad,
  puedeEditarMapa, textoSinAsignar, nombreEstado, llaveTraspaso, filtrarPorTienda, textoOmitido, fechaTraspaso,
} from "./traspasosSicar.js";

const BASE = {
  sucursal_id: 3, tra_id: "9", estado: "recibido", fecha: "2026-10-20 10:00:00", dias_en_transito: 1, conciliacion: "dos_puntas",
  diferencias: [],
  alertas: { sin_recibir_3_dias: false, cancelado: false, con_diferencias: false, sin_conciliar: false, puntas_ambiguas: false },
};
const con = (cambios, alertas = {}) => ({ ...BASE, ...cambios, alertas: { ...BASE.alertas, ...alertas } });

test("parametrosTraspasos manda siempre su sucursal_id y omite lo vacio", () => {
  assert.equal(parametrosTraspasos({ sucursal: "", desde: "2026-10-01", hasta: "2026-10-25", estado: "" }),
    "sucursal_id=&desde=2026-10-01&hasta=2026-10-25");
  assert.equal(parametrosTraspasos({ sucursal: "4", desde: "", hasta: "", estado: "enviado" }), "sucursal_id=4&estado=enviado");
});

test("un traspaso sin problemas no trae alertas", () => {
  assert.deepEqual(alertasDeTraspaso(BASE), []);
});

test("las alertas salen con texto claro para quien no es tecnico", () => {
  const t = con({ dias_en_transito: 5, conciliacion: "sin_mapa" }, {
    sin_recibir_3_dias: true, cancelado: true, con_diferencias: true, sin_conciliar: true, puntas_ambiguas: true,
  });
  assert.deepEqual(alertasDeTraspaso(t).map((a) => a.texto), [
    "Enviado hace 5 días y no recibido",
    "Cancelado",
    "No se pudo comparar: falta asignar la tienda en el mapa",
    "Dos registros posibles de la otra tienda: revisar",
    "Piezas enviadas vs recibidas no cuadran",
  ]);
});

test("enviado hace un dia usa singular", () => {
  assert.equal(alertasDeTraspaso(con({ dias_en_transito: 1 }, { sin_recibir_3_dias: true }))[0].texto, "Enviado hace 1 día y no recibido");
});

test("resumenDeAlertas cuenta por tipo y omite los que no tienen", () => {
  const lista = [con({}, { cancelado: true }), con({}, { cancelado: true, con_diferencias: true }), BASE];
  const r = resumenDeAlertas(lista);
  assert.deepEqual(r.map((x) => [x.clave, x.cantidad]), [["cancelado", 2], ["con_diferencias", 1]]);
  assert.deepEqual(resumenDeAlertas([BASE]), []);
});

test("un enviado viejo fuera del rango se etiqueta como pendiente de fechas anteriores", () => {
  const viejo = con({ estado: "enviado", fecha: "2026-09-01 08:00:00" });
  assert.equal(etiquetaFueraDeRango(viejo, "2026-10-01", "2026-10-25"), "Pendiente de fechas anteriores");
  assert.equal(etiquetaFueraDeRango(con({ estado: "enviado", fecha: "2026-10-05 08:00:00" }), "2026-10-01", "2026-10-25"), "");
  assert.equal(etiquetaFueraDeRango(viejo, "", ""), "");
});

test("textoComparacion explica cada caso de conciliacion", () => {
  assert.match(textoComparacion(con({ conciliacion: "dos_puntas" })), /Comparado con la otra tienda/);
  assert.match(textoComparacion(con({ conciliacion: "una_punta" })), /todavía no llega el registro de la otra tienda/);
  assert.match(textoComparacion(con({ conciliacion: "sin_mapa" })), /falta asignar la tienda en el mapa/);
  assert.match(textoComparacion(con({ conciliacion: "mapa_no_coincide" })), /no coincide/);
  assert.match(textoComparacion(con({ conciliacion: "ambigua" })), /Dos registros posibles/);
});

test("formatoCantidad quita ceros sobrantes sin tocar el valor", () => {
  assert.equal(formatoCantidad("12.0000"), "12");
  assert.equal(formatoCantidad("-2.5000"), "-2.5");
  assert.equal(formatoCantidad("0.0050"), "0.005");
  assert.equal(formatoCantidad(undefined), "—");
});

test("el mapa solo se edita con administrar_sucursales y ver_todas_las_sucursales", () => {
  assert.equal(puedeEditarMapa(["administrar_sucursales", "ver_todas_las_sucursales"]), true);
  assert.equal(puedeEditarMapa(["administrar_sucursales"]), false);
  assert.equal(puedeEditarMapa(["ver_todas_las_sucursales"]), false);
  assert.equal(puedeEditarMapa(undefined), false);
});

test("textoSinAsignar avisa los numeros SICAR sin tienda", () => {
  assert.equal(textoSinAsignar([]), "");
  assert.equal(textoSinAsignar(["7"]), "El número SICAR 7 todavía no tiene tienda asignada.");
  assert.equal(textoSinAsignar(["7", "9"]), "Los números SICAR 7, 9 todavía no tienen tienda asignada.");
});

test("nombreEstado y llaveTraspaso", () => {
  assert.equal(nombreEstado("enviado"), "Enviado");
  assert.equal(nombreEstado("recibido"), "Recibido");
  assert.equal(nombreEstado("cancelado"), "Cancelado");
  assert.equal(llaveTraspaso(BASE), "3-9");
});

test("sin_conciliar dice la causa segun la conciliacion", () => {
  const sinMapa = con({ conciliacion: "sin_mapa" }, { sin_conciliar: true });
  const noCoincide = con({ conciliacion: "mapa_no_coincide" }, { sin_conciliar: true });
  assert.equal(alertasDeTraspaso(sinMapa)[0].texto, "No se pudo comparar: falta asignar la tienda en el mapa");
  assert.equal(alertasDeTraspaso(noCoincide)[0].texto, "No se pudo comparar: el mapa de sucursales no coincide con este traspaso");
});

test("ambigua se avisa como dos registros posibles", () => {
  const t = con({ conciliacion: "ambigua" }, { puntas_ambiguas: true });
  assert.equal(alertasDeTraspaso(t)[0].texto, "Dos registros posibles de la otra tienda: revisar");
});

test("resumenDeAlertas separa sin mapa de mapa que no coincide", () => {
  const lista = [
    con({ conciliacion: "sin_mapa" }, { sin_conciliar: true }),
    con({ conciliacion: "sin_mapa" }, { sin_conciliar: true }),
    con({ conciliacion: "mapa_no_coincide" }, { sin_conciliar: true }),
  ];
  const r = resumenDeAlertas(lista);
  assert.deepEqual(r.map((x) => [x.clave, x.cantidad]), [["sin_mapa", 2], ["mapa_no_coincide", 1]]);
  assert.match(r[0].texto, /falta asignar la tienda en el mapa/);
  assert.match(r[1].texto, /el mapa no coincide/);
});

test("filtrarPorTienda: Todas muestra todo y una tienda solo sus renglones", () => {
  const lista = [con({ sucursal_id: 3 }), con({ sucursal_id: 4, tra_id: "1" }), con({ sucursal_id: 3, tra_id: "2" })];
  assert.equal(filtrarPorTienda(lista, "").length, 3);
  assert.deepEqual(filtrarPorTienda(lista, "3").map((t) => t.tra_id), ["9", "2"]);
  assert.equal(filtrarPorTienda(lista, "7").length, 0);
});

const OMITIDO = { sucursal_id: 1, tienda: "Ocosingo", tra_id: "2500", codigo: "DETALLE_FUERA_DE_LIMITE",
  motivo: "No tiene artículos o tiene más de 500 artículos distintos; el sistema no lo acepta" };

test("textoOmitido dice que el traspaso no llegó, de qué tienda y por qué", () => {
  assert.equal(textoOmitido(OMITIDO), "Traspaso SICAR #2500 de Ocosingo no llegó al sistema: "
    + "No tiene artículos o tiene más de 500 artículos distintos; el sistema no lo acepta. Revísalo en SICAR.");
  assert.equal(textoOmitido({ sucursal_id: 4, tra_id: "7", motivo: "" }), "Traspaso SICAR #7 de Tienda 4 no llegó al sistema: "
    + "Dato que el sistema no sabe leer. Revísalo en SICAR.");
});

test("resumenDeAlertas pone primero los traspasos que no llegaron, antes que las demás alertas", () => {
  const r = resumenDeAlertas([con({}, { cancelado: true })], [OMITIDO, { ...OMITIDO, tra_id: "2501" }]);
  assert.deepEqual(r.map((x) => [x.clave, x.cantidad]), [["omitidos", 2], ["cancelado", 1]]);
  assert.equal(r[0].texto, "traspasos que no llegaron al sistema");
  assert.equal(r[0].roja, true);
  assert.equal(resumenDeAlertas([], [OMITIDO])[0].texto, "traspaso que no llegó al sistema");
  assert.deepEqual(resumenDeAlertas([con({}, { cancelado: true })]).map((x) => x.clave), ["cancelado"], "sin omitidos, igual que antes");
});

test("filtrarPorTienda tambien filtra los omitidos por la tienda dueña", () => {
  const lista = [OMITIDO, { ...OMITIDO, sucursal_id: 2, tra_id: "9" }];
  assert.deepEqual(filtrarPorTienda(lista, "2").map((o) => o.tra_id), ["9"]);
  assert.equal(filtrarPorTienda(lista, "").length, 2);
});

test("fechaTraspaso muestra DD/MM/AAAA con el dia solo (como lo guarda el servidor) o con hora", () => {
  assert.equal(fechaTraspaso("2026-10-18"), "18/10/2026");
  assert.equal(fechaTraspaso("2026-10-18 09:30:00"), "18/10/2026");
  assert.equal(fechaTraspaso("2026-10-18T09:30:00"), "18/10/2026");
  for (const malo of [null, undefined, "", "18/10/2026", "2026-10", "basura"]) assert.equal(fechaTraspaso(malo), "—", String(malo));
});
