import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';
const ENTRADA = 'block w-full rounded border border-slate-400 p-2 text-sm';
const BURBUJA = 'max-w-[85%] rounded px-3 py-2 text-sm whitespace-pre-wrap';

async function leer(respuesta, mensaje) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || mensaje);
  return datos;
}
const enviarJson = (ruta, metodo, cuerpo) => apiFetch(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo || {}) });

// Una conversación: mensajes, responder, tomar, reasignar e identificar al cliente. El servidor valida todo.
export default function CRMBandejaHilo({ conversacionId, permisos = [], onCambio, onAbrirCliente }) {
  const puede = clave => permisos.includes(clave);
  const [conv, setConv] = useState(null);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [version, setVersion] = useState(0);
  const [vendedores, setVendedores] = useState([]);
  const [reasignar, setReasignar] = useState({ vendedor_id: '', motivo: '' });
  const [busqueda, setBusqueda] = useState('');
  const [candidatos, setCandidatos] = useState([]);
  useEffect(() => {
    let activo = true;
    setError('');
    apiFetch(`/mensajes/conversaciones/${conversacionId}`).then(r => leer(r, 'No se pudo abrir la conversación.'))
      .then(datos => { if (activo) setConv(datos); })
      .catch(e => { if (activo) { setConv(null); setError(e.message); } });
    return () => { activo = false; };
  }, [conversacionId, version]);
  useEffect(() => {
    if (!puede('reasignar_conversaciones')) return undefined;
    let activo = true;
    apiFetch('/vendedores').then(r => leer(r, '')).then(lista => { if (activo) setVendedores(lista.filter(v => v.activo !== false)); })
      .catch(() => {});
    return () => { activo = false; };
  }, [permisos]);

  async function accion(fn) {
    setOcupado(true);
    setError('');
    try { await fn(); setVersion(v => v + 1); onCambio?.(); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setOcupado(false); }
  }
  const responder = e => { e.preventDefault(); if (!texto.trim()) return;
    accion(async () => { await leer(await enviarJson(`/mensajes/conversaciones/${conversacionId}/mensajes`, 'POST', { texto }), 'No se envió.');
      setTexto(''); }); };
  const tomar = () => accion(async () => leer(await enviarJson(`/mensajes/conversaciones/${conversacionId}/tomar`, 'POST'), 'No se pudo tomar.'));
  const guardarResponsable = e => { e.preventDefault();
    accion(async () => { await leer(await enviarJson(`/mensajes/clientes/${conv.cliente_id}/responsable`, 'PUT', reasignar), 'No se reasignó.');
      setReasignar({ vendedor_id: '', motivo: '' }); }); };
  async function buscar(e) {
    e.preventDefault();
    const datos = await leer(await apiFetch(`/crm/v2/clientes?buscar=${encodeURIComponent(busqueda)}&limit=5`), 'No se pudo buscar.')
      .catch(err => { setError(err.message); return { items: [] }; });
    setCandidatos((datos.items || []).filter(p => p.fuente === 'crm' && p.cliente_id != null));
  }
  const ligar = clienteId => accion(async () => leer(await enviarJson(`/mensajes/identidades/${conv.identidad_id}/ligar`, 'POST',
    { cliente_id: clienteId }), 'No se pudo identificar.'));

  if (error && !conv) return <p role="alert" className="rounded bg-white p-3 text-sm text-red-700">{error}</p>;
  if (!conv) return <p className="rounded bg-white p-3 text-sm">Cargando conversación…</p>;
  return <article className="space-y-3 rounded border border-slate-200 bg-white p-3" aria-label="Conversación">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="font-semibold">{conv.cliente_nombre || conv.nombre_mostrado || 'Sin nombre'}</h4>
        <p className="text-xs text-slate-600">{conv.telefono || 'Sin teléfono'} · {conv.canal_nombre}
          {conv.responsable_nombre ? ` · Responsable: ${conv.responsable_nombre}` : ''}</p>
      </div>
      <div className="flex gap-2">
        {conv.cliente_id && !conv.responsable_id && puede('responder_mensajes')
          && <button className={BOTON} disabled={ocupado} onClick={tomar}>Tomar</button>}
        {conv.cliente_id && onAbrirCliente && <button className={BOTON} onClick={() => onAbrirCliente(conv.cliente_id)}>Ver ficha</button>}
      </div>
    </header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <ol className="max-h-96 space-y-2 overflow-y-auto">{conv.mensajes.map(m => <li key={m.id}
      className={`flex ${m.direccion === 'saliente' ? 'justify-end' : 'justify-start'}`}>
      <p className={`${BURBUJA} ${m.direccion === 'saliente' ? 'bg-blue-100' : 'bg-slate-100'}`}>{m.texto}
        <span className="block text-right text-[10px] text-slate-500">{new Date(m.ocurrida_en).toLocaleString('es-MX')}</span></p>
    </li>)}</ol>
    {puede('responder_mensajes') && <form className="space-y-2" onSubmit={responder}>
      <textarea className={ENTRADA} aria-label="Respuesta" maxLength={4096} value={texto} disabled={ocupado}
        onChange={e => setTexto(e.target.value)} />
      <button className={BOTON} type="submit" disabled={ocupado || !texto.trim()}>Enviar</button>
    </form>}
    {conv.cliente_id && puede('reasignar_conversaciones') && <form className="space-y-2" onSubmit={guardarResponsable}
      aria-label="Cambiar responsable">
      <p className="text-sm font-semibold">Cambiar responsable</p>
      <select className={ENTRADA} aria-label="Nuevo responsable" value={reasignar.vendedor_id}
        onChange={e => setReasignar(r => ({ ...r, vendedor_id: e.target.value }))}>
        <option value="">Elige vendedor…</option>
        {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
      </select>
      <input className={ENTRADA} aria-label="Motivo del cambio" placeholder="Motivo" maxLength={200} value={reasignar.motivo}
        onChange={e => setReasignar(r => ({ ...r, motivo: e.target.value }))} />
      <button className={BOTON} type="submit" disabled={ocupado || !reasignar.vendedor_id || reasignar.motivo.trim().length < 3}>
        Guardar responsable</button>
    </form>}
    {!conv.cliente_id && puede('ligar_identidades') && <div className="space-y-2" aria-label="Identificar cliente">
      <p className="text-sm font-semibold">¿Quién es este contacto?</p>
      <form className="flex gap-2" onSubmit={buscar}>
        <input className={ENTRADA} aria-label="Buscar cliente" placeholder="Nombre o teléfono" value={busqueda}
          onChange={e => setBusqueda(e.target.value)} />
        <button className={BOTON} type="submit" disabled={busqueda.trim().length < 2}>Buscar</button>
      </form>
      <ul>{candidatos.map(p => <li key={p.ref} className="flex justify-between gap-2 py-1 text-sm">
        <span>{p.nombre} · {p.telefono || 'sin teléfono'}</span>
        <button className={BOTON} disabled={ocupado} onClick={() => ligar(p.cliente_id)}>Es este cliente</button>
      </li>)}</ul>
    </div>}
  </article>;
}
