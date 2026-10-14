import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import CRMComprasSicar, { importe, fecha } from './CRMComprasSicar';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';
const PRIMARIO = 'rounded bg-blue-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50';
const TARJETA = 'rounded-lg border border-slate-200 bg-white p-3';
const FILA = 'flex w-full items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-left text-sm';
const MARCA_SICAR = 'rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900';
const MARCA_CRM = 'rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900';
const AVISO = 'rounded bg-amber-50 p-2 text-sm text-amber-900';
const SEGMENTOS = { activo: 'Activo', en_riesgo: 'En riesgo', inactivo: 'Inactivo' };
const POR_PAGINA = 50;

async function leer(ruta) {
  const respuesta = await apiFetch(ruta);
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cargar.');
  return datos;
}

function Marca({ persona, nombreSucursal }) {
  return persona.fuente === 'sicar'
    ? <span className={MARCA_SICAR}>SICAR, {nombreSucursal(persona.sucursal_id)}</span>
    : <span className={MARCA_CRM}>CRM</span>;
}

function Ficha({ clienteRef, nombreSucursal, onAbrirNativo }) {
  const [ficha, setFicha] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true;
    setFicha(null);
    setError('');
    leer(`/crm/v2/clientes/${encodeURIComponent(clienteRef)}`)
      .then(d => { if (activo) setFicha(d); })
      .catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [clienteRef]);
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!ficha) return <p className="text-sm">Cargando ficha…</p>;
  return <article className="space-y-3" aria-label="Ficha del cliente">
    <div>
      <h3 className="text-lg font-bold">{ficha.nombre}</h3>
      <p className="text-sm">{ficha.telefono || 'Sin teléfono'} · <Marca persona={ficha} nombreSucursal={nombreSucursal} /></p>
    </div>
    {ficha.aviso_vinculo && <p className={AVISO}>{ficha.aviso_vinculo}</p>}
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <dt>Total comprado</dt><dd className="font-semibold">{importe(ficha.monto_centavos)}</dd>
      <dt>Punto de Venta</dt><dd>{importe(ficha.monto_pos_centavos)}</dd>
      <dt>SICAR</dt><dd>{importe(ficha.monto_sicar_centavos)}</dd>
      <dt>Compras</dt><dd>{ficha.numero_compras}</dd>
      <dt>Última compra</dt><dd>{fecha(ficha.ultima_compra)}</dd>
      <dt>Score · segmento</dt><dd>{ficha.score} · {SEGMENTOS[ficha.segmento] || ficha.segmento}</dd>
    </dl>
    {ficha.fuente === 'crm'
      ? <button className={PRIMARIO} onClick={() => onAbrirNativo(ficha.cliente_id)}>Abrir ficha completa en Clientes</button>
      : <p className="text-sm text-slate-600">Ficha de consulta: los datos vienen de SICAR y no se editan aquí.</p>}
    <CRMComprasSicar clienteRef={ficha.ref} nombreSucursal={nombreSucursal} />
  </article>;
}

// Lista de clientes con compras del POS y de SICAR. Búsqueda, totales y páginas se calculan en el servidor.
export default function CRMListaClientes({ nombreSucursal, onAbrirNativo }) {
  const [texto, setTexto] = useState('');
  const [buscar, setBuscar] = useState('');
  const [cursor, setCursor] = useState(0);
  const [datos, setDatos] = useState({ items: [], siguiente: null, totales: null });
  const [resumen, setResumen] = useState([]);
  const [seleccion, setSeleccion] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const q = new URLSearchParams({ cursor: String(cursor), limit: String(POR_PAGINA), ...(buscar ? { buscar } : {}) });
      const [lista, porTienda] = await Promise.all([leer(`/crm/v2/clientes?${q}`), leer('/crm/v2/resumen')]);
      setDatos(lista);
      setResumen(porTienda.sucursales || []);
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [cursor, buscar]);
  useEffect(() => { cargar(); }, [cargar]);

  const totales = datos.totales;
  return <section className="grid gap-4 lg:grid-cols-[1fr_380px]" aria-label="Clientes con compras de SICAR">
    <div className="space-y-3">
      {totales && <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className={TARJETA}><p className="text-xs uppercase">Clientes</p><p className="text-xl font-bold">{totales.clientes}</p></div>
        <div className={TARJETA}><p className="text-xs uppercase">Compraron</p><p className="text-xl font-bold">{totales.compradores}</p></div>
        <div className={TARJETA}><p className="text-xs uppercase">Punto de Venta</p><p className="text-xl font-bold">{importe(totales.monto_pos_centavos)}</p></div>
        <div className={TARJETA}><p className="text-xs uppercase">SICAR</p><p className="text-xl font-bold">{importe(totales.monto_sicar_centavos)}</p></div>
      </div>}
      {resumen.length > 1 && <p className="text-xs text-slate-600">
        {resumen.map(s => `${s.nombre}: ${importe(s.monto_pos_centavos)} POS · ${importe(s.monto_sicar_centavos)} SICAR`).join(' | ')}
      </p>}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setCursor(0); setBuscar(texto.trim()); }}>
        <input className="w-full rounded border border-slate-400 px-3 py-1 text-sm" placeholder="Buscar por nombre o teléfono"
          value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar cliente" />
        <button className={PRIMARIO} type="submit" disabled={cargando}>Buscar</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="rounded-lg border border-slate-200 bg-white">
        {datos.items.map(p => <button key={p.ref} className={`${FILA} ${seleccion === p.ref ? 'bg-blue-50' : ''}`}
          onClick={() => setSeleccion(p.ref)}>
          <span className="flex flex-col">
            <span className="font-semibold">{p.nombre}</span>
            <span className="text-xs">{p.telefono || 'Sin teléfono'} · <Marca persona={p} nombreSucursal={nombreSucursal} /></span>
          </span>
          <span className="text-right text-xs">
            <span className="block font-semibold">{importe(p.monto_centavos)}</span>
            {p.numero_compras} {p.numero_compras === 1 ? 'compra' : 'compras'} · {SEGMENTOS[p.segmento] || p.segmento}
          </span>
        </button>)}
        {!cargando && !datos.items.length && <p className="p-3 text-sm">No hay clientes con ese criterio.</p>}
        {cargando && <p className="p-3 text-sm">Cargando…</p>}
      </div>
      <div className="flex gap-2">
        <button className={BOTON} disabled={cargando || cursor === 0} onClick={() => setCursor(Math.max(0, cursor - POR_PAGINA))}>Anterior</button>
        <button className={BOTON} disabled={cargando || datos.siguiente === null} onClick={() => setCursor(datos.siguiente)}>Siguiente</button>
      </div>
    </div>
    <aside className="rounded-lg border border-slate-200 bg-white p-4">
      {seleccion
        ? <Ficha clienteRef={seleccion} nombreSucursal={nombreSucursal} onAbrirNativo={onAbrirNativo} />
        : <p className="text-sm">Elige un cliente para ver su ficha y sus compras.</p>}
    </aside>
  </section>;
}
