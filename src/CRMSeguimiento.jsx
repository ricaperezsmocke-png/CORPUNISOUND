import React from 'react';
import { ESTADOS, numeroWhatsApp } from './crmSeguimiento';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';

export function EtiquetaEstado({ estado }) {
  const dato = ESTADOS.find(e => e.id === estado);
  if (!dato) return <span className="text-xs text-slate-600">Sin estado</span>;
  return <span className="rounded border px-2 py-0.5 text-xs" style={{ borderColor: dato.color, backgroundColor: `${dato.color}25` }}>
    {dato.label}
  </span>;
}

export default function CRMSeguimiento({ ficha, puedeCambiar = false, guardando = false, onCambiar }) {
  const telefono = ficha.telefono || ficha.celular;
  const numero = numeroWhatsApp(telefono);
  return <section className="space-y-2" aria-label="Seguimiento del cliente">
    <div className="flex flex-wrap items-center gap-2">
      <EtiquetaEstado estado={ficha.estado} />
      {ficha.ya_compro && ficha.estado !== 'compro' && <EtiquetaEstado estado="compro" />}
    </div>
    <div className="flex flex-wrap gap-2">
      {ESTADOS.filter(e => e.id !== 'compro').map(e => <button key={e.id} type="button" className={BOTON}
        disabled={!puedeCambiar || guardando} aria-pressed={ficha.estado === e.id} onClick={() => onCambiar(e.id)}>
        {e.label}
      </button>)}
    </div>
    {!puedeCambiar && <p className="text-xs text-slate-600">Sin permiso para cambiar el estado.</p>}
    {guardando && <p role="status" className="text-sm">Guardando estado…</p>}
    {telefono && (numero
      ? <a className={BOTON} href={`https://wa.me/${numero}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      : <button type="button" className={BOTON} disabled>WhatsApp · Teléfono no válido</button>)}
  </section>;
}
