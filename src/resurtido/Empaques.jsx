import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { piezas } from './resurtido';

const CAMPO = 'mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const NUMERO = 'w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900';
const BOTON = 'rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50';
const CELDA = 'border-b border-slate-200 px-3 py-2 text-left align-top';
const ERROR = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800';
const fecha = v => v ? new Date(v).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '';

async function pedir(ruta, opciones) {
  const res = await apiFetch(ruta, opciones), datos = await res.json();
  if (!res.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}

// Empaques por clave Solcor. Solo un empaque confirmado redondea el pedido al rollo completo.
export default function Empaques({ usuario }) {
  const permisos = usuario?.permisos || [];
  const verTodas = permisos.includes('ver_todas_las_sucursales'), puede = verTodas && permisos.includes('configurar_resurtido');
  const alcance = `sucursal_id=${verTodas ? 'todas' : encodeURIComponent(usuario?.sucursal_id)}`;
  const [datos, setDatos] = useState(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [soloCable, setSoloCable] = useState(true), [tamanos, setTamanos] = useState({}), [ocupado, setOcupado] = useState(false);
  useEffect(() => { pedir(`/resurtido/empaques?${alcance}`).then(setDatos).catch(e => setError(e.message)); }, [version, alcance]);
  async function cambiar(method, cuerpo) {
    setOcupado(true); setError('');
    try { await pedir(`/resurtido/empaques?${alcance}`, { method, body: JSON.stringify(cuerpo) }); setVersion(v => v + 1); }
    catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  const claves = (datos?.claves || []).filter(c => !soloCable || c.sugerido || c.confirmado);
  return <section className="space-y-3">
    <p className="text-sm text-slate-600">SICAR no dice qué se vende por rollo. A las claves que empiezan con CABLE se les sugiere rollo de 100,
      pero el pedido solo se redondea cuando alguien confirma el empaque.</p>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={soloCable} onChange={e => setSoloCable(e.target.checked)} /> Solo cable y empaques confirmados
    </label>
    {error && <p role="alert" className={ERROR}>{error}</p>}
    {!datos && !error && <p role="status">Cargando empaques…</p>}
    {datos && <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-100"><tr>{['Clave', 'Producto', 'Sugerido', 'Confirmado', ''].map(h =>
          <th key={h} scope="col" className={CELDA}>{h}</th>)}</tr></thead>
        <tbody>{claves.map(c => {
          const valor = tamanos[c.clave] ?? String(piezas(c.confirmado?.tamano || c.sugerido || 1000000));
          return <tr key={c.clave}>
            <td className={CELDA}>{c.clave}</td><td className={CELDA}>{c.descripcion}</td>
            <td className={CELDA}>{c.sugerido ? `Rollo de ${piezas(c.sugerido)} (sin confirmar)` : '—'}</td>
            <td className={CELDA}>{c.confirmado
              ? `${piezas(c.confirmado.tamano)} piezas · ${c.confirmado.nombre_por} · ${fecha(c.confirmado.en)}` : 'No redondea'}</td>
            <td className={CELDA}>{puede && <div className="flex flex-wrap gap-2">
              <input aria-label={`Empaque ${c.clave}`} className={NUMERO} type="number" min="2" step="1" value={valor}
                onChange={e => setTamanos(t => ({ ...t, [c.clave]: e.target.value }))} />
              <button type="button" className={BOTON} disabled={ocupado}
                onClick={() => cambiar('PUT', { clave: c.clave, piezas: Number(valor) })}>{c.confirmado ? 'Cambiar' : 'Confirmar'}</button>
              {c.confirmado && <button type="button" className={BOTON} disabled={ocupado}
                onClick={() => cambiar('DELETE', { clave: c.clave })}>Quitar</button>}
            </div>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!claves.length && <p className="p-6 text-center text-slate-600">No hay claves que mostrar.</p>}
    </div>}
    {!!datos?.historial.length && <details className="rounded-lg border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer">Historial de empaques</summary>
      <ul className="mt-2 space-y-1">{datos.historial.map(h => <li key={h.id}>{fecha(h.fecha)} · {h.nombre_actor} · {h.clave} ·
        {h.accion === 'quitar' ? ` quitó ${piezas(h.anterior)}` : ` ${h.anterior ? `${piezas(h.anterior)} → ` : ''}${piezas(h.nuevo)}`}</li>)}</ul>
    </details>}
  </section>;
}
