import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { importe, fecha } from './CRMComprasSicar';
import CRMFichaCliente from './CRMFichaCliente';
import { EtiquetaEstado } from './CRMSeguimiento';
import { ESTADOS } from './crmEstados';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-1 text-sm disabled:opacity-50';
const PRIMARIO = 'rounded bg-blue-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50';
const TARJETA = 'rounded-lg border border-slate-200 bg-white p-3';
const FILA = 'flex w-full items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-left text-sm';
const MARCA_SICAR = 'rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900';
const MARCA_CRM = 'rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900';
const CAMPO = 'rounded border border-slate-400 px-2 py-1 text-sm';
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
  const [filtros, setFiltros] = useState({ orden: 'reciente', desde: '', hasta: '', estado: '' });
  const [puedeCambiar, setPuedeCambiar] = useState(false);
  const peticion = useRef(0);
  useEffect(() => {
    let activo = true;
    leer('/auth/yo').then(sesion => {
      if (activo) setPuedeCambiar(sesion.permisos?.includes('cambiar_estado_cliente') === true);
    }).catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, []);
  function filtrar(campo, valor) {
    setCursor(0);
    setFiltros(actuales => ({ ...actuales, [campo]: valor }));
  }

  const cargar = useCallback(async () => {
    const version = ++peticion.current;
    setCargando(true);
    setError('');
    try {
      const q = new URLSearchParams({ cursor: String(cursor), limit: String(POR_PAGINA), ...(buscar ? { buscar } : {}) });
      for (const [campo, valor] of Object.entries(filtros)) if (valor) q.set(campo, valor);
      const [lista, porTienda] = await Promise.all([leer(`/crm/v2/clientes?${q}`), leer('/crm/v2/resumen')]);
      if (version !== peticion.current) return;
      setDatos(lista);
      setResumen(porTienda.sucursales || []);
    } catch (e) { if (version === peticion.current) setError(e.message); }
    finally { if (version === peticion.current) setCargando(false); }
  }, [cursor, buscar, filtros]);
  useEffect(() => { cargar(); return () => { peticion.current++; }; }, [cargar]);

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
      <div className="flex flex-wrap gap-2">
        <label>Orden <select className={CAMPO} aria-label="Orden" value={filtros.orden} onChange={e => filtrar('orden', e.target.value)}>
          <option value="reciente">Última compra</option><option value="nombre">Nombre</option><option value="monto">Mayor monto</option>
        </select></label>
        <label>Desde <input className={CAMPO} aria-label="Desde" type="date" value={filtros.desde} onChange={e => filtrar('desde', e.target.value)} /></label>
        <label>Hasta <input className={CAMPO} aria-label="Hasta" type="date" value={filtros.hasta} onChange={e => filtrar('hasta', e.target.value)} /></label>
        <label>Estado <select className={CAMPO} aria-label="Estado" value={filtros.estado} onChange={e => filtrar('estado', e.target.value)}>
          <option value="">Todos</option><option value="sin_estado">Sin estado</option>
          {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="rounded-lg border border-slate-200 bg-white">
        {datos.items.map(p => <button key={p.ref} className={`${FILA} ${seleccion === p.ref ? 'bg-blue-50' : ''}`}
          onClick={() => setSeleccion(p.ref)}>
          <span className="flex flex-col">
            <span className="font-semibold">{p.nombre}</span>
            <span className="text-xs">{p.telefono || 'Sin teléfono'} · <Marca persona={p} nombreSucursal={nombreSucursal} /></span>
          </span>
          <span className="text-right text-xs">
            <EtiquetaEstado estado={p.estado} />
            <span className="block">Última compra: {fecha(p.ultima_compra)}</span>
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
        ? <CRMFichaCliente key={seleccion} clienteRef={seleccion} nombreSucursal={nombreSucursal} onAbrirNativo={onAbrirNativo}
          puedeCambiar={puedeCambiar} onActualizado={cargar} />
        : <p className="text-sm">Elige un cliente para ver su ficha y sus compras.</p>}
    </aside>
  </section>;
}
