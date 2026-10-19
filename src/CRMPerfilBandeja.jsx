import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';

const CANAL = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram' };
const ETIQUETA = { contactado: 'Contactado', interesado: 'Interesado', visito_tienda: 'En tienda', compro: 'Compró', perdido: 'Perdido' };
const cuando = valor => new Date(valor).toLocaleString('es-MX');

// En la ficha de un cliente del CRM: sus conversaciones, quién ha sido su responsable y cómo cambió su estado.
export default function CRMPerfilBandeja({ clienteId }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true;
    setDatos(null);
    setError('');
    apiFetch(`/mensajes/clientes/${clienteId}/historial`).then(async r => {
      const resultado = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resultado.error || 'No se pudo cargar el historial.');
      if (activo) setDatos(resultado);
    }).catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [clienteId]);
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!datos) return <p className="text-sm">Cargando historial…</p>;
  return <section className="space-y-2 text-sm" aria-label="Mensajes e historial">
    <h4 className="font-semibold">Mensajes e historial</h4>
    <p>{datos.conversaciones.length
      ? datos.conversaciones.map(c => `${CANAL[c.canal] || c.canal} (${cuando(c.ultima_interaccion_en)})`).join(' · ')
      : 'Sin conversaciones en la bandeja.'}</p>
    {!!datos.responsables.length && <details>
      <summary className="cursor-pointer">Responsables</summary>
      <ul className="space-y-1 text-xs">{datos.responsables.map((a, i) => <li key={i}>
        {a.vendedor_nombre || 'Sin vendedor'} · {a.motivo || 'Sin motivo'} · {cuando(a.asignada_en)}{a.finalizada_en ? '' : ' · actual'}
      </li>)}</ul>
    </details>}
    {!!datos.estados.length && <details>
      <summary className="cursor-pointer">Cambios de estado</summary>
      <ul className="space-y-1 text-xs">{datos.estados.map(h => <li key={h.id}>
        {ETIQUETA[h.anterior] || 'Sin estado'} → {ETIQUETA[h.nuevo] || h.nuevo} · {h.usuario_id ? 'Manual' : 'Automático'}
        {h.motivo ? ` · ${h.motivo}` : ''} · {cuando(h.fecha_hora)}
      </li>)}</ul>
    </details>}
  </section>;
}
