import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';
const FILA = 'flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-2 text-sm';
const DETALLE = 'mt-1 rounded bg-slate-50 p-2 text-xs text-slate-700';
const ETIQUETA_CANCELADA = 'rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800';

export const importe = centavos => (Number(centavos || 0) / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
export const fecha = valor => (valor ? new Date(`${String(valor).slice(0, 10)}T12:00:00`).toLocaleDateString('es-MX') : 'Sin compras');

async function leer(ruta) {
  const respuesta = await apiFetch(ruta);
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cargar.');
  return datos;
}

function Detalle({ compraRef }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true;
    leer(`/crm/v2/compras/${encodeURIComponent(compraRef)}`)
      .then(d => { if (activo) setDatos(d); })
      .catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [compraRef]);
  if (error) return <p role="alert" className="text-xs text-red-700">{error}</p>;
  if (!datos) return <p className={DETALLE}>Cargando artículos…</p>;
  return <ul className={DETALLE}>
    {datos.lineas.map((l, i) => <li key={i}>{Number(l.cantidad)} × {l.descripcion} — {importe(l.importe_centavos)}</li>)}
    {!datos.lineas.length && <li>Sin artículos registrados.</li>}
  </ul>;
}

// Historial de compras de una ficha (POS y SICAR), paginado en el servidor y con detalle bajo demanda.
export default function CRMComprasSicar({ clienteRef, nombreSucursal }) {
  const [cursor, setCursor] = useState(0);
  const [pagina, setPagina] = useState({ items: [], siguiente: null });
  const [abierta, setAbierta] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  useEffect(() => { setCursor(0); setAbierta(null); }, [clienteRef]);
  useEffect(() => {
    let activo = true;
    setCargando(true);
    setError('');
    leer(`/crm/v2/clientes/${encodeURIComponent(clienteRef)}/compras?cursor=${cursor}&limit=20`)
      .then(d => { if (activo) setPagina(d); })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [clienteRef, cursor]);

  return <section aria-label="Historial de compras" className="space-y-2">
    <h4 className="font-semibold">Historial de compras</h4>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {cargando && <p className="text-sm">Cargando…</p>}
    {!cargando && !error && !pagina.items.length && <p className="text-sm">Sin compras registradas.</p>}
    {pagina.items.map(c => <div key={c.ref}>
      <div className={FILA}>
        <span>{fecha(c.fecha)} · {c.fuente === 'sicar' ? `SICAR, ${nombreSucursal(c.sucursal_id)}` : 'Punto de Venta'}</span>
        <span className="flex items-center gap-2">
          {c.estado === 'cancelada' && <span className={ETIQUETA_CANCELADA}>Cancelada · No suma al total</span>}
          <span className={c.suma_al_total ? 'font-semibold' : 'text-slate-500 line-through'}>{importe(c.monto_centavos)}</span>
          <button className={BOTON} onClick={() => setAbierta(abierta === c.ref ? null : c.ref)}>
            {abierta === c.ref ? 'Ocultar' : 'Ver artículos'}
          </button>
        </span>
      </div>
      {abierta === c.ref && <Detalle compraRef={c.ref} />}
    </div>)}
    <div className="flex gap-2">
      <button className={BOTON} disabled={cargando || cursor === 0} onClick={() => setCursor(Math.max(0, cursor - 20))}>Anteriores</button>
      <button className={BOTON} disabled={cargando || pagina.siguiente === null} onClick={() => setCursor(pagina.siguiente)}>Siguientes</button>
    </div>
  </section>;
}
