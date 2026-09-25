// Cuentas de las gráficas de progreso. Todo en centavos enteros y en días de calendario:
// el sistema no sabe qué días descansa cada quien.
const centavos = (n) => Math.round(Number(n || 0) * 100);

export function diasDelMes(mes) {
  const [anio, numero] = mes.split("-").map(Number);
  return new Date(Date.UTC(anio, numero, 0)).getUTCDate();
}

// Días que quedan contando hoy. Mes ya terminado: 0. Mes que no empieza: el mes completo.
export function diasRestantes(mes, hoy) {
  const mesDeHoy = hoy.slice(0, 7);
  if (mes < mesDeHoy) return 0;
  if (mes > mesDeHoy) return diasDelMes(mes);
  return diasDelMes(mes) - Number(hoy.slice(8, 10)) + 1;
}

// Un punto por día del mes: lo acumulado (null en días que aún no llegan) y la línea del ritmo,
// una recta de 0 a la meta el último día.
export function serieConRitmo(serie, meta, mes, hoy) {
  const total = diasDelMes(mes);
  const porFecha = new Map(serie.map((p) => [p.fecha, centavos(p.monto)]));
  let acumulado = 0;
  return Array.from({ length: total }, (_, i) => {
    const dia = i + 1;
    const fecha = `${mes}-${String(dia).padStart(2, "0")}`;
    acumulado += porFecha.get(fecha) || 0;
    return {
      dia, fecha,
      acumulado: fecha > hoy ? null : acumulado / 100,
      ritmo: Math.round(centavos(meta) * dia / total) / 100,
    };
  });
}

// Cuánto falta y cuánto toca por día para llegar; se redondea hacia arriba para que sí alcance.
export function faltantePorDia(meta, capturado, dias) {
  if (!(Number(meta) > 0) || !(dias > 0)) return null;
  const faltante = centavos(meta) - centavos(capturado);
  if (faltante <= 0) return null;
  return { faltante: faltante / 100, porDia: Math.ceil(faltante / dias) / 100 };
}

export function estadoMeta(meta, capturado) {
  if (!(Number(meta) > 0)) return "sin-meta";
  return centavos(capturado) >= centavos(meta) ? "lograda" : "en-camino";
}
