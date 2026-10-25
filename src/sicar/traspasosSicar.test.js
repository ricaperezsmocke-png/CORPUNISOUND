import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parametrosTraspasos, alertasDeTraspaso, resumenDeAlertas, etiquetaFueraDeRango, textoComparacion, formatoCantidad,
  puedeEditarMapa, textoSinAsignar, nombreEstado, llaveTraspaso, filtrarPorTienda,
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
