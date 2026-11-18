function indicesTemporada(ventasPorClave, hoyMes) {
  const limite = Number(hoyMes.slice(0, 4));
  const cocientes = [], anios = new Set(), claves = new Set();
  for (const [clave, meses] of ventasPorClave) {
    const candidatos = new Set([...meses.keys()].map(m => Number(m.slice(0, 4))).filter(a => a < limite));
    for (const anio of candidatos) {
      const etiquetas = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);
      if (!etiquetas.every(m => meses.has(m))) continue;
      anios.add(anio);
      const ventas = etiquetas.map(m => meses.get(m));
      const promedio = ventas.reduce((a, b) => a + b, 0) / 12;
      if (promedio <= 0) continue;
      claves.add(clave);
      cocientes.push(ventas.map(v => v / promedio));
    }
  }
  const motivo = anios.size < 2 ? 'menos_de_dos_anios' : claves.size < 5 ? 'menos_de_cinco_claves' : null;
  if (motivo) return { indices: Array(12).fill(1), anios: anios.size, claves: claves.size, motivo };
  const promedios = Array.from({ length: 12 }, (_, i) => cocientes.reduce((suma, c) => suma + c[i], 0) / cocientes.length);
  const media = promedios.reduce((a, b) => a + b, 0) / 12;
  const indices = promedios.map(p => Math.max(0.5, Math.min(1.5, p / media)));
  return { indices, anios: anios.size, claves: claves.size, motivo: null };
}

function factorPara(indices, mes) {
  return (indices[mes - 1] + indices[mes % 12]) / 2;
}
module.exports = { indicesTemporada, factorPara };
