import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { piezas, textoWhatsApp } from './resurtido';

const TIENDAS = [[1, 'Ocosingo'], [2, 'Yajalón'], [3, 'San Cristóbal'], [4, 'Palenque']];
const CELDA = 'border-b border-slate-200 px-3 py-2 text-left tabular-nums';
const CAMPO = 'mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const PRIMARIO = 'rounded-md bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800 disabled:opacity-50';
const AVISO = 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';
const hoy = () => new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

// Solo arma y copia la lista: el sistema no manda nada al proveedor.
export default function ListaProveedor({ tienda, cerrar }) {
  const [marca, setMarca] = useState('JR'), [datos, setDatos] = useState(null);
  const [error, setError] = useState(''), [copiado, setCopiado] = useState(''), [texto, setTexto] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDatos(null); setError(''); setCopiado(''); setTexto('');
    apiFetch(`/resurtido/sugerido?${new URLSearchParams({ marca, sucursal_id: tienda })}`, { signal: controller.signal })
      .then(async res => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'No se pudo armar la lista.');
        if (!controller.signal.aborted) setDatos(d);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [marca, tienda]);
  const columnas = TIENDAS.filter(([id]) => tienda === 'todas' || Number(tienda) === id);
  async function copiar() {
    const contenido = textoWhatsApp(datos, hoy());
    try { await navigator.clipboard.writeText(contenido); setCopiado('Copiado. Pégalo en WhatsApp.'); }
    catch { setTexto(contenido); setCopiado('No se pudo copiar solo: selecciona el texto de abajo y cópialo.'); }
  }
  return <Dialog open onOpenChange={abierto => { if (!abierto) cerrar(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
      <DialogTitle>Lista para el proveedor</DialogTitle>
      <DialogDescription>Sugerido para llegar al máximo, descontando lo que ya viene en camino. Nada se envía solo.</DialogDescription>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Marca
          <select className={CAMPO} value={marca} onChange={e => setMarca(e.target.value)}><option>JR</option><option>SOLCOR</option></select>
        </label>
        <button type="button" className={PRIMARIO} disabled={!datos} onClick={copiar}>Copiar para WhatsApp</button>
        {copiado && <p role="status" className="text-sm text-green-800">{copiado}</p>}
      </div>
      {texto && <textarea className="h-40 w-full rounded-md border p-2 text-sm" readOnly value={texto} />}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!datos && !error && <p role="status">Armando la lista…</p>}
      {!!datos?.tiendas_atrasadas?.length && <p className={AVISO}>
        Datos atrasados: {datos.tiendas_atrasadas.map(id => TIENDAS.find(([n]) => n === id)?.[1] || id).join(', ')}. No se les sugiere nada.
      </p>}
      {datos && (datos.renglones.length ? <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>{['Clave', 'Producto', 'Total', ...columnas.map(([, n]) => n)].map(h =>
            <th key={h} scope="col" className={CELDA}>{h}</th>)}</tr></thead>
          <tbody>{datos.renglones.map(r => <tr key={r.clave}>
            <td className={CELDA}>{r.clave}</td><td className={CELDA}>{r.descripcion}</td>
            <td className={`${CELDA} font-semibold`}>{piezas(r.total)}</td>
            {columnas.map(([id]) => <td key={id} className={CELDA}>{piezas(r.por_tienda.find(t => t.sucursal_id === id)?.sugerido || 0) || ''}</td>)}
          </tr>)}</tbody>
        </table>
        <p className="mt-2 text-xs text-slate-600">{datos.renglones.length} productos. El cable va en metros, sin redondear a rollo.</p>
      </div> : <p className="text-slate-600">No hay nada que pedir de {marca}.</p>)}
    </DialogContent>
  </Dialog>;
}
