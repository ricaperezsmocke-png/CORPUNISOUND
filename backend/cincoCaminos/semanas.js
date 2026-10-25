/**
 * Semanas del tablero de los cinco caminos: lunes a domingo, en días de la tienda (America/Mexico_City).
 *
 * Todo trabaja con días sueltos 'YYYY-MM-DD' que YA son días de la tienda, así que la aritmética se hace en UTC
 * a propósito: sumar días a un día suelto no depende de la zona horaria y nunca corre la fecha.
 */
const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function errorFecha(mensaje) {
  const e = new Error(mensaje);
  e.status = 400;
  return e;
}

function aFecha(dia) {
  const m = typeof dia === 'string' ? DIA.exec(dia) : null;
  if (!m) throw errorFecha('La fecha debe ser AAAA-MM-DD.');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw errorFecha('La fecha no existe.');
  }
  return d;
}

function sumarDias(dia, dias) {
  const d = aFecha(dia);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function semanaDe(fecha) {
  const d = aFecha(fecha);
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const lunes = sumarDias(fecha, -desdeLunes);
  return { lunes, domingo: sumarDias(lunes, 6) };
}

function exigirLunes(lunes) {
  if (semanaDe(lunes).lunes !== lunes) throw errorFecha('La semana se indica con su lunes.');
  return lunes;
}

const semanaAnterior = lunes => sumarDias(exigirLunes(lunes), -7);
// 364 días = 52 semanas exactas: cae en lunes y compara la misma semana del año pasado.
const mismaSemanaAnio = lunes => sumarDias(exigirLunes(lunes), -364);

/** Los lunes de las `n` semanas que terminan en la de `lunes` (incluida), de la más reciente a la más vieja. */
function ultimasSemanas(lunes, n) {
  exigirLunes(lunes);
  return Array.from({ length: Math.max(0, n) }, (_, i) => sumarDias(lunes, -7 * i));
}

/** Lunes de la última semana ya cerrada: la de `hoy` sigue abierta hasta que termina su domingo. */
const ultimaSemanaCompleta = hoy => sumarDias(semanaDe(hoy).lunes, -7);

module.exports = { semanaDe, semanaAnterior, mismaSemanaAnio, ultimasSemanas, ultimaSemanaCompleta, sumarDias, exigirLunes };
