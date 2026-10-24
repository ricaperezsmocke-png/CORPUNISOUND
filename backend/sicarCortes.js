// Cortes de caja tal como los guardó SICAR. No se recalcula nada: se muestran sus cifras y se decide, con una regla
// fija, si una diferencia se puede atribuir a una persona. Regla (spec 2026-10-23 §4.5): la diferencia es del turno;
// solo es "propia" de alguien si fue la ÚNICA que cobró (ventas > 0) y tiene usuario registrado. Quien cerró el corte
// nunca carga con la diferencia por haberlo cerrado.
const { fechaLocal } = require('./fechas');

const UMBRAL_CENTAVOS = 100n;
const DIAS_POR_DEFECTO = 30;
const DIA = 86400000;
const CONTROLES = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\uFFFD]/;

const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });

// Centavos enteros con signo -> texto con dos decimales, sin aritmética binaria. -33 -> "-0.33".
function centavosATexto(valor) {
  const n = BigInt(valor);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// Filtro opcional de texto: ausente o vacío = sin filtro; un arreglo (?x=1&x=2) u otro tipo se rechaza.
function filtroTexto(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' && typeof valor !== 'number') throw fallo(400, `El filtro ${campo} es inválido.`);
  return String(valor);
}

function filtroFecha(valor, campo) {
  const texto = filtroTexto(valor, campo);
  if (texto === null) return null;
  const d = new Date(`${texto}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) {
    throw fallo(400, `La fecha ${campo} es inválida.`);
  }
  return texto;
}

function idTienda(valor) {
  const n = Number(valor);
  if (!['number', 'string'].includes(typeof valor) || valor === '' || !Number.isSafeInteger(n) || n <= 0) {
    throw fallo(400, 'La tienda es inválida.');
  }
  return n;
}

// Alcance solo de quien pregunta (regla 5): ver todas, o la tienda de su token. Sin tienda válida no ve nada.
function tiendaDelAlcance(alcance) {
  if (alcance?.verTodas) return null;
  const propia = Number(alcance?.sucursalId);
  if (!Number.isSafeInteger(propia) || propia <= 0) throw fallo(403, 'No tienes una tienda autorizada.');
  return propia;
}

function cargarNombres(sqlite) {
  const mapa = new Map();
  for (const n of sqlite.prepare('SELECT sucursal_id, usu_id, nombre FROM sicar_cajeros').all()) {
    mapa.set(`${n.sucursal_id}\u0000${n.usu_id}`, n.nombre);
  }
  return (sucursal_id, usu_id) => ({ sucursal_id, usu_id,
    nombre: usu_id === '' ? null : mapa.get(`${sucursal_id}\u0000${usu_id}`) ?? null });
}

function consultarCortesSicar(sqlite, filtros = {}, alcance, hoy = fechaLocal()) {
  const propia = tiendaDelAlcance(alcance);
  const hasta = filtroFecha(filtros.hasta, 'hasta') ?? hoy;
  const desde = filtroFecha(filtros.desde, 'desde')
    ?? new Date(Date.parse(`${hoy}T00:00:00Z`) - (DIAS_POR_DEFECTO - 1) * DIA).toISOString().slice(0, 10);
  const pedida = filtroTexto(filtros.sucursal_id, 'sucursal_id') === null ? null : idTienda(filtros.sucursal_id);
  const cajId = filtroTexto(filtros.caj_id, 'caj_id');
  const usuId = filtroTexto(filtros.usu_id, 'usu_id');
  const vacio = { cortes: [], resumen: [], umbral: centavosATexto(UMBRAL_CENTAVOS) };
  // El filtro de tienda recorta el alcance; nunca lo amplía.
  if (propia !== null && pedida !== null && pedida !== propia) return vacio;
  const tienda = propia ?? pedida;

  const filas = sqlite.prepare(`SELECT c.* FROM sicar_cortes c
    WHERE substr(c.fecha_local, 1, 10) BETWEEN @desde AND @hasta
      AND (@tienda IS NULL OR c.sucursal_id = @tienda)
      AND (@caj IS NULL OR c.caj_id = @caj)
      AND (@usu IS NULL OR c.usu_id = @usu OR EXISTS (SELECT 1 FROM sicar_cortes_cobros b
        WHERE b.sucursal_id = c.sucursal_id AND b.cor_id = c.cor_id AND b.usu_id = @usu))
    ORDER BY c.fecha_local DESC, c.sucursal_id, length(c.cor_id) DESC, c.cor_id DESC`)
    .all({ desde, hasta, tienda, caj: cajId, usu: usuId });
  const leerPagos = sqlite.prepare(`SELECT tpa_id, contado_centavos, calculado_centavos, diferencia_centavos, retiro_centavos
    FROM sicar_cortes_pagos WHERE sucursal_id = ? AND cor_id = ? ORDER BY length(tpa_id), tpa_id`);
  const leerCobros = sqlite.prepare(`SELECT usu_id, ventas, total_centavos, canceladas, total_canceladas_centavos
    FROM sicar_cortes_cobros WHERE sucursal_id = ? AND cor_id = ? ORDER BY total_centavos DESC, length(usu_id), usu_id`);
  const persona = cargarNombres(sqlite);

  const resumen = new Map();
  const acumulado = (s, u) => {
    const llave = `${s}\u0000${u}`;
    if (!resumen.has(llave)) {
      resumen.set(llave, { persona: persona(s, u), turnos_cobro: 0, ventas: 0, total: 0n, turnos_cerro: 0, diferencia_propia: 0n,
        faltantes_propios: 0, sobrantes_propios: 0, diferencia_compartida: 0n });
    }
    return resumen.get(llave);
  };

  const cortes = filas.map(c => {
    const s = c.sucursal_id;
    const diferencia = BigInt(c.diferencia_centavos);
    const cobros = leerCobros.all(s, c.cor_id);
    const conVentas = cobros.filter(b => b.ventas > 0);
    let atribucion = 'compartida';
    if (conVentas.length === 0) atribucion = 'sin_ventas';
    else if (conVentas.length === 1 && conVentas[0].usu_id !== '') atribucion = 'propia';
    const atribuida = atribucion === 'propia' ? conVentas[0].usu_id : null;

    if (c.usu_id !== null) acumulado(s, c.usu_id).turnos_cerro += 1;
    for (const b of cobros) {
      const r = acumulado(s, b.usu_id);
      if (b.ventas <= 0) continue;
      r.turnos_cobro += 1;
      r.ventas += b.ventas;
      r.total += BigInt(b.total_centavos);
      if (atribucion === 'compartida') r.diferencia_compartida += diferencia;
    }
    if (atribuida !== null) {
      const r = acumulado(s, atribuida);
      r.diferencia_propia += diferencia;
      if (diferencia <= -UMBRAL_CENTAVOS) r.faltantes_propios += 1;
      if (diferencia >= UMBRAL_CENTAVOS) r.sobrantes_propios += 1;
    }
    return {
      sucursal_id: s, cor_id: c.cor_id, caj_id: c.caj_id, fecha_local: c.fecha_local,
      cerro: c.usu_id === null ? null : persona(s, c.usu_id),
      contado: centavosATexto(c.contado_centavos), calculado: centavosATexto(c.calculado_centavos),
      diferencia: centavosATexto(diferencia), retiro: centavosATexto(c.retiro_centavos),
      pagos: leerPagos.all(s, c.cor_id).map(p => ({ tpa_id: p.tpa_id, contado: centavosATexto(p.contado_centavos),
        calculado: centavosATexto(p.calculado_centavos), diferencia: centavosATexto(p.diferencia_centavos),
        retiro: centavosATexto(p.retiro_centavos) })),
      cobraron: cobros.map(b => ({ ...persona(s, b.usu_id), ventas: b.ventas, total: centavosATexto(b.total_centavos),
        canceladas: b.canceladas, total_canceladas: centavosATexto(b.total_canceladas_centavos) })),
      atribucion, atribuida_a: atribuida === null ? null : persona(s, atribuida),
    };
  });

  const orden = (a, b) => a.persona.sucursal_id - b.persona.sucursal_id
    || a.persona.usu_id.length - b.persona.usu_id.length || a.persona.usu_id.localeCompare(b.persona.usu_id);
  const personas = [...resumen.values()]
    .filter(r => usuId === null || r.persona.usu_id === usuId)
    .sort(orden)
    .map(r => ({ ...r, total: centavosATexto(r.total), diferencia_propia: centavosATexto(r.diferencia_propia),
      diferencia_compartida: centavosATexto(r.diferencia_compartida) }));
  return { cortes, resumen: personas, umbral: vacio.umbral };
}

// Usuarios de SICAR vistos en cortes (quien cerró) o en cobros, sin las ventas sin usuario registrado.
function listarPersonalSicar(sqlite, alcance) {
  const tienda = tiendaDelAlcance(alcance);
  const historial = sqlite.prepare(`SELECT nombre_anterior, nombre_nuevo, actor, fecha FROM sicar_cajeros_historial
    WHERE sucursal_id = ? AND usu_id = ? ORDER BY id DESC`);
  return sqlite.prepare(`WITH vistos AS (
      SELECT sucursal_id, usu_id, cor_id FROM sicar_cortes WHERE usu_id IS NOT NULL AND usu_id <> ''
      UNION SELECT sucursal_id, usu_id, cor_id FROM sicar_cortes_cobros WHERE usu_id <> '')
    SELECT v.sucursal_id, v.usu_id, n.nombre, COUNT(DISTINCT v.cor_id) AS turnos, MAX(c.fecha_local) AS ultimo
    FROM vistos v
    JOIN sicar_cortes c ON c.sucursal_id = v.sucursal_id AND c.cor_id = v.cor_id
    LEFT JOIN sicar_cajeros n ON n.sucursal_id = v.sucursal_id AND n.usu_id = v.usu_id
    WHERE (@tienda IS NULL OR v.sucursal_id = @tienda)
    GROUP BY v.sucursal_id, v.usu_id
    ORDER BY v.sucursal_id, length(v.usu_id), v.usu_id`).all({ tienda })
    .map(p => ({ ...p, nombre: p.nombre ?? null, historial: historial.all(p.sucursal_id, p.usu_id) }));
}

function validarNombre(valor) {
  if (typeof valor !== 'string') throw fallo(400, 'Escribe el nombre.');
  const nombre = valor.trim();
  const largo = [...nombre].length;
  if (largo < 2 || largo > 80) throw fallo(400, 'El nombre debe tener de 2 a 80 caracteres.');
  if (CONTROLES.test(nombre)) throw fallo(400, 'El nombre tiene caracteres inválidos.');
  return nombre;
}

// Cambiar el nombre cambia a quién se le ven las diferencias: permiso propio y cada cambio queda en el historial.
function asignarNombreSicar(sqlite, datos, actor, alcance) {
  if (!datos || typeof datos !== 'object') throw fallo(400, 'Solicitud inválida.');
  const sucursalId = idTienda(datos.sucursal_id);
  const propia = tiendaDelAlcance(alcance);
  if (propia !== null && propia !== sucursalId) throw fallo(403, 'Tienda fuera de tu alcance.');
  const usuId = datos.usu_id;
  const existe = typeof usuId === 'string' && usuId !== '' && !!sqlite.prepare(`SELECT 1 FROM sicar_cortes WHERE sucursal_id = @s AND usu_id = @u
    UNION ALL SELECT 1 FROM sicar_cortes_cobros WHERE sucursal_id = @s AND usu_id = @u LIMIT 1`).get({ s: sucursalId, u: usuId });
  if (!existe) throw fallo(404, 'Ese usuario de SICAR no aparece en esa tienda.');
  const nombre = validarNombre(datos.nombre);
  const quien = String(actor ?? '');
  if (!quien) throw fallo(401, 'No autenticado.');
  return sqlite.transaction(() => {
    const anterior = sqlite.prepare('SELECT * FROM sicar_cajeros WHERE sucursal_id = ? AND usu_id = ?').get(sucursalId, usuId);
    if (anterior?.nombre === nombre) return anterior;
    const fila = { sucursal_id: sucursalId, usu_id: usuId, nombre, asignado_por: quien, asignado_en: new Date().toISOString() };
    sqlite.prepare(`INSERT INTO sicar_cajeros (sucursal_id, usu_id, nombre, asignado_por, asignado_en)
      VALUES (@sucursal_id, @usu_id, @nombre, @asignado_por, @asignado_en)
      ON CONFLICT(sucursal_id, usu_id) DO UPDATE SET nombre = excluded.nombre, asignado_por = excluded.asignado_por,
        asignado_en = excluded.asignado_en`).run(fila);
    sqlite.prepare(`INSERT INTO sicar_cajeros_historial (sucursal_id, usu_id, nombre_anterior, nombre_nuevo, actor, fecha)
      VALUES (?, ?, ?, ?, ?, ?)`).run(sucursalId, usuId, anterior?.nombre ?? null, nombre, quien, fila.asignado_en);
    return fila;
  }).immediate();
}

module.exports = { consultarCortesSicar, listarPersonalSicar, asignarNombreSicar, centavosATexto, UMBRAL_CENTAVOS };
