import { test } from "node:test";
import assert from "node:assert/strict";
import {
  semaforo, flecha, formatoNumero, tarjetasDelTablero, ultimaSemanaCompleta, opcionesSemanas, filasCategorias, reglasDesdeFilas,
} from "./cincoCaminos.js";

test("semaforo: verde si alcanza la base, ámbar hasta -5%, rojo peor, null sin base", () => {
  assert.equal(semaforo(50, 50), "verde");
  assert.equal(semaforo(60, 50), "verde");
  assert.equal(semaforo(47.5, 50), "ambar");
  assert.equal(semaforo(47.4, 50), "rojo");
  assert.equal(semaforo(10, null), null);
  assert.equal(semaforo(null, 10), null);
  assert.equal(semaforo(0, 0), "verde");
});

test("flecha compara contra la semana anterior", () => {
  assert.equal(flecha(5, 4), "sube");
  assert.equal(flecha(3, 4), "baja");
  assert.equal(flecha(4, 4), "igual");
  assert.equal(flecha(4, null), null);
  assert.equal(flecha(null, 4), null);
});

test("formatoNumero: porcentaje con un decimal, pesos desde centavos y textos, nunca 0 por falta de dato", () => {
  assert.equal(formatoNumero(45.25, "pct"), "45.3%");
  assert.equal(formatoNumero(1234567, "pesos"), "$12,345.67");
  assert.equal(formatoNumero(5, "pesos"), "$0.05");
  assert.equal(formatoNumero(0, "pct"), "0.0%");
  assert.equal(formatoNumero(2.456, "decimal2"), "2.46");
  assert.equal(formatoNumero(null, "pct"), "sin dato");
  assert.equal(formatoNumero(undefined, "pesos"), "sin dato");
  assert.equal(formatoNumero("sin_configurar", "pct"), "sin configurar");
});

const radar = (conversion, no_confiable) => ({ conversion, conversion_detalle: { numerador: 1, denominador: 2 },
  registros_por_10_tickets: 3, no_confiable });
const semana = (sobre = {}) => ({ sin_dato: false, venta_centavos: 100000, ventas: 40, pct_con_cliente: 50, clientes_nuevos: 5,
  recompra_90: 20, ticket_promedio_centavos: 2500, articulos_por_ticket: 2, pct_instrumento_con_accesorio: 30,
  radar: radar(40, false), ...sobre });
const porClave = (tarjetas, clave) => tarjetas.find((t) => t.clave === clave);

test("tarjetas: base es 2025 y, sin ella, el promedio de 8 semanas", () => {
  const t = tarjetasDelTablero({ actual: semana({ pct_con_cliente: 40 }), anterior: semana({ pct_con_cliente: 30 }),
    mismo_2025: semana({ pct_con_cliente: 60 }), promedio_8: semana({ pct_con_cliente: 41 }) });
  const c = porClave(t.tarjetas, "pct_con_cliente");
  assert.equal(c.actual, "40.0%");
  assert.equal(c.flecha, "sube");
  assert.equal(c.semaforo, "rojo");
  assert.equal(c.base, "2025");
  const sin2025 = tarjetasDelTablero({ actual: semana({ pct_con_cliente: 40 }), anterior: semana(), mismo_2025: semana({ sin_dato: true }),
    promedio_8: semana({ pct_con_cliente: 41 }) });
  const d = porClave(sin2025.tarjetas, "pct_con_cliente");
  assert.equal(d.mismo_2025, "sin dato");
  assert.equal(d.base, "promedio de 8 semanas");
  assert.equal(d.semaforo, "ambar");
});

test("tarjetas: semana sin dato no se califica y sin configurar es texto", () => {
  const t = tarjetasDelTablero({ actual: semana({ sin_dato: true }), anterior: semana(), mismo_2025: semana(), promedio_8: semana() });
  assert.equal(porClave(t.tarjetas, "pct_con_cliente").actual, "sin dato");
  assert.equal(porClave(t.tarjetas, "pct_con_cliente").semaforo, null);
  const u = tarjetasDelTablero({ actual: semana({ pct_instrumento_con_accesorio: "sin_configurar" }), anterior: semana(),
    mismo_2025: semana(), promedio_8: semana() });
  const c = porClave(u.tarjetas, "pct_instrumento_con_accesorio");
  assert.equal(c.actual, "sin configurar");
  assert.equal(c.semaforo, null);
  assert.equal(c.flecha, null);
});

test("tarjetas: Radar no confiable o sin base se dice y su base es solo el promedio de 8", () => {
  const base = { anterior: semana(), mismo_2025: semana({ radar: radar(null, null) }), promedio_8: semana({ radar: radar(50, null) }) };
  const mala = porClave(tarjetasDelTablero({ ...base, actual: semana({ radar: radar(10, true) }) }).tarjetas, "conversion");
  assert.equal(mala.actual, "no confiable");
  assert.equal(mala.semaforo, null);
  const sinBase = porClave(tarjetasDelTablero({ ...base, actual: semana({ radar: radar(45, null) }) }).tarjetas, "conversion");
  assert.equal(sinBase.actual, "45.0%");
  assert.equal(sinBase.nota, "sin base");
  const buena = porClave(tarjetasDelTablero({ ...base, actual: semana({ radar: radar(48, false) }) }).tarjetas, "conversion");
  assert.equal(buena.base, "promedio de 8 semanas");
  assert.equal(buena.semaforo, "ambar");
  assert.equal(buena.mismo_2025, "sin dato");
});

test("tarjetas: contexto de venta de la semana contra 2025", () => {
  const t = tarjetasDelTablero({ actual: semana({ venta_centavos: 1234567 }), anterior: semana(), mismo_2025: semana({ venta_centavos: 1000000 }),
    promedio_8: semana() });
  assert.equal(t.venta.actual, "$12,345.67");
  assert.equal(t.venta.mismo_2025, "$10,000.00");
});

test("semanas: la última completa es la anterior a la de hoy y el selector lista lunes", () => {
  assert.equal(ultimaSemanaCompleta("2026-10-24"), "2026-10-12");
  assert.equal(ultimaSemanaCompleta("2026-10-26"), "2026-10-19");
  const o = opcionesSemanas("2026-10-24", 3);
  assert.deepEqual(o.map((x) => x.lunes), ["2026-10-12", "2026-10-05", "2026-09-28"]);
  assert.equal(o[0].etiqueta, "12 al 18 de octubre de 2026");
  assert.equal(opcionesSemanas("2026-11-03", 1)[0].etiqueta, "26 de octubre al 1 de noviembre de 2026");
});

test("categorias: filas por departamento y categoría con la regla vigente, y reglas solo de lo marcado", () => {
  const disponibles = [{ departamento: "CUERDAS", categoria: "GUITARRA", articulos: 3 }, { departamento: "CUERDAS", categoria: null, articulos: 1 }];
  const reglas = [{ departamento: "CUERDAS", categoria: "GUITARRA", tipo: "instrumento" }, { departamento: "VIEJO", categoria: null, tipo: "accesorio" }];
  const filas = filasCategorias(disponibles, reglas);
  const guitarra = filas.find((f) => f.departamento === "CUERDAS" && f.categoria === "GUITARRA");
  assert.equal(guitarra.tipo, "instrumento");
  assert.ok(filas.some((f) => f.departamento === "CUERDAS" && f.categoria === null && f.tipo === ""));
  assert.ok(filas.some((f) => f.departamento === "VIEJO" && f.tipo === "accesorio"));
  assert.deepEqual(reglasDesdeFilas(filas), [
    { departamento: "CUERDAS", categoria: "GUITARRA", tipo: "instrumento" }, { departamento: "VIEJO", categoria: null, tipo: "accesorio" }]);
});
