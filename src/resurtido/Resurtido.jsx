import React, { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { apiFetch } from '../api';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { piezas, textoEstado, textoCalidad } from './resurtido';

const TIENDAS = [[1, 'Ocosingo'], [2, 'Yajalón'], [3, 'San Cristóbal'], [4, 'Palenque']];
const nombreTienda = id => TIENDAS.find(([n]) => n === Number(id))?.[1] || String(id);
const CAMPO = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const BOTON = 'rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50';
const PRIMARIO = 'rounded-md bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800 disabled:opacity-50';
const CELDA = 'border-b border-slate-200 px-3 py-3 text-left align-top';
const AVISO = 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';
const ERROR = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800';
const numero = valor => piezas(valor).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const fecha = valor => valor ? new Date(valor).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'Sin cálculo todavía';

async function pedir(ruta, opciones) {
  const res = await apiFetch(ruta, opciones), datos = await res.json();
  if (!res.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}

function Correccion({ fila, cerrar, guardado }) {
  const [minimo, setMinimo] = useState(String(piezas(fila.minimo)));
  const [maximo, setMaximo] = useState(String(piezas(fila.maximo)));
  const [motivo, setMotivo] = useState(''), [error, setError] = useState(''), [guardando, setGuardando] = useState(false);
  async function guardar(method) {
    if (motivo.trim().length < 3) { setError('Escribe un motivo de al menos 3 caracteres.'); return; }
    setGuardando(true); setError('');
    try {
      await pedir(`/resurtido/ajuste?sucursal_id=${fila.sucursal_id}`, { method, body: JSON.stringify({
        sucursal_id: fila.sucursal_id, clave: fila.clave, minimo: Number(minimo), maximo: Number(maximo), motivo,
      }) });
      guardado();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  }
  return <Dialog open onOpenChange={abierto => { if (!abierto && !guardando) cerrar(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogTitle>Corregir mínimo y máximo</DialogTitle>
      <DialogDescription>{nombreTienda(fila.sucursal_id)} · {fila.clave} · {fila.descripcion}</DialogDescription>
      <p className="text-sm text-slate-600">Calculado: {numero(fila.minimo_calculado)} mínimo y {numero(fila.maximo_calculado)} máximo.</p>
      {fila.ajuste && <p className={AVISO}>Corrección actual de {fila.ajuste.actor}: {fila.ajuste.motivo} · {fecha(fila.ajuste.fecha)}</p>}
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); guardar('PUT'); }}>
        <label className="block text-sm">Mínimo (piezas)
          <input className={CAMPO} type="number" min="0" step="1" required value={minimo} onChange={e => setMinimo(e.target.value)} />
        </label>
        <label className="block text-sm">Máximo (piezas)
          <input className={CAMPO} type="number" min={minimo || '0'} step="1" required value={maximo} onChange={e => setMaximo(e.target.value)} />
        </label>
        <label className="block text-sm">Motivo de la corrección o de quitarla
          <textarea className={CAMPO} required minLength={3} maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} />
        </label>
        {error && <p role="alert" className={ERROR}>{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOTON} disabled={guardando} onClick={cerrar}>Cancelar</button>
          {fila.ajuste && <button type="button" className={BOTON} disabled={guardando} onClick={() => guardar('DELETE')}>Quitar corrección</button>}
          <button className={PRIMARIO} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar corrección'}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export default function Resurtido({ usuario }) {
  const verTodas = usuario?.permisos?.includes('ver_todas_las_sucursales');
  const puedeCorregir = usuario?.permisos?.includes('corregir_minimos_resurtido');
  const [tienda, setTienda] = useState(verTodas ? 'todas' : String(usuario?.sucursal_id));
  const [marca, setMarca] = useState(''), [lista, setLista] = useState(''), [estado, setEstado] = useState(''), [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1), [version, setVersion] = useState(0), [editando, setEditando] = useState(null);
  const [datos, setDatos] = useState(null), [cargando, setCargando] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCargando(true); setError(''); setDatos(null);
    const parametros = new URLSearchParams({ sucursal_id: tienda, marca, lista, estado, q, pagina: String(pagina) });
    pedir(`/resurtido?${parametros}`, { signal: controller.signal }).then(d => {
      if (!controller.signal.aborted) setDatos(d);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [tienda, marca, lista, estado, q, pagina, version]);
  const cambiar = setter => e => { setter(e.target.value); setPagina(1); };
  return <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Mínimos y máximos</h1>
        <p className="mt-1 text-sm text-slate-600">JR y Solcor · {verTodas ? 'Las cuatro tiendas' : nombreTienda(tienda)}</p>
      </div>
      <button className={BOTON} disabled={cargando} onClick={() => setVersion(v => v + 1)}>Actualizar lista</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {verTodas && <label className="text-sm">Tienda<select className={CAMPO} value={tienda} onChange={cambiar(setTienda)}>
        <option value="todas">Todas las tiendas</option>{TIENDAS.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
      </select></label>}
      <label className="text-sm">Marca<select className={CAMPO} value={marca} onChange={cambiar(setMarca)}>
        <option value="">Todas las marcas</option><option>JR</option><option>SOLCOR</option>
      </select></label>
      <label className="text-sm">Lista<select className={CAMPO} value={lista} onChange={cambiar(setLista)}>
        <option value="">Todas las listas</option><option value="calculado">Calculados</option>
        <option value="sin_historia">Revisar: sin historia por falta de existencia</option><option value="no_se_mueve">No se mueve</option>
      </select></label>
      <label className="text-sm">Estado<select className={CAMPO} value={estado} onChange={cambiar(setEstado)}>
        <option value="">Todos los estados</option>{['agotado', 'bajo_minimo', 'bien', 'sobre_maximo'].map(e =>
          <option key={e} value={e}>{textoEstado({ estado: e })}</option>)}
      </select></label>
      <label className="text-sm">Buscar clave o producto<input className={CAMPO} value={q} onChange={cambiar(setQ)} /></label>
    </div>
    {!!datos?.tiendas_atrasadas?.length && <p role="status" className={AVISO}>
      Datos atrasados: {datos.tiendas_atrasadas.map(nombreTienda).join(', ')}. Sus mínimos y máximos no se han recalculado.
    </p>}
    {error && <p role="alert" className={ERROR}>{error}</p>}
    {cargando && <p role="status">Cargando mínimos y máximos…</p>}
    {datos && <>
      <p className="text-xs text-slate-600">Último cálculo: {fecha(datos.calculado_en)} · {datos.total} productos</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>{['Tienda', 'Clave', 'Producto', 'Hay', 'Mínimo', 'Máximo', 'Vende al mes', 'Días en cero (año)', 'Estado', ''].map((h, i) =>
            <th className={CELDA} key={i} scope="col">{h}</th>)}</tr></thead>
          <tbody>{datos.filas.map(f => <tr key={`${f.sucursal_id}:${f.clave}`}>
            <td className={CELDA}>{nombreTienda(f.sucursal_id)}</td><td className={CELDA}>{f.clave}</td>
            <td className={CELDA}><p>{f.descripcion}</p><p className="mt-1 text-xs text-slate-600">{textoCalidad(f)}</p>
              {f.ya_no_es_marca && <p className="mt-1 text-xs text-amber-800">Ya no es de la marca; conserva su corrección.</p>}
              {f.ajuste && <p className="mt-1 flex items-start gap-1 text-xs text-blue-800">
                <Pencil size={14} aria-hidden="true" /><span>Corregido a mano por {f.ajuste.actor}: {f.ajuste.motivo} · {fecha(f.ajuste.fecha)}</span>
              </p>}
            </td>
            {[f.existencia, f.minimo, f.maximo, f.venta_mes].map((v, i) => <td key={i} className={`${CELDA} tabular-nums`}>{numero(v)}</td>)}
            <td className={CELDA}>{f.dias_en_cero}</td><td className={CELDA}>{textoEstado(f)}</td>
            <td className={CELDA}>{puedeCorregir && <button className={BOTON} onClick={() => setEditando(f)}>Corregir</button>}</td>
          </tr>)}</tbody>
        </table>
        {!datos.filas.length && <p className="p-6 text-center text-slate-600">No hay productos con estos filtros.</p>}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button className={BOTON} disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
        <span className="text-sm">Página {pagina} de {Math.max(1, Math.ceil(datos.total / 100))}</span>
        <button className={BOTON} disabled={pagina * 100 >= datos.total} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
      </div>
    </>}
    {editando && <Correccion fila={editando} cerrar={() => setEditando(null)} guardado={() => {
      setEditando(null); setVersion(v => v + 1);
    }} />}
  </main>;
}
