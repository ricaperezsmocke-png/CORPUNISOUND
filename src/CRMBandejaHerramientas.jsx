import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';
const ENTRADA = 'block w-full rounded border border-slate-400 p-2 text-sm';

async function leer(respuesta, mensaje) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || mensaje);
  return datos;
}
const enviarJson = (ruta, cuerpo) => apiFetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo) });

// Traspaso de cartera (quien se va no deja clientes huérfanos) y, solo en desarrollo, el canal de prueba.
export default function CRMBandejaHerramientas({ permisos = [], onCambio, desarrollo = import.meta.env?.DEV }) {
  const puede = clave => permisos.includes(clave);
  const [vendedores, setVendedores] = useState([]);
  const [traspaso, setTraspaso] = useState({ de_vendedor_id: '', a_vendedor_id: '', motivo: '' });
  const [prueba, setPrueba] = useState({ sucursal_id: '1', canal: 'whatsapp', numero: '', texto: '' });
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!puede('traspasar_cartera')) return undefined;
    let activo = true;
    apiFetch('/vendedores').then(r => leer(r, '')).then(lista => { if (activo) setVendedores(lista); }).catch(() => {});
    return () => { activo = false; };
  }, [permisos]);
  async function correr(fn) {
    setOcupado(true);
    setAviso('');
    try { setAviso(await fn()); onCambio?.(); } catch (e) { setAviso(e.message); } finally { setOcupado(false); }
  }
  const traspasar = e => { e.preventDefault(); correr(async () => {
    const r = await leer(await enviarJson('/mensajes/traspasos', traspaso), 'No se pudo traspasar.');
    setTraspaso({ de_vendedor_id: '', a_vendedor_id: '', motivo: '' });
    return `Se traspasaron ${r.movidos} clientes.`;
  }); };
  const simular = e => { e.preventDefault(); correr(async () => {
    await leer(await enviarJson('/mensajes/simulado/entrante', { sucursal_id: Number(prueba.sucursal_id), canal: prueba.canal,
      remitente: { id_externo: prueba.numero, nombre: 'Cliente de prueba' }, texto: prueba.texto }), 'No llegó el mensaje de prueba.');
    setPrueba(p => ({ ...p, texto: '' }));
    return 'Mensaje de prueba recibido.';
  }); };
  const activos = vendedores.filter(v => v.activo !== false);
  if (!puede('traspasar_cartera') && !(desarrollo && puede('conectar_canales_mensajes'))) return null;
  return <section className="space-y-3 rounded border border-slate-200 bg-white p-3" aria-label="Herramientas de la bandeja">
    {aviso && <p role="status" className="text-sm">{aviso}</p>}
    {puede('traspasar_cartera') && <form className="space-y-2" onSubmit={traspasar} aria-label="Traspasar cartera">
      <p className="text-sm font-semibold">Traspasar cartera de un vendedor</p>
      <select className={ENTRADA} aria-label="Vendedor que entrega" value={traspaso.de_vendedor_id}
        onChange={e => setTraspaso(t => ({ ...t, de_vendedor_id: e.target.value }))}>
        <option value="">Entrega…</option>
        {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}{v.activo === false ? ' (baja)' : ''}</option>)}
      </select>
      <select className={ENTRADA} aria-label="Vendedor que recibe" value={traspaso.a_vendedor_id}
        onChange={e => setTraspaso(t => ({ ...t, a_vendedor_id: e.target.value }))}>
        <option value="">Recibe…</option>
        {activos.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
      </select>
      <input className={ENTRADA} aria-label="Motivo del traspaso" placeholder="Motivo" maxLength={200} value={traspaso.motivo}
        onChange={e => setTraspaso(t => ({ ...t, motivo: e.target.value }))} />
      <button className={BOTON} type="submit" disabled={ocupado || !traspaso.de_vendedor_id || !traspaso.a_vendedor_id
        || traspaso.motivo.trim().length < 3}>Traspasar</button>
    </form>}
    {desarrollo && puede('conectar_canales_mensajes') && <form className="space-y-2" onSubmit={simular} aria-label="Mensaje de prueba">
      <p className="text-sm font-semibold">Mensaje de prueba (solo desarrollo)</p>
      <div className="flex gap-2">
        <select className={ENTRADA} aria-label="Canal de prueba" value={prueba.canal} onChange={e => setPrueba(p => ({ ...p, canal: e.target.value }))}>
          <option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option>
        </select>
        <input className={ENTRADA} aria-label="Tienda de prueba" value={prueba.sucursal_id} onChange={e => setPrueba(p => ({ ...p, sucursal_id: e.target.value }))} />
      </div>
      <input className={ENTRADA} aria-label="Número o id del remitente" placeholder="52919…" value={prueba.numero}
        onChange={e => setPrueba(p => ({ ...p, numero: e.target.value }))} />
      <input className={ENTRADA} aria-label="Texto de prueba" value={prueba.texto} onChange={e => setPrueba(p => ({ ...p, texto: e.target.value }))} />
      <button className={BOTON} type="submit" disabled={ocupado || !prueba.numero || !prueba.texto.trim()}>Simular mensaje</button>
    </form>}
  </section>;
}
