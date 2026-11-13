import { test } from "node:test";
import assert from "node:assert/strict";
import {
  piezasTexto, pesosTexto, porcentaje, tramosDeFactura, etiquetaEtapa, siguienteAccion, puedeGestionar,
  parametrosLista, textoTraslado, validarPosponer, botonIncorporar, textoMotivo, TEXTOS, fechaHoraLocal, textoComparacion, textoPorArticulo,
  totalFacturaTexto, valorConIvaTexto, notaRescate,
} from "./seguimiento.js";

const factura = (extra = {}) => ({
  com_id: "12345678901234567890", etapa: "traslado", agotada: false, aviso: { id: 1, etapa: "traslado", estado: "nuevo" },
  piezas: { comprado: "360000", vendido: "100000", queda: "160000", transito: "50000", sin_agente: "40000", por_aclarar: "10000" },
  dinero: { vendido: "2778", queda: "4444", transito: "1389", gris: "1111", por_aclarar: "278" },
  ...extra,
});

test('posponer limita 30 días y respeta el máximo configurado', () => {
  const datos = fecha => ({ motivo: 'Esperando venta', fecha });
  assert.equal(validarPosponer(datos('2027-01-30'), '2026-12-30'), 'No se puede posponer más de 30 días.');
  assert.equal(validarPosponer(datos('2027-01-29'), '2026-12-30'), null);
  assert.equal(validarPosponer(datos('2027-01-10'), '2026-12-30', 10), 'No se puede posponer más de 10 días.');
  assert.equal(validarPosponer(datos('2027-01-09'), '2026-12-30', 10), null);
});

test('historial traduce la reapertura automática por falta de movimiento', () => {
  assert.equal(textoMotivo('sin_movimiento_desde_revision'), 'Volvió solo: sin movimiento desde la revisión');
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
  assert.equal(textoMotivo("cuenta_interna"), "Salida a cuenta interna (no cuenta como venta)");
  assert.equal(textoMotivo("algo_nuevo"), "algo_nuevo");
  for (const t of Object.values(TEXTOS)) assert.doesNotMatch(t, /faltante|robo|culpa/i);
});

test("fechas y horas en hora de Chiapas, no en UTC", () => {
  assert.equal(fechaHoraLocal("2026-11-05T18:50:50.399Z"), "2026-11-05 12:50");
  assert.equal(fechaHoraLocal("2026-11-06T03:10:00.000Z"), "2026-11-05 21:10"); // ya es otro día en UTC
  assert.equal(fechaHoraLocal("2026-11-06T03:10:00.000Z", { soloFecha: true }), "2026-11-05");
  assert.equal(fechaHoraLocal(null), "—");
  assert.equal(fechaHoraLocal("no es fecha"), "—");
});

test("sin traslado sugerido se explica por qué, sin culpar a nadie", () => {
  assert.match(TEXTOS.sin_traslado, /ninguna tienda/i);
});

test("factura con renglones sin clave: información insuficiente antes que cualquier otra acción", () => {
  assert.equal(siguienteAccion(factura({ renglones_sin_seguimiento: 1, dinero: null })),
    "Información insuficiente: 1 renglón sin clave en el catálogo de CEDIS");
  assert.equal(siguienteAccion(factura({ renglones_sin_seguimiento: 3, dinero: null })),
    "Información insuficiente: 3 renglones sin clave en el catálogo de CEDIS");
});

test("comparación contra SICAR: la diferencia es un movimiento por aclarar, no un faltante", () => {
  const n = { 1: "Ocosingo", 6: "CEDIS" };
  assert.equal(textoComparacion({ sucursal_id: 6, calculado: "90000", sicar: "80000", diferencia: "-10000" }, n),
    "CEDIS: SICAR 8 · calculado 9 · diferencia -1 (movimientos por aclarar)");
  assert.equal(textoComparacion({ sucursal_id: 1, calculado: "0", sicar: "0", diferencia: "0" }, n), "Ocosingo: SICAR 0 · calculado 0 · cuadra");
  assert.equal(textoComparacion({ sucursal_id: 1, calculado: null, sicar: "0", diferencia: null }, n),
    "Ocosingo: SICAR 0 · calculado pendiente de recálculo");
  assert.equal(textoComparacion({ sucursal_id: 1, calculado: "0", sicar: null, motivo_sicar: "clave_repetida", diferencia: null }, n),
    "Ocosingo: clave repetida en SICAR, no se puede comparar · calculado 0");
  assert.equal(textoComparacion({ sucursal_id: 1, calculado: "0", sicar: null, motivo_sicar: "existencia_atrasada", diferencia: null }, n),
    "Ocosingo: existencia de SICAR atrasada, no se puede comparar · calculado 0");
  assert.equal(textoComparacion({ sucursal_id: 1, calculado: "0", sicar: null, motivo_sicar: "sin_existencia", diferencia: null }, n),
    "Ocosingo: SICAR no reporta existencia, no se puede comparar · calculado 0");
  assert.equal(textoComparacion({ sucursal_id: 1, calculado: "0", sicar: null, motivo_sicar: "catalogo_incompleto", diferencia: null }, n),
    "Ocosingo: catálogo de SICAR incompleto en esa tienda, no se puede comparar · calculado 0");
});

test("sugerencia por artículo con varias facturas: se avisa que no se suma", () => {
  assert.equal(textoPorArticulo(1), null);
  assert.equal(textoPorArticulo(3),
    "Sugerencia por artículo: cuenta las 3 facturas en aviso de esta clave. Es la misma en cada una; no la sumes.");
});

test("todo enviado a tienda sin agente: pendiente de comprobación aunque no sea agotada", () => {
  const gris = { comprado: "100000", vendido: "0", queda: "0", transito: "0", sin_agente: "100000", por_aclarar: "0" };
  assert.equal(siguienteAccion(factura({ etapa: null, aviso: null, agotada: false, piezas: gris })), "Pendiente de comprobación");
  const aclarar = { comprado: "100000", vendido: "90000", queda: "0", transito: "0", sin_agente: "0", por_aclarar: "10000" };
  assert.equal(siguienteAccion(factura({ etapa: null, aviso: null, agotada: false, piezas: aclarar })), "Movimientos por aclarar");
});

// ---- Con IVA y sin IVA (decisión de Victor 2026-11-11) ----
const conIva = (extra = {}) => factura({
  dinero_con_iva: { vendido: "3222", queda: "5155", transito: "1611", gris: "1289", por_aclarar: "323" },
  total_sin_iva_centavos: "10000", total_con_iva_centavos: "11600", ...extra,
});

test("total de la factura: con IVA y sin IVA, dicho con todas sus letras", () => {
  assert.equal(totalFacturaTexto(conIva({ total_con_iva_centavos: "8349225", total_sin_iva_centavos: "7197610" })),
    "Total factura: $83,492.25 con IVA · $71,976.10 sin IVA");
  assert.equal(totalFacturaTexto(conIva({ dinero_con_iva: null, total_con_iva_centavos: null })), "Total factura: $100.00 sin IVA");
  assert.equal(totalFacturaTexto(conIva({ dinero: null, dinero_con_iva: null, total_con_iva_centavos: null, total_sin_iva_centavos: null })),
    "Total factura: No calculable");
});

test("tramos: con IVA de principal, sin IVA de secundario; los porcentajes no cambian", () => {
  const t = tramosDeFactura(conIva());
  const queda = t.find((x) => x.id === "queda");
  assert.equal(queda.principal, "$51.55");
  assert.equal(queda.secundario, "$44.44 sin IVA");
  assert.equal(t.find((x) => x.id === "vendido").porcentaje, 27.8);
  assert.deepEqual(t.map((x) => x.porcentaje), tramosDeFactura(factura()).map((x) => x.porcentaje));
});

test("tramos sin dato con IVA: solo sin IVA y lo dice", () => {
  const queda = tramosDeFactura(factura()).find((x) => x.id === "queda");
  assert.equal(queda.principal, "$44.44 sin IVA");
  assert.equal(queda.secundario, null);
  const nada = tramosDeFactura(factura({ dinero: null }))[0];
  assert.equal(nada.principal, "No calculable");
  assert.equal(nada.secundario, null);
});

test("valor de un renglón: con IVA y sin IVA, o solo sin IVA", () => {
  assert.equal(valorConIvaTexto("31035", "36000"), "$360.00 con IVA · $310.35 sin IVA");
  assert.equal(valorConIvaTexto("31035", null), "$310.35 sin IVA");
  assert.equal(valorConIvaTexto("31035", undefined), "$310.35 sin IVA");
});

test("nota del rescate: fecha local del inicio y nombres de las tiendas reconstruidas, sin repetir", () => {
  const nombres = { 1: "Ocosingo", 2: "Yajalón" };
  const desde = "2026-11-06T00:05:08.000";
  const renglones = [{ rescate: { desde, tiendas: [2] } }, { rescate: null }, { rescate: { desde, tiendas: [1, 2, 4] } }];
  assert.equal(notaRescate(renglones, nombres),
    "Reconstruido desde el 2026-11-06 con las ventas de SICAR en: Ocosingo, Yajalón, Tienda 4");
  assert.equal(notaRescate([{ rescate: null }, {}], nombres), null);
  assert.equal(notaRescate([], nombres), null);
});

test("nota del rescate: solo nombra las tiendas rescatadas donde esta factura tiene piezas", () => {
  const nombres = { 1: "Ocosingo", 2: "Yajalón", 3: "San Cristóbal" };
  const rescate = { desde: "2026-11-06T00:05:08.000", tiendas: [1, 2, 3] };
  const renglones = [
    { rescate, por_sucursal: { 2: { queda: "10000", vendido: "0" }, 1: { queda: "0", vendido: "0" }, 6: { queda: "5", vendido: "0" } } },
    { rescate, por_sucursal: { 3: { queda: "0", vendido: "20000" } } },
  ];
  assert.equal(notaRescate(renglones, nombres), "Reconstruido desde el 2026-11-06 con las ventas de SICAR en: Yajalón, San Cristóbal");
  const sinPiezas = [{ rescate, por_sucursal: { 6: { queda: "10000", vendido: "0" } } }];
  assert.equal(notaRescate(sinPiezas, nombres), null, "la factura no fue a ninguna tienda rescatada");
});
