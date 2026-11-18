const { TIENDAS, MARCAS, leerConfig } = require('./config');
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function tiendaValida(valor) {
  const id = Number(valor);
  if (!TIENDAS.includes(id)) throw error(400, 'Tienda inválida.');
  return id;
}

function listar(sqlite, filtros = {}, ahora = new Date().toISOString()) {
  const suc = filtros.sucursal_id == null ? null : tiendaValida(filtros.sucursal_id);
  const pagina = filtros.pagina == null ? 1 : Number(filtros.pagina);
  if (!Number.isSafeInteger(pagina) || pagina < 1) throw error(400, 'Página inválida.');
  for (const [campo, permitidos] of [['marca', MARCAS], ['lista', ['calculado', 'sin_historia', 'no_se_mueve']],
    ['estado', ['agotado', 'bajo_minimo', 'bien', 'sobre_maximo']]]) {
    if (filtros[campo] && !permitidos.includes(filtros[campo])) throw error(400, `Filtro inválido: ${campo}.`);
  }
  const datos = sqlite.prepare(`WITH catalogo AS (
    SELECT a.sucursal_id,a.clave,MIN(a.descripcion) descripcion,
      MAX(CASE WHEN UPPER(TRIM(a.departamento)) IN ('JR','SOLCOR') THEN UPPER(TRIM(a.departamento)) END) marca_actual,
      COALESCE(SUM(e.existencia_diezmilesimas),0) existencia
    FROM sicar_articulos a LEFT JOIN sicar_existencias e ON e.sucursal_id=a.sucursal_id AND e.art_id=a.art_id
    WHERE a.sucursal_id IN (1,2,3,4) AND (? IS NULL OR a.sucursal_id=?) GROUP BY a.sucursal_id,a.clave
  ), claves AS (
    SELECT sucursal_id,clave FROM resurtido_minmax UNION SELECT sucursal_id,clave FROM resurtido_ajustes
  ) SELECT k.sucursal_id,k.clave,c.descripcion,c.marca_actual,COALESCE(c.existencia,0) existencia,
    COALESCE(m.marca,c.marca_actual) marca,COALESCE(m.minimo,0) minimo_calculado,COALESCE(m.maximo,0) maximo_calculado,
    COALESCE(m.venta_diaria_diezmilesimas,0)*30 venta_mes,COALESCE(m.dias_en_cero,0) dias_en_cero,
    COALESCE(m.lista,'sin_historia') lista,m.calidad,m.calculado_en,
    j.minimo ajuste_minimo,j.maximo ajuste_maximo,j.motivo,j.actor,j.fecha
    FROM claves k LEFT JOIN catalogo c ON c.sucursal_id=k.sucursal_id AND c.clave=k.clave
    LEFT JOIN resurtido_minmax m ON m.sucursal_id=k.sucursal_id AND m.clave=k.clave
    LEFT JOIN resurtido_ajustes j ON j.sucursal_id=k.sucursal_id AND j.clave=k.clave
    WHERE k.sucursal_id IN (1,2,3,4) AND (? IS NULL OR k.sucursal_id=?)
      AND (c.marca_actual IS NOT NULL OR j.clave IS NOT NULL) ORDER BY k.sucursal_id,k.clave`).all(suc, suc, suc, suc);
  const q = String(filtros.q || '').trim().toLocaleLowerCase('es');
  const filas = datos.map(f => {
    const ajuste = f.ajuste_minimo === null ? null : {
      minimo: f.ajuste_minimo, maximo: f.ajuste_maximo, motivo: f.motivo, actor: f.actor, fecha: f.fecha,
    };
    const minimo = ajuste?.minimo ?? f.minimo_calculado, maximo = ajuste?.maximo ?? f.maximo_calculado;
    const estado = f.existencia <= 0 ? 'agotado' : f.existencia < minimo ? 'bajo_minimo' : f.existencia > maximo ? 'sobre_maximo' : 'bien';
    return { sucursal_id: f.sucursal_id, clave: f.clave, descripcion: f.descripcion || f.clave, marca: f.marca,
      existencia: f.existencia, minimo, maximo, minimo_calculado: f.minimo_calculado, maximo_calculado: f.maximo_calculado,
      ajuste, venta_mes: f.venta_mes, dias_en_cero: f.dias_en_cero, lista: f.lista, estado,
      ya_no_es_marca: !f.marca_actual, calidad: f.calidad, calculado_en: f.calculado_en };
  }).filter(f => (!filtros.marca || f.marca === filtros.marca) && (!filtros.lista || f.lista === filtros.lista)
    && (!filtros.estado || f.estado === filtros.estado) && (!q || `${f.clave} ${f.descripcion}`.toLocaleLowerCase('es').includes(q)));
  const config = leerConfig(sqlite), alcance = suc === null ? TIENDAS : [suc];
  const frescura = sqlite.prepare('SELECT MAX(actualizado_en) fecha FROM sicar_existencias WHERE sucursal_id=?');
  const tiendas_atrasadas = alcance.filter(id => {
    const fecha = Date.parse(frescura.get(id).fecha);
    return !Number.isFinite(fecha) || Date.parse(ahora) - fecha > config.dias_datos_atrasados * 86400000;
  });
  const fechas = datos.map(f => f.calculado_en).filter(Boolean).sort();
  return { filas: filas.slice((pagina - 1) * 100, pagina * 100), total: filas.length,
    tiendas_atrasadas, calculado_en: fechas.at(-1) || null };
}

function validar(sqlite, datos) {
  if (!datos || typeof datos !== 'object') throw error(400, 'Datos inválidos.');
  const suc = tiendaValida(datos.sucursal_id), clave = typeof datos.clave === 'string' ? datos.clave.trim() : '';
  const motivo = typeof datos.motivo === 'string' ? datos.motivo.trim() : '';
  if (!clave || motivo.length < 3 || motivo.length > 200) throw error(400, 'Clave y motivo de 3 a 200 caracteres son obligatorios.');
  if (!sqlite.prepare('SELECT 1 FROM sicar_articulos WHERE sucursal_id=? AND clave=?').get(suc, clave)
    && !sqlite.prepare('SELECT 1 FROM resurtido_ajustes WHERE sucursal_id=? AND clave=?').get(suc, clave)) {
    throw error(404, 'Clave no encontrada en esta tienda.');
  }
  return { suc, clave, motivo };
}

function ponerAjuste(sqlite, datos, actor, ahora = new Date().toISOString()) {
  const { suc, clave, motivo } = validar(sqlite, datos);
  const { minimo, maximo } = datos;
  if (![minimo, maximo].every(v => Number.isSafeInteger(v) && v >= 0 && Number.isSafeInteger(v * 10000)) || maximo < minimo) {
    throw error(400, 'Mínimo y máximo deben ser piezas enteras; máximo no puede ser menor que mínimo.');
  }
  return sqlite.transaction(() => {
    sqlite.prepare('INSERT OR REPLACE INTO resurtido_ajustes VALUES (?,?,?,?,?,?,?)')
      .run(suc, clave, minimo * 10000, maximo * 10000, motivo, String(actor), ahora);
    sqlite.prepare(`INSERT INTO resurtido_ajustes_historial(sucursal_id,clave,accion,minimo,maximo,motivo,actor,fecha)
      VALUES (?,?,'poner',?,?,?,?,?)`).run(suc, clave, minimo * 10000, maximo * 10000, motivo, String(actor), ahora);
    return { ok: true };
  }).immediate();
}

function quitarAjuste(sqlite, datos, actor, ahora = new Date().toISOString()) {
  const { suc, clave, motivo } = validar(sqlite, datos);
  return sqlite.transaction(() => {
    const anterior = sqlite.prepare('SELECT * FROM resurtido_ajustes WHERE sucursal_id=? AND clave=?').get(suc, clave);
    if (!anterior) throw error(404, 'No hay corrección para esta clave.');
    sqlite.prepare('DELETE FROM resurtido_ajustes WHERE sucursal_id=? AND clave=?').run(suc, clave);
    sqlite.prepare(`INSERT INTO resurtido_ajustes_historial(sucursal_id,clave,accion,minimo,maximo,motivo,actor,fecha)
      VALUES (?,?,'quitar',?,?,?,?,?)`).run(suc, clave, anterior.minimo, anterior.maximo, motivo, String(actor), ahora);
    return { ok: true };
  }).immediate();
}
module.exports = { listar, ponerAjuste, quitarAjuste };
