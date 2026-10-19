import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import CRMBandejaHilo from './CRMBandejaHilo';
import CRMBandejaHerramientas from './CRMBandejaHerramientas';

const FILTRO = 'rounded px-3 py-1 text-sm font-semibold';
const FILA = 'w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50';
const CANAL = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram' };

async function leer(respuesta, mensaje) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || mensaje);
  return datos;
}

// Bandeja de clientes (spec 2026-10-18): conversaciones de WhatsApp, Messenger e Instagram ligadas a la ficha del cliente.
export default function CRMBandeja({ permisos = [], onAbrirCliente }) {
  const puede = clave => permisos.includes(clave);
  const filtros = [['mias', 'Mías'], ['sin_responsable', 'Sin responsable'], ['por_identificar', 'Por identificar'],
    ...(puede('ver_todas_conversaciones') ? [['todas', 'Todas']] : [])];
  const [filtro, setFiltro] = useState('mias');
  const [lista, setLista] = useState([]);
  const [error, setError] = useState('');
  const [seleccion, setSeleccion] = useState(null);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    let activo = true;
    setError('');
    apiFetch(`/mensajes/conversaciones?filtro=${filtro}`).then(r => leer(r, 'No se pudo cargar la bandeja.'))
      .then(datos => { if (activo) setLista(datos); })
      .catch(e => { if (activo) { setLista([]); setError(e.message); } });
    return () => { activo = false; };
  }, [filtro, version]);
  return <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" aria-label="Bandeja de mensajes">
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2" role="tablist">
        {filtros.map(([id, texto]) => <button key={id} role="tab" aria-selected={filtro === id}
          className={`${FILTRO} ${filtro === id ? 'bg-blue-700 text-white' : 'bg-slate-100'}`}
          onClick={() => { setFiltro(id); setSeleccion(null); }}>{texto}</button>)}
      </div>
      {error && <p role="alert" className="p-3 text-sm text-red-700">{error}</p>}
      {!error && !lista.length && <p className="p-3 text-sm text-slate-600">No hay conversaciones aquí.</p>}
      <ul>{lista.map(c => <li key={c.id}>
        <button className={`${FILA} ${seleccion === c.id ? 'bg-blue-50' : ''}`} onClick={() => setSeleccion(c.id)}>
          <span className="flex justify-between gap-2"><strong>{c.cliente_nombre || c.telefono || 'Sin nombre'}</strong>
            <span className="text-xs text-slate-500">{new Date(c.ultima_interaccion_en).toLocaleString('es-MX')}</span></span>
          <span className="block text-xs text-slate-600">{CANAL[c.canal] || c.canal} · {c.canal_nombre}
            {c.responsable_nombre ? ` · ${c.responsable_nombre}` : c.cliente_id ? ' · Sin responsable' : ' · Por identificar'}</span>
          <span className="block truncate text-xs">{c.ultima_direccion === 'saliente' ? 'Tú: ' : ''}{c.ultimo_texto}</span>
        </button>
      </li>)}</ul>
    </div>
    <div className="space-y-3">
      {seleccion ? <CRMBandejaHilo conversacionId={seleccion} permisos={permisos} onCambio={recargar} onAbrirCliente={onAbrirCliente} />
        : <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">Elige una conversación.</p>}
      <CRMBandejaHerramientas permisos={permisos} onCambio={recargar} />
    </div>
  </section>;
}
