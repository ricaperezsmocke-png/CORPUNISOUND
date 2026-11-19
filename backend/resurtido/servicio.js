const { fechaLocal, momentoLocal } = require('../fechas');
const { TIENDAS, MARCAS, leerConfig } = require('./config');
const { clavesDeMarca, ventasDiarias, existenciaActual, ventasMensualesMarca } = require('./lector');
const { tomarFoto, reconstruir, diasEnCero } = require('./existenciaDiaria');
const { indicesTemporada } = require('./temporada');
const { calcularMinMax } = require('./calculo');
const ciclos = new WeakMap();
const DIA = 86400000;

function completarMeses(ventas, hoyMes) {
  return new Map([...ventas].map(([clave, meses]) => {
    const completos = new Map(meses), primero = [...meses.keys()].sort()[0];
    if (primero) {
      let anio = Number(primero.slice(0, 4)), mes = Number(primero.slice(5));
      for (;;) {
        const etiqueta = `${anio}-${String(mes).padStart(2, '0')}`;
        if (etiqueta >= hoyMes) break;
        if (!completos.has(etiqueta)) completos.set(etiqueta, 0);
        if (++mes === 13) { mes = 1; anio++; }
      }
    }
    return [clave, completos];
  }));
}

function recalcular(sqlite, ahora = new Date().toISOString()) {
  const inicio = Date.now(), hoy = fechaLocal(ahora), config = leerConfig(sqlite);
  const fin = Date.parse(`${hoy}T00:00:00Z`) - DIA;
  const hasta = new Date(fin).toISOString().slice(0, 10);
  const desde = new Date(fin - (config.dias_historia - 1) * DIA).toISOString().slice(0, 10);
  const temporadas = new Map(MARCAS.map(marca => [marca,
    indicesTemporada(completarMeses(ventasMensualesMarca(sqlite, marca, TIENDAS), hoy.slice(0, 7)), hoy.slice(0, 7)).indices]));
  const guardar = sqlite.prepare(`INSERT OR REPLACE INTO resurtido_minmax
    (sucursal_id,clave,marca,minimo,maximo,venta_diaria_diezmilesimas,dias_validos,dias_en_cero,lista,calidad,calculado_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const calidad = sqlite.prepare(`SELECT COUNT(*) n, SUM(origen='foto') observadas FROM resurtido_existencia_diaria
    WHERE sucursal_id=? AND clave=? AND dia BETWEEN ? AND ?`);
  const tiendas = [];
  for (const suc of TIENDAS) {
    sqlite.prepare(`DELETE FROM resurtido_minmax WHERE sucursal_id=? AND NOT EXISTS (
      SELECT 1 FROM sicar_articulos a JOIN sicar_existencias e ON e.sucursal_id=a.sucursal_id AND e.art_id=a.art_id
      WHERE a.sucursal_id=resurtido_minmax.sucursal_id AND a.clave=resurtido_minmax.clave
    )`).run(suc);
    const { actualizado } = existenciaActual(sqlite, suc);
    const atrasada = !actualizado || !Number.isFinite(Date.parse(actualizado))
      || Date.parse(ahora) - Date.parse(actualizado) > config.dias_datos_atrasados * DIA;
    if (atrasada) { tiendas.push({ sucursal_id: suc, claves: 0, atrasada: true }); continue; }
    const resultado = sqlite.transaction(() => {
      const catalogo = clavesDeMarca(sqlite, suc), ventas = ventasDiarias(sqlite, suc, desde);
      tomarFoto(sqlite, hoy, ahora, [suc]);
      reconstruir(sqlite, suc, desde, hasta);
      for (const [clave, articulo] of catalogo) {
        const r = calcularMinMax({ ventasPorDia: ventas.get(clave) || new Map(), diasEnCero: diasEnCero(sqlite, suc, clave, desde, hasta),
          desde, hasta, indices: temporadas.get(articulo.marca), mesCalculo: Number(hoy.slice(5, 7)), config });
        const observadas = calidad.get(suc, clave, desde, hasta).observadas;
        guardar.run(suc, clave, articulo.marca, r.minimo, r.maximo, r.venta_diaria, r.dias_validos, r.dias_en_cero,
          r.lista, observadas === config.dias_historia ? 'observada' : 'aproximada', ahora);
      }
      return { sucursal_id: suc, claves: catalogo.size, atrasada: false };
    })();
    tiendas.push(resultado);
  }
  return { tiendas, ms: Date.now() - inicio };
}

function demoraHastaLasDos(ahora) {
  const local = momentoLocal(ahora);
  const [hora, minuto] = local.hhmm.split(':').map(Number);
  const transcurrido = ((hora * 60 + minuto) * 60 + ahora.getUTCSeconds()) * 1000 + ahora.getUTCMilliseconds();
  const demora = 2 * 3600000 - transcurrido;
  return demora > 0 ? demora : demora + DIA;
}

// La primera vuelta espera un minuto: recalcular bloquea y no debe frenar el arranque del servidor.
function iniciarCicloResurtido(sqlite, { reloj = () => new Date(), programar = setTimeout, cancelar = clearTimeout, esperaInicial = 60000 } = {}) {
  if (ciclos.has(sqlite)) return ciclos.get(sqlite);
  let temporizador, detenido = false, ejecutando = false;
  const detener = () => { detenido = true; cancelar(temporizador); ciclos.delete(sqlite); };
  ciclos.set(sqlite, detener);
  function vuelta() {
    if (detenido || ejecutando) return;
    ejecutando = true;
    try { recalcular(sqlite, reloj().toISOString()); }
    catch (e) { console.error('RESURTIDO_RECALCULO_FALLO', e.message); }
    finally {
      ejecutando = false;
      if (!detenido) { temporizador = programar(vuelta, demoraHastaLasDos(reloj())); temporizador.unref(); }
    }
  }
  temporizador = programar(vuelta, esperaInicial); temporizador.unref?.();
  return detener;
}
module.exports = { recalcular, iniciarCicloResurtido, completarMeses, demoraHastaLasDos };
