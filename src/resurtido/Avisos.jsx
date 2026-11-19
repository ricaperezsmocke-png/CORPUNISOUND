import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { piezas, avisoDecidible, avisoCubierto } from './resurtido';

const TIENDAS = [[1, 'Ocosingo'], [2, 'Yajalón'], [3, 'San Cristóbal'], [4, 'Palenque']];
const nombreTienda = id => TIENDAS.find(([n]) => n === Number(id))?.[1] || String(id);
const BOTON = 'rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50';
const PRIMARIO = 'rounded-md bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800 disabled:opacity-50';
const CAMPO = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const AVISO = 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';
const ERROR = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800';
const BIEN = 'rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900';
const TARJETA = 'space-y-2 rounded-lg border border-slate-200 p-4 text-sm';
const fecha = v => v ? new Date(v).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '';
const DECISION = { pasar: 'Pasar de otra tienda', pedir: 'Pedir extra', esperar: 'Esperar' };

async function pedir(ruta, opciones) {
  const res = await apiFetch(ruta, opciones), datos = await res.json();
  if (!res.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}

function Tarjeta({ a, puede, decidir, ocupado }) {
  const [motivo, setMotivo] = useState('');
  const p = a.propuesta, abierto = a.estado === 'abierto';
  const cubierto = avisoCubierto(a);
  const decidible = !cubierto && puede && avisoDecidible(a);
  return <article className={TARJETA}>
    <p className="font-semibold">{nombreTienda(a.sucursal_id)} · {a.clave} · {a.descripcion}</p>
    {abierto ? <>
      <p>Hay {piezas(Math.max(a.existencia ?? 0, 0))}{cubierto || a.en_camino ? ` y vienen ${piezas(a.en_camino ?? 0)}` : ''};
        {' '}su mínimo es {piezas(a.minimo ?? 0)}.
        {!cubierto && ` Le faltan ${piezas(p.falta)} para el mínimo.`}</p>
      {cubierto && <p>Ya viene lo que le falta. No hay que hacer nada: el aviso se cierra solo cuando llegue.</p>}
    </> : <p className="text-slate-600">Se cerró solo el {fecha(a.cerrado_en)}.</p>}
    {abierto && !cubierto && <ul className="list-disc pl-5">
      {p.pasar.length ? p.pasar.map(d => <li key={d.sucursal_id}>Pasar de {d.nombre}: {piezas(d.piezas)} de {d.clave} (lo que tiene arriba de su máximo).</li>)
        : <li>Ninguna tienda tiene de sobra: solo se puede pedir.</li>}
      <li>Pedir extra al proveedor: {piezas(p.pedir)} para llegar a su máximo.</li>
    </ul>}
    {a.decision && <p className="text-slate-700">Decisión: {DECISION[a.decision]} · {a.nombre_actor} · {fecha(a.decidido_en)}{a.motivo ? ` · ${a.motivo}` : ''}
      {a.pedido_id ? ` · pedido extra #${a.pedido_id} (pestaña Pedido)` : ''}</p>}
    {a.reservas.map((r, i) => <p key={i} className={r.estado === 'viva' ? AVISO : 'text-xs text-slate-600'}>
      {r.estado === 'viva' ? `Apartadas ${piezas(r.piezas)} en ${r.nombre_donante} hasta ${fecha(r.vence)}. `
        + 'El sistema no aparta nada en SICAR: revisa la existencia en SICAR antes de hacer el traspaso.'
        : `${piezas(r.piezas)} de ${r.nombre_donante}: ${r.estado === 'consumida' ? 'ya se hizo el traspaso' : 'el apartado venció'}.`}
    </p>)}
    {decidible && <div className="space-y-2">
      <label className="block">Motivo (opcional)<input className={CAMPO} maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARIO} disabled={ocupado || !p.pasar.length} onClick={() => decidir(a.id, 'pasar', motivo)}>Pasar de otra tienda</button>
        <button type="button" className={BOTON} disabled={ocupado || !(p.pedir > 0)} onClick={() => decidir(a.id, 'pedir', motivo)}>Pedir extra</button>
        {a.decision !== 'esperar' && <button type="button" className={BOTON} disabled={ocupado} onClick={() => decidir(a.id, 'esperar', motivo)}>Esperar</button>}
      </div>
    </div>}
  </article>;
}

// Avisos entre pedidos: la tienda escoge pasar de otra tienda, pedir extra o esperar. Los traspasos se hacen en SICAR.
export default function Avisos({ usuario, tienda }) {
  const permisos = usuario?.permisos || [];
  const verTodas = permisos.includes('ver_todas_las_sucursales'), puede = permisos.includes('dar_visto_bueno_resurtido');
  const alcance = new URLSearchParams({ sucursal_id: verTodas ? tienda : String(usuario?.sucursal_id) }).toString();
  const [datos, setDatos] = useState(null), [error, setError] = useState(''), [mensaje, setMensaje] = useState('');
  const [version, setVersion] = useState(0), [ocupado, setOcupado] = useState(false);
  useEffect(() => { setDatos(null); pedir(`/resurtido/avisos?${alcance}`).then(setDatos).catch(e => setError(e.message)); }, [alcance, version]);
  async function decidir(id, decision, motivo) {
    setOcupado(true); setError(''); setMensaje('');
    try {
      const r = await pedir(`/resurtido/avisos/${id}/decision?${alcance}`, { method: 'POST', body: JSON.stringify({ decision, motivo }) });
      setMensaje(r.mensaje || (decision === 'pedir' ? `Se armó el pedido extra #${r.pedido_id}: falta su visto bueno y su aprobación.` : 'Listo.'));
      setVersion(v => v + 1);
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  const abiertos = (datos?.avisos || []).filter(a => a.estado === 'abierto'), cerrados = (datos?.avisos || []).filter(a => a.estado !== 'abierto');
  const pendientes = abiertos.filter(a => !avisoCubierto(a)), cubiertos = abiertos.filter(avisoCubierto);
  return <section className="space-y-4">
    <p className="text-sm text-slate-600">Productos abajo de su mínimo antes del siguiente pedido. El sistema propone; tú decides.
      Los traspasos se hacen en SICAR como siempre.</p>
    {error && <p role="alert" className={ERROR}>{error}</p>}
    {mensaje && <p role="status" className={BIEN}>{mensaje}</p>}
    {!datos && !error && <p role="status">Revisando avisos…</p>}
    {!!datos?.apartados.length && <div className={AVISO}>
      <p className="font-semibold">Mercancía apartada para otra tienda (haz el traspaso en SICAR):</p>
      <ul className="list-disc pl-5">{datos.apartados.map((r, i) => <li key={i}>
        {r.nombre_donante} → {r.nombre_receptora}: {piezas(r.piezas)} de {r.clave}, hasta {fecha(r.vence)}</li>)}</ul>
    </div>}
    {datos && !abiertos.length && <p className="text-slate-600">No hay productos abajo de su mínimo.</p>}
    <div className="grid gap-3 lg:grid-cols-2">{pendientes.map(a => <Tarjeta key={a.id} a={a} puede={puede} decidir={decidir} ocupado={ocupado} />)}</div>
    {!!cubiertos.length && <details className="rounded-lg border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer">Ya vienen en camino ({cubiertos.length})</summary>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">{cubiertos.map(a => <Tarjeta key={a.id} a={a} puede={false} decidir={decidir} ocupado />)}</div>
    </details>}
    {!!cerrados.length && <details className="rounded-lg border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer">Cerrados en los últimos 30 días ({cerrados.length})</summary>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">{cerrados.map(a => <Tarjeta key={a.id} a={a} puede={false} decidir={decidir} ocupado />)}</div>
    </details>}
  </section>;
}
