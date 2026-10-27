import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVISO_CAMINO_FORZADO, avisosDelCamino, cifraDeMeta, cuerpoDescartar, cuerpoProponer, cuerpoValidar, estadoInicialPlan, mesesPlanificables,
  nombreCamino, opcionesParaPlan, opcionesTacticas, avisoDescuento, textoRango, puedeProponer, resumenDecision, textoAjuste, textoAprobado, textoDescartada, textoRechazoTactica,
} from "./planMes.js";

const propuesta = {
  camino: "calidad_dato", camino_ia: "conversion", camino_forzado: true, por_que_camino: "Solo 42.0 % de ventas con cliente",
  tacticas: [
    { id: 4, nombre: "Pedir el teléfono", por_que: "Sube el dato" },
    { id: 9, nombre: "Rebaja de temporada", por_que: "x", rechazada: true, motivo_rechazo: "No se propone descuento para un problema de conversión" },
  ],
  metas: [
    { numero: "pct_con_cliente", valor: 48.3, valor_entero: 483, base: 46, rango: { minimo: 48.3, maximo: 52.9 }, responsable_rol: "vendedores",
      por_que: "p", ajustada: true, propuesta_ia: 60 },
    { numero: "ticket_promedio_centavos", valor: 900, valor_entero: 90000, base: 850, rango: { minimo: 892.5, maximo: 977.5 },
      responsable_rol: "gerente", por_que: "q", fuera_de_camino: true },
  ],
  descartadas: [{ numero: "clientes_nuevos", motivo: "sin dato para fijar una base" }],
};

test("estadoInicialPlan: acepta todo, pero una tactica rechazada por el servidor arranca rechazada", () => {
  const e = estadoInicialPlan(propuesta);
  assert.deepEqual(e.camino, { decision: "aceptar", camino: "calidad_dato" });
  assert.equal(e.tacticas[4].decision, "aceptar");
  assert.equal(e.tacticas[9].decision, "rechazar");
  assert.equal(e.metas.pct_con_cliente.decision, "aceptar");
});

test("cuerpoValidar: todo aceptado arma el cuerpo que espera el servidor", () => {
  const e = estadoInicialPlan(propuesta);
  const r = cuerpoValidar(propuesta, e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cuerpo, {
    camino: { decision: "aceptar" },
    tacticas: [{ id: 4, decision: "aceptar" }, { id: 9, decision: "rechazar" }],
    metas: [{ numero: "pct_con_cliente", decision: "aceptar" }, { numero: "ticket_promedio_centavos", decision: "aceptar" }],
  });
});

test("cuerpoValidar: cambiar camino, tactica y cifra (legible, con coma o signos)", () => {
  const e = estadoInicialPlan(propuesta);
  e.camino = { decision: "cambiar", camino: "prospectos" };
  e.tacticas[4] = { decision: "cambiar", nuevo_id: "12" };
  e.metas.pct_con_cliente = { decision: "cambiar", valor: "50,5 %" };
  e.metas.ticket_promedio_centavos = { decision: "rechazar", valor: "" };
  const r = cuerpoValidar(propuesta, e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cuerpo.camino, { decision: "cambiar", camino: "prospectos" });
  assert.deepEqual(r.cuerpo.tacticas[0], { id: 4, decision: "cambiar", nuevo_id: 12 });
  assert.deepEqual(r.cuerpo.metas[0], { numero: "pct_con_cliente", decision: "cambiar", valor: 50.5 });
  assert.deepEqual(r.cuerpo.metas[1], { numero: "ticket_promedio_centavos", decision: "rechazar" });
});

test("cuerpoValidar: pide minimo una tactica y una meta aceptadas", () => {
  const sinTacticas = estadoInicialPlan(propuesta);
  sinTacticas.tacticas[4].decision = "rechazar";
  assert.match(cuerpoValidar(propuesta, sinTacticas).error, /al menos una táctica/);
  const sinMetas = estadoInicialPlan(propuesta);
  sinMetas.metas.pct_con_cliente.decision = "rechazar";
  sinMetas.metas.ticket_promedio_centavos.decision = "rechazar";
  assert.match(cuerpoValidar(propuesta, sinMetas).error, /al menos una meta/);
});

test("cuerpoValidar: rechaza cifra fuera del rango, mal escrita, tactica sin elegir o repetida", () => {
  const alta = estadoInicialPlan(propuesta);
  alta.metas.pct_con_cliente = { decision: "cambiar", valor: "60" };
  assert.match(cuerpoValidar(propuesta, alta).error, /entre 48\.3 % y 52\.9 %/);
  const baja = estadoInicialPlan(propuesta);
  baja.metas.ticket_promedio_centavos = { decision: "cambiar", valor: "800" };
  assert.match(cuerpoValidar(propuesta, baja).error, /entre \$892\.50 y \$977\.50/);
  const texto = estadoInicialPlan(propuesta);
  texto.metas.pct_con_cliente = { decision: "cambiar", valor: "mucho" };
  assert.match(cuerpoValidar(propuesta, texto).error, /Escribe un número/);
  const sinId = estadoInicialPlan(propuesta);
  sinId.tacticas[4] = { decision: "cambiar", nuevo_id: "" };
  assert.match(cuerpoValidar(propuesta, sinId).error, /Elige la táctica/);
  const repetida = estadoInicialPlan(propuesta);
  repetida.tacticas[9] = { decision: "cambiar", nuevo_id: "4" };
  assert.match(cuerpoValidar(propuesta, repetida).error, /repetir/);
});

test("cuerpoValidar: camino cambiado sin elegir uno no pasa", () => {
  const e = estadoInicialPlan(propuesta);
  e.camino = { decision: "cambiar", camino: "" };
  assert.match(cuerpoValidar(propuesta, e).error, /camino/);
});

test("avisosDelCamino: forzado por el servidor y, si el gerente lo cambia, que se aparto", () => {
  const e = estadoInicialPlan(propuesta);
  assert.deepEqual(avisosDelCamino(propuesta, e.camino), [AVISO_CAMINO_FORZADO]);
  assert.equal(AVISO_CAMINO_FORZADO, "Sin dato de clientes o menos del 50 %: el camino es calidad del dato");
  const cambiado = avisosDelCamino(propuesta, { decision: "cambiar", camino: "prospectos" });
  assert.equal(cambiado.length, 2);
  assert.match(cambiado[1], /Te apartaste del camino del sistema: Calidad del dato\. Elegiste: Prospectos/);
  const libre = { ...propuesta, camino: "conversion", camino_forzado: false };
  assert.deepEqual(avisosDelCamino(libre, { decision: "aceptar", camino: "conversion" }), []);
  assert.equal(avisosDelCamino(libre, { decision: "cambiar", camino: "venta_promedio" }).length, 1);
  assert.deepEqual(avisosDelCamino(propuesta, { decision: "cambiar", camino: "calidad_dato" }), [AVISO_CAMINO_FORZADO]);
});

test("textoAjuste: lo que propuso la IA contra lo que quedo", () => {
  assert.equal(textoAjuste(propuesta.metas[0]), "Ajustada por el servidor: la IA propuso 60.0 % y quedó en 48.3 %");
  assert.equal(textoAjuste(propuesta.metas[1]), "");
  assert.equal(textoAjuste({ ...propuesta.metas[0], propuesta_ia: 45.25 }), "Ajustada por el servidor: la IA propuso 45.25 y quedó en 48.3 %");
});

test("cifraDeMeta y nombreCamino", () => {
  assert.equal(cifraDeMeta(propuesta.metas[1]), "$900.00");
  assert.equal(cifraDeMeta({ numero: "clientes_nuevos", valor: 12 }), "12 clientes por semana");
  assert.equal(nombreCamino("compras_por_cliente"), "Compras por cliente");
  assert.equal(nombreCamino("zzz"), "zzz");
});

test("textoRango: el rango permitido con su unidad", () => {
  assert.equal(textoRango(propuesta.metas[0]), "48.3 % a 52.9 %");
  assert.equal(textoRango(propuesta.metas[1]), "$892.50 a $977.50");
});

test("motivos: tactica rechazada y meta descartada", () => {
  assert.equal(textoRechazoTactica(propuesta.tacticas[1]), "Rechazada por el servidor: No se propone descuento para un problema de conversión");
  assert.equal(textoRechazoTactica(propuesta.tacticas[0]), "");
  assert.equal(textoDescartada(propuesta.descartadas[0]), "Clientes nuevos: sin dato para fijar una base");
});

test("resumenDecision", () => {
  assert.equal(resumenDecision({ decision: "aceptar" }), "Aceptada");
  assert.equal(resumenDecision({ decision: "rechazar" }), "Rechazada");
  assert.equal(resumenDecision({ decision: "cambiar" }), "Cambiada");
});

test("opcionesTacticas: solo activas y sin fase 2 o 3", () => {
  const manual = [
    { id: 1, nombre: "A", activa: true, como_se_mide: "tablero" }, { id: 2, nombre: "B", activa: false, como_se_mide: "tablero" },
    { id: 3, nombre: "C", activa: true, como_se_mide: "fase_2" }, { id: 4, nombre: "D", activa: true, como_se_mide: "fase_3" },
  ];
  assert.deepEqual(opcionesTacticas(manual).map((t) => t.id), [1]);
  assert.deepEqual(opcionesTacticas(null), []);
});

test("cuerpoProponer y cuerpoDescartar", () => {
  assert.deepEqual(cuerpoProponer("3", "2026-10"), { sucursal_id: 3, mes: "2026-10" });
  assert.deepEqual(cuerpoDescartar("  ya no aplica "), { motivo: "ya no aplica" });
});

test("mesesPlanificables: el actual y el siguiente, con cambio de anio", () => {
  assert.deepEqual(mesesPlanificables("2026-10-26").map((m) => m.mes), ["2026-10", "2026-11"]);
  assert.deepEqual(mesesPlanificables("2026-12-03").map((m) => m.mes), ["2026-12", "2027-01"]);
  assert.equal(mesesPlanificables("2026-10-26")[0].etiqueta, "octubre 2026");
});

test("puedeProponer: permiso del planeador", () => {
  assert.equal(puedeProponer(["administrar_metas_personalizadas"]), true);
  assert.equal(puedeProponer(["ver_cinco_caminos", "administrar_manual_tacticas"]), false);
});

test("textoAprobado: fecha y quien", () => {
  assert.equal(textoAprobado({ aprobado_en: "2026-10-26T18:00:00.000Z", aprobado_por_nombre: "Ana" }), "Aprobado por Ana el 26/10/2026");
  assert.equal(textoAprobado({ aprobado_en: "2026-10-26T18:00:00.000Z", aprobado_por_id: 7 }), "Aprobado por el usuario n.º 7 el 26/10/2026");
  assert.equal(textoAprobado({ aprobado_en: "2026-10-26T18:00:00.000Z" }), "Aprobado el 26/10/2026");
});

test("opcionesParaPlan: solo el manual filtrado (activas, sin fase 2 ni 3); ignora cualquier catalogo de la propuesta", () => {
  const manual = [
    { id: 1, nombre: "A", activa: true, como_se_mide: "tablero" },
    { id: 3, nombre: "C", activa: true, como_se_mide: "fase_2" },
    { id: 4, nombre: "D", activa: false, como_se_mide: "tablero" },
  ];
  assert.deepEqual(opcionesParaPlan({}, manual).map((t) => t.id), [1]);
  assert.deepEqual(opcionesParaPlan({ catalogo_tacticas: [{ id: 8, nombre: "Z" }] }, manual).map((t) => t.id), [1]);
  assert.deepEqual(opcionesParaPlan(null, manual).map((t) => t.id), [1]);
});

test("avisoDescuento: camino final conversion y una tactica aceptada que habla de descuento", () => {
  const p = { camino: "prospectos", metas: [], tacticas: [{ id: 1, habla_de_descuento: true }, { id: 2, habla_de_descuento: false }] };
  const e = estadoInicialPlan(p);
  assert.equal(avisoDescuento(p, e), "");
  e.camino = { decision: "cambiar", camino: "conversion" };
  assert.match(avisoDescuento(p, e), /conversión.*descuento/);
  e.tacticas[2].decision = "rechazar";
  assert.match(avisoDescuento(p, e), /descuento/);
  const sin = { ...p, camino: "conversion", metas: [], tacticas: [{ id: 1, habla_de_descuento: true }] };
  const f = estadoInicialPlan(sin);
  f.tacticas[1].decision = "rechazar";
  assert.equal(avisoDescuento(sin, f), "");
  f.tacticas[1] = { decision: "cambiar", nuevo_id: "5" };
  assert.equal(avisoDescuento(sin, f), "");
});

test("textoAprobado: sin fecha no truena", () => {
  assert.equal(textoAprobado({ aprobado_por_nombre: "Ana" }), "Aprobado por Ana");
});
