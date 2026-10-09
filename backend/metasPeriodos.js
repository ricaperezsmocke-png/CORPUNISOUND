// Periodos de las metas personalizadas (decisión de Victor 2026-10-08): semana de lunes a domingo,
// mes y trimestre de calendario. Todo en texto AAAA-MM-DD; la aritmética en UTC para no depender
// de la zona del servidor (Render corre en UTC; las tiendas en hora de Chiapas).
const { fechaValida } = require("./objetivosFechas");

const PERIODOS = ["semanal", "mensual", "trimestral"];
const DIA_MS = 24 * 60 * 60 * 1000;
const aUTC = (fecha) => { const [a, m, d] = fecha.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);

function validarPeriodo(periodo, inicio) {
  if (!PERIODOS.includes(periodo)) throw new Error("El periodo debe ser semanal, mensual o trimestral");
  if (!fechaValida(inicio)) throw new Error("El inicio debe ser una fecha AAAA-MM-DD válida");
  const dia = aUTC(inicio);
  if (periodo === "semanal" && dia.getUTCDay() !== 1) throw new Error("Una meta semanal empieza en lunes");
  if (periodo === "mensual" && dia.getUTCDate() !== 1) throw new Error("Una meta mensual empieza el día 1");
  if (periodo === "trimestral" && (dia.getUTCDate() !== 1 || dia.getUTCMonth() % 3 !== 0)) {
    throw new Error("Una meta trimestral empieza el 1 de enero, abril, julio u octubre");
  }
}

function finDePeriodo(periodo, inicio) {
  validarPeriodo(periodo, inicio);
  const dia = aUTC(inicio);
  if (periodo === "semanal") return aTexto(new Date(dia.getTime() + 6 * DIA_MS));
  const meses = periodo === "mensual" ? 1 : 3;
  return aTexto(new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth() + meses, 0)));
}

function inicioDePeriodo(periodo, fecha) {
  if (!PERIODOS.includes(periodo)) throw new Error("El periodo debe ser semanal, mensual o trimestral");
  if (!fechaValida(fecha)) throw new Error("La fecha debe ser AAAA-MM-DD válida");
  const dia = aUTC(fecha);
  if (periodo === "semanal") return aTexto(new Date(dia.getTime() - ((dia.getUTCDay() + 6) % 7) * DIA_MS));
  const mes = periodo === "mensual" ? dia.getUTCMonth() : dia.getUTCMonth() - (dia.getUTCMonth() % 3);
  return aTexto(new Date(Date.UTC(dia.getUTCFullYear(), mes, 1)));
}

function ritmoEsperado(periodo, inicio, hoy) {
  const fin = finDePeriodo(periodo, inicio);
  if (hoy < inicio) return 0;
  if (hoy >= fin) return 1;
  const total = (aUTC(fin) - aUTC(inicio)) / DIA_MS + 1;
  const transcurridos = (aUTC(hoy) - aUTC(inicio)) / DIA_MS + 1;
  return transcurridos / total;
}

module.exports = { PERIODOS, validarPeriodo, finDePeriodo, inicioDePeriodo, ritmoEsperado };
