import { test } from "node:test";
import assert from "node:assert/strict";
import {
  piezasTexto, pesosTexto, porcentaje, tramosDeFactura, etiquetaEtapa, siguienteAccion, puedeGestionar,
  parametrosLista, textoTraslado, validarPosponer, botonIncorporar, textoMotivo, TEXTOS,
} from "./seguimiento.js";

const factura = (extra = {}) => ({
  com_id: "12345678901234567890", etapa: "traslado", agotada: false, aviso: { id: 1, etapa: "traslado", estado: "nuevo" },
  piezas: { comprado: "360000", vendido: "100000", queda: "160000", transito: "50000", sin_agente: "40000", por_aclarar: "10000" },
  dinero: { vendido: "2778", queda: "4444", transito: "1389", gris: "1111", por_aclarar: "278" },
  ...extra,
});

test("piezas y pesos se escriben sin perder precisión", () => {
  assert.equal(piezasTexto("360000"), "36");
  assert.equal(piezasTexto("15000"), "1.5");
  assert.equal(piezasTexto("1"), "0.0001");
  assert.equal(piezasTexto("90071992547409930000"), "9,007,199,254,740,993");
  assert.equal(piezasTexto(null), "—");
  assert.equal(pesosTexto("10000"), "$100.00");
  assert.equal(pesosTexto("123456789"), "$1,234,567.89");
  assert.equal(pesosTexto("7"), "$0.07");
  assert.equal(pesosTexto(undefined), "—");
});

test("porcentaje con un decimal; total cero no es calculable", () => {
  assert.equal(porcentaje("1", "3"), 33.3);
  assert.equal(porcentaje("2", "3"), 66.7);
  assert.equal(porcentaje("0", "0"), null);
  assert.equal(porcentaje("10000", "10000"), 100);
});

test("la barra trae los cinco tramos con su texto fijo, en dinero y en piezas", () => {
  const t = tramosDeFactura(factura());
  assert.deepEqual(t.map((x) => x.id), ["vendido", "queda", "transito", "gris", "por_aclarar"]);
  assert.equal(t.find((x) => x.id === "gris").etiqueta, "Enviado, venta no comprobada");
  assert.equal(t.find((x) => x.id === "por_aclarar").etiqueta, "Movimientos por aclarar");
  assert.equal(t.find((x) => x.id === "queda").dinero, "$44.44");
  assert.equal(t.find((x) => x.id === "gris").piezas, "4");
  assert.equal(t.find((x) => x.id === "vendido").porcentaje, 27.8); // 2778 / 10000
  const total = t.reduce((a, x) => a + x.porcentaje, 0);
  assert.ok(Math.abs(total - 100) < 0.3);
});

test("sin dinero calculable la barra usa piezas y lo dice", () => {
  const t = tramosDeFactura(factura({ dinero: null }));
  assert.equal(t[0].dinero, "No calculable");
  assert.equal(t[0].porcentaje, 27.8); // 10 de 36 piezas
});

test("etapas y siguiente acción", () => {
  assert.equal(etiquetaEtapa("traslado"), "Revisar traslado");
  assert.equal(etiquetaEtapa("margen_75"), "Bajar precio (conservar 75 % de la ganancia)");
  assert.equal(etiquetaEtapa("margen_50"), "Bajar precio (conservar 50 % de la ganancia)");
  assert.equal(etiquetaEtapa("liquidar"), "Liquidar a costo");
  assert.equal(etiquetaEtapa(null), "Sin aviso");
  assert.equal(siguienteAccion(factura()), "Revisar traslado");
  const vendidaToda = { comprado: "10000", vendido: "10000", queda: "0", transito: "0", sin_agente: "0", por_aclarar: "0" };
  assert.equal(siguienteAccion(factura({ agotada: true, etapa: null, aviso: null, piezas: vendidaToda })), "Agotada");
  assert.equal(siguienteAccion(factura({ aviso: { estado: "pospuesto", pospuesto_hasta: "2026-12-01", etapa: "traslado" } })),
    "Pospuesto hasta 2026-12-01");
  assert.equal(siguienteAccion(factura({ aviso: { estado: "revisado", etapa: "traslado" } })), "Revisado: Revisar traslado");
  const soloGris = factura({ etapa: null, aviso: null, agotada: true,
    piezas: { comprado: "10000", vendido: "0", queda: "0", transito: "0", sin_agente: "10000", por_aclarar: "0" } });
  assert.equal(siguienteAccion(soloGris), "Pendiente de comprobación");
  assert.equal(siguienteAccion(factura({ etapa: null, aviso: null })), "Sin aviso");
});

test("botones de gestión ocultos sin permiso", () => {
  assert.equal(puedeGestionar(["ver_seguimiento_facturas"]), false);
  assert.equal(puedeGestionar(["ver_seguimiento_facturas", "gestionar_seguimiento_facturas"]), true);
  assert.equal(puedeGestionar(undefined), false);
});

test("incorporar: oculto sin permiso y deshabilitado con foto vieja", () => {
  const gestiona = ["gestionar_seguimiento_facturas"];
  assert.deepEqual(botonIncorporar({ vieja: false }, ["ver_seguimiento_facturas"]), { visible: false, deshabilitado: true, razon: "" });
  assert.deepEqual(botonIncorporar({ vieja: false }, gestiona), { visible: true, deshabilitado: false, razon: "" });
  const vieja = botonIncorporar({ vieja: true }, gestiona);
  assert.equal(vieja.deshabilitado, true);
  assert.match(vieja.razon, /foto.*vieja/i);
});

test("parámetros de la lista: solo filtros con valor", () => {
  assert.equal(parametrosLista({ proveedor: " yamaha ", folio: "", etapa: "traslado", solo_aviso: true, ocultar_agotadas: false, pagina: 2 }),
    "proveedor=yamaha&etapa=traslado&solo_aviso=1&pagina=2");
  assert.equal(parametrosLista({}), "");
});

test("texto de traslado y de información insuficiente", () => {
  const nombres = { 1: "Ocosingo", 3: "San Cristóbal" };
  assert.equal(textoTraslado({ de: 1, a: 3, piezas: "20000", razon: "destino_vende_mas" }, nombres, "A", "Púas"),
    "Revisar traslado de 2 piezas de A Púas: Ocosingo → San Cristóbal. Confirmar antes de mover en SICAR.");
  assert.equal(textoTraslado({ de: 1, a: 3, piezas: "10000", razon: "destino_vende_mas" }, nombres, "A", ""),
    "Revisar traslado de 1 pieza de A: Ocosingo → San Cristóbal. Confirmar antes de mover en SICAR.");
  assert.equal(textoTraslado({ de: 4, a: null, piezas: null, razon: "informacion_insuficiente" }, nombres, "A", "Púas"),
    "Información insuficiente para sugerir cantidad desde Tienda 4: revisar.");
});

test("posponer exige motivo de 3 a 200 caracteres y fecha futura", () => {
  assert.match(validarPosponer({ motivo: "", fecha: "2026-12-01" }, "2026-11-05"), /motivo/i);
  assert.match(validarPosponer({ motivo: "x".repeat(201), fecha: "2026-12-01" }, "2026-11-05"), /motivo/i);
  assert.match(validarPosponer({ motivo: "Temporada", fecha: "" }, "2026-11-05"), /fecha/i);
  assert.match(validarPosponer({ motivo: "Temporada", fecha: "2026-11-05" }, "2026-11-05"), /fecha/i);
  assert.equal(validarPosponer({ motivo: "Temporada", fecha: "2026-11-06" }, "2026-11-05"), null);
});

test("motivos de incertidumbre en palabras, nunca como faltante", () => {
  assert.equal(textoMotivo("recepcion_menor"), "Llegaron menos piezas de las enviadas");
  assert.equal(textoMotivo("venta_sin_existencia"), "Venta sin existencia registrada");
  assert.equal(textoMotivo("algo_nuevo"), "algo_nuevo");
  for (const t of Object.values(TEXTOS)) assert.doesNotMatch(t, /faltante|robo|culpa/i);
});
