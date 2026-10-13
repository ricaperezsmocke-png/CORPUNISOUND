import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';

const BOTON = 'rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const SECUNDARIO = 'rounded-md border border-slate-400 px-3 py-2 text-sm disabled:opacity-50';
const CELDA = 'border-b border-slate-300 px-3 py-2 text-left';
const fecha = valor => valor ? new Date(valor).toLocaleString('es-MX') : 'Sin envíos';

async function consultar(ruta, opciones) {
  const respuesta = await apiFetch(ruta, opciones);
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}

export default function SicarAdministracion({ permisos = [] }) {
  const administra = permisos.includes('administrar_llaves_sicar');
  const sincroniza = permisos.includes('ver_sincronizacion_sicar');
  const [tiendas, setTiendas] = useState([]);
  const [llaves, setLlaves] = useState([]);
  const [envios, setEnvios] = useState([]);
  const [intentos, setIntentos] = useState([]);
  const [tienda, setTienda] = useState('');
  const [secreto, setSecreto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    const [acceso, actividad] = await Promise.all([
      administra ? consultar('/sicar/llaves') : null,
      sincroniza ? consultar('/sicar/envios') : null,
    ]);
    setTiendas(acceso?.tiendas || actividad?.tiendas || []);
    setLlaves(acceso?.llaves || []);
    setEnvios(actividad?.envios || []);
    setIntentos(actividad?.intentos || []);
  }, [administra, sincroniza]);

  useEffect(() => {
    setOcupado(true);
    cargar().catch(() => setError('No se pudo cargar la administración SICAR.')).finally(() => setOcupado(false));
  }, [cargar]);

  async function actuar(accion) {
    setOcupado(true);
    setError('');
    try { await accion(); }
    catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }

  async function generar() {
    setSecreto('');
    setCopiado(false);
    const datos = await consultar('/sicar/llaves', { method: 'POST', body: JSON.stringify({ sucursal_id: Number(tienda) }) });
    setSecreto(datos.llave);
    await cargar();
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(secreto); setCopiado(true); }
    catch { setError('No se pudo copiar. Selecciona la llave y cópiala manualmente.'); }
  }

  const nombre = id => tiendas.find(t => Number(t.id) === Number(id))?.nombre || `Tienda ${id}`;
  if (!administra && !sincroniza) return null;
  return <section className="space-y-5 rounded-xl border border-slate-300 bg-slate-100 p-5" aria-label="Administración SICAR">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">Administración SICAR</h2>
        <p className="text-sm text-slate-600">Llaves por tienda y últimos envíos de clientes y compras.</p>
      </div>
      <button className={SECUNDARIO} disabled={ocupado} onClick={() => actuar(async () => { setSecreto(''); await cargar(); })}>
        Actualizar
      </button>
    </div>
    {error && <p role="alert" className="rounded bg-red-100 p-3 text-red-800">{error}</p>}
    {ocupado && <p role="status">Cargando…</p>}
    {administra && <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">Tienda
          <select value={tienda} onChange={e => setTienda(e.target.value)} className="rounded border border-slate-400 bg-white p-2">
            <option value="">Selecciona una tienda</option>
            {tiendas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <button className={BOTON} disabled={ocupado || !tienda} onClick={() => actuar(generar)}>Generar llave</button>
      </div>
      {secreto && <div className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-4">
        <p className="font-semibold">Copia esta llave ahora. Se muestra una sola vez.</p>
        <p className="text-sm">Al actualizar o salir del panel ya no podrás recuperarla.</p>
        <textarea aria-label="Llave nueva" readOnly value={secreto} className="w-full rounded border p-2 font-mono text-sm" />
        <button className={SECUNDARIO} onClick={copiar}>{copiado ? 'Copiada' : 'Copiar llave'}</button>
        <button className={SECUNDARIO} onClick={() => setSecreto('')}>Ocultar llave</button>
      </div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="mb-2 text-left font-semibold">Llaves por tienda</caption>
          <thead><tr>{['Tienda', 'Identificador', 'Creada', 'Estado', 'Acciones'].map(t => <th className={CELDA} key={t}>{t}</th>)}</tr></thead>
          <tbody>{llaves.map(k => <tr key={k.key_id}>
            <td className={CELDA}>{nombre(k.sucursal_id)}</td>
            <td className={CELDA}>{k.key_id}</td>
            <td className={CELDA}>{fecha(k.creada)}</td>
            <td className={CELDA}>{k.revocada ? 'Revocada' : 'Activa'}</td>
            <td className={CELDA}>{!k.revocada && <button className={SECUNDARIO} disabled={ocupado} onClick={() => actuar(async () => {
              await consultar(`/sicar/llaves/${encodeURIComponent(k.key_id)}/revocar`, { method: 'POST', body: '{}' });
              setSecreto('');
              await cargar();
            })}>Revocar</button>}</td>
          </tr>)}</tbody>
        </table>
        {!llaves.length && <p className="py-3">No hay llaves registradas.</p>}
      </div>
    </>}
    {sincroniza && <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="mb-2 text-left font-semibold">Últimos 100 envíos aceptados</caption>
          <thead><tr>{['Tienda', 'Recepción', 'Secuencia', 'Clientes', 'Compras'].map(t => <th className={CELDA} key={t}>{t}</th>)}</tr></thead>
          <tbody>{envios.map(e => <tr key={`${e.sucursal_id}:${e.batch_id}`}>
            <td className={CELDA}>{nombre(e.sucursal_id)}</td><td className={CELDA}>{fecha(e.fecha)}</td>
            <td className={CELDA}>{e.secuencia}</td><td className={CELDA}>{e.clientes}</td><td className={CELDA}>{e.ventas}</td>
          </tr>)}</tbody>
        </table>
        {!envios.length && <p className="py-3">Todavía no hay envíos aceptados.</p>}
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">Últimos intentos de conexión</summary>
        <ul className="mt-2 space-y-1">{intentos.map(i => <li key={i.id}>
          {fecha(i.hora)} · {i.sucursal_id ? nombre(i.sucursal_id) : 'Sin autenticar'} · HTTP {i.codigo}
          {' · '}{i.recibidos === null ? 'Cantidad desconocida' : `${i.recibidos} registros recibidos`}
        </li>)}</ul>
        {!intentos.length && <p>No hay intentos registrados.</p>}
      </details>
    </>}
  </section>;
}
