import React, { useState } from 'react';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';

export default function CRMPerfilInterna({ ficha, puedeMarcar, guardando, onCambiar }) {
  const [editando, setEditando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const interna = !!ficha.cuenta_interna;
  async function enviar(e) {
    e.preventDefault();
    if (!puedeMarcar || guardando || motivo.trim().length < 3 || motivo.trim().length > 200) return;
    if (await onCambiar(!interna, motivo.trim())) {
      setEditando(false);
      setMotivo('');
    }
  }
  return <section className="space-y-2" aria-label="Cuenta interna">
    {interna && <div className="rounded bg-slate-100 p-2 text-sm">
      <p className="font-semibold">Cuenta interna</p>
      <p>{ficha.cuenta_interna.motivo}</p>
      <p className="text-xs">{ficha.cuenta_interna.usuario_nombre}</p>
    </div>}
    {puedeMarcar && !editando && <button className={BOTON} disabled={guardando} onClick={() => setEditando(true)}>
      {interna ? 'Ya no es cuenta interna' : 'Es cuenta interna'}
    </button>}
    {puedeMarcar && editando && <form className="space-y-2" onSubmit={enviar}>
      <label className="block text-sm">Motivo para {interna ? 'desmarcar' : 'marcar'} la cuenta
        <textarea className="block w-full rounded border border-slate-400 p-2" aria-label="Motivo de cuenta interna"
          required minLength={3} maxLength={200} value={motivo} disabled={guardando} onChange={e => setMotivo(e.target.value)} />
      </label>
      <p className="text-xs text-slate-600">La cuenta seguirá visible. Las cuentas internas no suman a los totales del CRM ni son VIP.</p>
      <div className="flex gap-2">
        <button className={BOTON} disabled={guardando || motivo.trim().length < 3} type="submit">Guardar motivo</button>
        <button className={BOTON} disabled={guardando} type="button" onClick={() => setEditando(false)}>Cancelar</button>
      </div>
    </form>}
    {!!ficha.historial_interna?.length && <details>
      <summary className="cursor-pointer text-sm">Historial de cuenta interna</summary>
      <ul className="space-y-2 text-xs">{ficha.historial_interna.map(h => <li key={h.id}>
        <p>{h.nuevo ? 'Marcada como interna' : 'Desmarcada'} · {h.usuario_nombre} · {new Date(h.fecha_hora).toLocaleString('es-MX')}</p>
        <p>{h.motivo}</p>
      </li>)}</ul>
    </details>}
  </section>;
}
