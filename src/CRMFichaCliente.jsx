import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import CRMComprasSicar, { importe, fecha } from './CRMComprasSicar';
import CRMSeguimiento from './CRMSeguimiento';

const PRIMARIO = 'rounded bg-blue-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50';
const SEGMENTOS = { activo: 'Activo', en_riesgo: 'En riesgo', inactivo: 'Inactivo' };

export default function CRMFichaCliente({ clienteRef, nombreSucursal, onAbrirNativo, puedeCambiar, onActualizado }) {
  const [ficha, setFicha] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const vigente = useRef(0);
  const enviando = useRef(false);
  useEffect(() => {
    const version = ++vigente.current;
    setFicha(null);
    setError('');
    apiFetch(`/crm/v2/clientes/${encodeURIComponent(clienteRef)}`).then(async respuesta => {
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cargar la ficha.');
      if (version === vigente.current) setFicha(datos);
    }).catch(e => { if (version === vigente.current) setError(e.message); });
    return () => { vigente.current++; };
  }, [clienteRef]);

  async function cambiar(estado) {
    if (!puedeCambiar || enviando.current) return;
    enviando.current = true;
    const version = vigente.current;
    setGuardando(true);
    setError('');
    try {
      const respuesta = await apiFetch(`/crm/v2/clientes/${encodeURIComponent(clienteRef)}/estado`, {
        method: 'PUT', body: JSON.stringify({ estado }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudo guardar el estado.');
      if (version === vigente.current) {
        setFicha(datos);
        onActualizado();
      }
    } catch (e) { if (version === vigente.current) setError(e.message); }
    finally {
      enviando.current = false;
      if (version === vigente.current) setGuardando(false);
    }
  }

  if (!ficha) return error
    ? <p role="alert" className="text-sm text-red-700">{error}</p>
    : <p className="text-sm">Cargando ficha…</p>;
  return <article className="space-y-3" aria-label="Ficha del cliente">
    <div>
      <h3 className="text-lg font-bold">{ficha.nombre}</h3>
      <p className="text-sm">{ficha.telefono || 'Sin teléfono'} · {ficha.fuente === 'sicar' ? 'SICAR' : 'CRM'}, {nombreSucursal(ficha.sucursal_id)}</p>
    </div>
    {ficha.aviso_vinculo && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">{ficha.aviso_vinculo}</p>}
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <dt>Total comprado</dt><dd className="font-semibold">{importe(ficha.monto_centavos)}</dd>
      <dt>Punto de Venta</dt><dd>{importe(ficha.monto_pos_centavos)}</dd>
      <dt>SICAR</dt><dd>{importe(ficha.monto_sicar_centavos)}</dd>
      <dt>Compras</dt><dd>{ficha.numero_compras}</dd>
      <dt>Última compra</dt><dd>{fecha(ficha.ultima_compra)}</dd>
      <dt>Score · segmento</dt><dd>{ficha.score} · {SEGMENTOS[ficha.segmento] || ficha.segmento}</dd>
    </dl>
    <CRMSeguimiento ficha={ficha} puedeCambiar={puedeCambiar} guardando={guardando} onCambiar={cambiar} />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {ficha.fuente === 'crm'
      ? <button className={PRIMARIO} onClick={() => onAbrirNativo(ficha.cliente_id)}>Abrir ficha completa en Clientes</button>
      : <p className="text-sm text-slate-600">Los datos y las compras vienen de SICAR. Aquí puedes actualizar su seguimiento.</p>}
    <CRMComprasSicar clienteRef={ficha.ref} nombreSucursal={nombreSucursal} />
  </article>;
}
