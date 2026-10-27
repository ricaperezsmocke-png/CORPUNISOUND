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

// ---- P5, Task 5: evidencia al aprobar y resultado del mes ----
import {
  etiquetaResultado, mesTerminado, mesesVisibles, necesitaEvidencia, textoCalificado, textoEvidencia, textoSeCalifica, textoSeHizo,
} from "./planMes.js";

const manualP5 = [{ id: 4, activa: true, como_se_mide: "evidencia" }, { id: 9, activa: true, como_se_mide: "sistema" },
  { id: 12, activa: true, como_se_mide: "sistema_y_evidencia" }];
const soloAceptar = (e) => ({ ...e, tacticas: { ...e.tacticas, 9: { ...e.tacticas[9], decision: "aceptar" } } });
const sinRechazo = { ...propuesta, tacticas: propuesta.tacticas.map((t) => ({ ...t, rechazada: undefined })) };

test("necesitaEvidencia: solo las tacticas por evidencia o sistema y evidencia", () => {
  assert.equal(necesitaEvidencia(4, manualP5), true);
  assert.equal(necesitaEvidencia(12, manualP5), true);
  assert.equal(necesitaEvidencia(9, manualP5), false);
  assert.equal(necesitaEvidencia(4, null), false);
});

test("estadoInicialPlan: cada tactica arranca con foto y 1 vez", () => {
  const e = estadoInicialPlan(propuesta);
  assert.equal(e.tacticas[4].prueba, "foto");
  assert.equal(e.tacticas[4].veces, "1");
});

test("cuerpoValidar: con el manual, la tactica por evidencia lleva prueba y veces; la de sistema no", () => {
  const e = soloAceptar(estadoInicialPlan(sinRechazo));
  e.tacticas[4] = { ...e.tacticas[4], prueba: "liga", veces: "4" };
  const r = cuerpoValidar(sinRechazo, e, manualP5);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cuerpo.tacticas, [{ id: 4, decision: "aceptar", prueba: "liga", veces: 4 }, { id: 9, decision: "aceptar" }]);
});

test("cuerpoValidar: la tactica elegida al cambiar usa su propia forma de medirse", () => {
  const e = soloAceptar(estadoInicialPlan(sinRechazo));
  e.tacticas[9] = { ...e.tacticas[9], decision: "cambiar", nuevo_id: "12", veces: "2" };
  const r = cuerpoValidar(sinRechazo, e, manualP5);
  assert.deepEqual(r.cuerpo.tacticas[1], { id: 9, decision: "cambiar", nuevo_id: 12, prueba: "foto", veces: 2 });
});

test("cuerpoValidar: veces fuera de 1 a 31 o con decimales no se envia", () => {
  for (const veces of ["0", "32", "1.5", "", "dos"]) {
    const e = soloAceptar(estadoInicialPlan(sinRechazo));
    e.tacticas[4] = { ...e.tacticas[4], veces };
    const r = cuerpoValidar(sinRechazo, e, manualP5);
    assert.equal(r.ok, false, veces);
    assert.match(r.error, /1 a 31/);
  }
  const e = soloAceptar(estadoInicialPlan(sinRechazo));
  e.tacticas[4] = { ...e.tacticas[4], prueba: "video" };
  assert.equal(cuerpoValidar(sinRechazo, e, manualP5).ok, false);
});

test("textoEvidencia: avance de la meta de evidencia", () => {
  assert.equal(textoEvidencia({ hechas: 1, requeridas: 3 }), "Evidencia: 1 de 3");
  assert.equal(textoEvidencia({ hechas: 0, requeridas: 1, prueba: "liga" }), "Evidencia: 0 de 1");
});

test("etiquetaResultado: probada verde, no funciono rojo, no se hizo y sin dato gris", () => {
  assert.equal(etiquetaResultado("probada").texto, "Probada");
  assert.match(etiquetaResultado("probada").clase, /emerald/);
  assert.equal(etiquetaResultado("no_funciono").texto, "No funcionó");
  assert.match(etiquetaResultado("no_funciono").clase, /red/);
  assert.equal(etiquetaResultado("no_se_hizo").texto, "No se hizo");
  assert.match(etiquetaResultado("no_se_hizo").clase, /slate/);
  assert.equal(etiquetaResultado("sin_dato").texto, "Sin dato");
  assert.match(etiquetaResultado("sin_dato").clase, /slate/);
  assert.equal(etiquetaResultado("otra").texto, "Sin dato");
});

test("textoSeHizo: no se hizo es No; lo demas medible es Si", () => {
  assert.equal(textoSeHizo({ resultado: "no_se_hizo", como_se_mide: "evidencia" }), "No");
  assert.equal(textoSeHizo({ resultado: "probada", como_se_mide: "sistema" }), "Sí");
  assert.equal(textoSeHizo({ resultado: "sin_dato", como_se_mide: "sistema_y_evidencia" }), "Sí");
  assert.equal(textoSeHizo({ resultado: "sin_dato", como_se_mide: "fase_3" }), "Sin dato");
});

test("textos del cierre: calificado y cuando se califica, en dias de la tienda", () => {
  assert.equal(textoCalificado({ cerrado_en: "2026-10-08T15:00:00.000Z" }), "Calificado por el sistema el 08/10/2026. No se edita a mano.");
  assert.equal(textoCalificado({ cerrado_en: "2026-10-09T03:00:00.000Z" }), "Calificado por el sistema el 08/10/2026. No se edita a mano.");
  assert.equal(textoSeCalifica("2026-11-05"), "Se califica el 05/11/2026");
});

test("mesTerminado y mesesVisibles: se pueden ver los 3 meses anteriores; planear, solo el actual y el siguiente", () => {
  assert.equal(mesTerminado("2026-10", "2026-11-02"), true);
  assert.equal(mesTerminado("2026-10", "2026-10-31"), false);
  const meses = mesesVisibles("2026-01-15");
  assert.deepEqual(meses.map((m) => m.mes), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(meses.map((m) => m.planificable), [false, false, false, true, true]);
  assert.equal(meses[2].etiqueta, "diciembre 2025");
});

// ---- Revision H8: el avance de evidencia se ve hasta que exista el cierre, tambien en los dias de gracia ----
import { avanceVisible } from "./planMes.js";

test("avanceVisible: con el mes terminado y sin cierre se sigue viendo; con cierre ya no", () => {
  assert.equal(avanceVisible({ mes: "2026-10" }), true);
  assert.equal(avanceVisible({ mes: "2026-10", cierre: null }), true);
  assert.equal(avanceVisible({ mes: "2026-10", cierre: { id: 1, tacticas: [] } }), false);
});
