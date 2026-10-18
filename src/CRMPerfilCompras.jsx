import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { importe, fecha } from './CRMComprasSicar';

const FILA = 'flex justify-between gap-2 border-b border-slate-100 py-1 text-sm';

export default function CRMPerfilCompras({ clienteRef }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true;
    setDatos(null);
    setError('');
    apiFetch(`/crm/v2/clientes/${encodeURIComponent(clienteRef)}/que-compra`).then(async respuesta => {
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error || 'No se pudo cargar qué compra.');
      if (activo) setDatos(resultado);
    }).catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [clienteRef]);
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!datos) return <p className="text-sm">Cargando qué compra…</p>;
  return <section className="space-y-2" aria-label="Qué compra">
    <h4 className="font-semibold">Qué compra · toda su historia</h4>
    <h5 className="text-sm font-semibold">Categorías</h5>
    <ul>{datos.categorias.map(c => <li key={c.categoria_id ?? 'sin-categoria'} className={FILA}>
      <span>{c.nombre} · {c.piezas} piezas</span><span>{importe(c.monto_centavos)}</span>
    </li>)}</ul>
    {datos.ajustes_centavos !== 0 && <p className={FILA}>
      <span>Ajustes y descuentos de la venta</span><span>{importe(datos.ajustes_centavos)}</span>
    </p>}
    <p className="flex justify-between text-sm font-semibold"><span>Total comprado</span><span>{importe(datos.total_centavos)}</span></p>
    <h5 className="text-sm font-semibold">Artículos más comprados · por importe</h5>
    <ol>{datos.articulos.map((a, i) => <li key={`${a.clave || a.descripcion}:${i}`} className={FILA}>
      <span>{a.descripcion}{a.clave ? ` · ${a.clave}` : ''}
        <span className="block text-xs text-slate-600">{a.piezas} piezas · Última compra: {fecha(a.ultima_fecha)}</span>
      </span><span>{importe(a.monto_centavos)}</span>
    </li>)}</ol>
    {!datos.articulos.length && <p className="text-sm text-slate-600">Sin artículos registrados.</p>}
  </section>;
}
