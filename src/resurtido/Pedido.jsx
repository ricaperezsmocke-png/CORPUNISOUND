import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { piezas, textoWhatsApp, textoEstadoPedido, necesitaMotivo, cambiosTienda, estadoTiendas, textoSobra } from './resurtido';

const TIENDAS = [[1, 'Ocosingo'], [2, 'Yajalón'], [3, 'San Cristóbal'], [4, 'Palenque']];
const nombreTienda = id => TIENDAS.find(([n]) => n === Number(id))?.[1] || String(id);
const CAMPO = 'mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const NUMERO = 'w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900';
const BOTON = 'rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50';
const PRIMARIO = 'rounded-md bg-blue-700 px-3 py-2 text-sm text-white hover:bg-blue-800 disabled:opacity-50';
const CELDA = 'border-b border-slate-200 px-3 py-2 text-left align-top tabular-nums';
const AVISO = 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';
const ERROR = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800';
const BIEN = 'rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900';
const fecha = v => v ? new Date(v).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '';
const hoy = () => new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
const TEXTO_TIENDA = { listo: 'Visto bueno dado', pendiente: 'Falta visto bueno', fuera_de_tiempo: 'Fuera de tiempo (no entra)' };

async function pedir(ruta, opciones) {
  const res = await apiFetch(ruta, opciones), datos = await res.json();
  if (!res.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}
const enviar = (ruta, method, cuerpo) => pedir(ruta, { method, body: JSON.stringify(cuerpo || {}) });

function imprimir(titulo, texto) {
  const ventana = window.open('', '_blank');
  if (!ventana) return false;
  ventana.document.title = titulo;
  const pre = ventana.document.createElement('pre');
  pre.style.cssText = 'font: 14px/1.5 sans-serif; white-space: pre-wrap;';
  pre.textContent = texto;
  ventana.document.body.appendChild(pre);
  ventana.print();
  return true;
}

// Lista al proveedor del pedido guardado: copiar a WhatsApp o imprimir. El sistema no manda nada.
function ListaPedido({ id, alcance, cerrar }) {
  const [datos, setDatos] = useState(null), [reparto, setReparto] = useState(null), [mensaje, setMensaje] = useState('');
  const [error, setError] = useState(''), [texto, setTexto] = useState('');
  useEffect(() => {
    pedir(`/resurtido/pedidos/${id}/proveedor?${alcance}`).then(setDatos).catch(e => setError(e.message));
    pedir(`/resurtido/pedidos/${id}/reparto?${alcance}`).then(r => setReparto(r.tiendas)).catch(e => setError(e.message));
  }, [id, alcance]);
  const contenido = () => textoWhatsApp(datos, hoy());
  async function copiar() {
    try { await navigator.clipboard.writeText(contenido()); setMensaje('Copiado. Pégalo en WhatsApp.'); }
    catch { setTexto(contenido()); setMensaje('No se pudo copiar solo: selecciona el texto de abajo y cópialo.'); }
  }
  function imprimirTodo() {
    const hoja = (reparto || []).map(t => [`\n${nombreTienda(t.sucursal_id)}`,
      ...t.renglones.map(r => `  ${r.clave} ${r.descripcion}: ${piezas(r.pedido)}`)].join('\n')).join('\n');
    if (!imprimir(`Pedido ${datos.marca}`, `${contenido()}\n\nHoja de reparto${hoja}`)) setMensaje('El navegador bloqueó la ventana de impresión.');
  }
  return <Dialog open onOpenChange={abierto => { if (!abierto) cerrar(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
      <DialogTitle>Lista para el proveedor</DialogTitle>
      <DialogDescription>Cópiala o imprímela y mándala tú. El sistema no envía nada al proveedor.</DialogDescription>
      {error && <p role="alert" className={ERROR}>{error}</p>}
      {!datos && !error && <p role="status">Armando la lista…</p>}
      {datos && <>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARIO} onClick={copiar}>Copiar para WhatsApp</button>
          <button type="button" className={BOTON} onClick={imprimirTodo}>Imprimir con hoja de reparto</button>
        </div>
        {mensaje && <p role="status" className="text-sm text-green-800">{mensaje}</p>}
        {texto && <textarea className="h-40 w-full rounded-md border p-2 text-sm" readOnly value={texto} />}
        <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm">{contenido()}</pre>
      </>}
    </DialogContent>
  </Dialog>;
}

function Compras({ id, alcance, recargar }) {
  const [datos, setDatos] = useState(null), [error, setError] = useState(''), [ocupado, setOcupado] = useState(false);
  useEffect(() => { pedir(`/resurtido/pedidos/${id}/compras?${alcance}`).then(setDatos).catch(e => setError(e.message)); }, [id, alcance]);
  async function confirmar(com_id) {
    setOcupado(true); setError('');
    try { await enviar(`/resurtido/pedidos/${id}/compra?${alcance}`, 'POST', { com_id }); recargar(); }
    catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  return <section className="space-y-2">
    <h3 className="font-semibold">Compra de CEDIS al proveedor</h3>
    <p className="text-xs text-slate-600">El sistema solo propone compras; confírmala tú si es la de este pedido.</p>
    {error && <p role="alert" className={ERROR}>{error}</p>}
    {datos?.motivo && <p className="text-sm text-slate-600">{datos.motivo}</p>}
    {datos && !datos.motivo && !datos.candidatas.length && <p className="text-sm text-slate-600">Todavía no aparece una compra candidata.</p>}
    {datos?.candidatas.map(c => <div key={c.com_id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      <span>Compra {c.folio} · {c.fecha} · claves del pedido: {c.claves_del_pedido.join(', ')}</span>
      {!!c.por_aclarar.length && <span className="text-amber-800">Por aclarar (no están en el pedido): {c.por_aclarar.join(', ')}</span>}
      <button type="button" className={BOTON} disabled={ocupado} onClick={() => confirmar(c.com_id)}>Es la de este pedido</button>
    </div>)}
  </section>;
}

export default function Pedido({ usuario, tienda }) {
  const permisos = usuario?.permisos || [];
  const verTodas = permisos.includes('ver_todas_las_sucursales'), puedeAprobar = permisos.includes('aprobar_pedido_resurtido');
  const puedeVistoBueno = permisos.includes('dar_visto_bueno_resurtido');
  const alcance = new URLSearchParams({ sucursal_id: verTodas ? tienda : String(usuario?.sucursal_id) }).toString();
  const [marca, setMarca] = useState('JR'), [lista, setLista] = useState(null), [id, setId] = useState(null);
  const [detalle, setDetalle] = useState(null), [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const [version, setVersion] = useState(0), [ocupado, setOcupado] = useState(false), [proveedor, setProveedor] = useState(false);
  const [editar, setEditar] = useState(verTodas ? '' : String(usuario?.sucursal_id));
  const [valores, setValores] = useState({}), [motivos, setMotivos] = useState({}), [referencia, setReferencia] = useState('');
  useEffect(() => {
    setLista(null); setError('');
    pedir(`/resurtido/pedidos?${new URLSearchParams({ marca })}&${alcance}`).then(d => {
      setLista(d); setId(actual => d.pedidos.some(p => p.id === actual) ? actual : d.pedidos[0]?.id ?? null);
    }).catch(e => setError(e.message));
  }, [marca, alcance, version]);
  useEffect(() => {
    setDetalle(null); setValores({}); setMotivos({});
    if (id) pedir(`/resurtido/pedidos/${id}?${alcance}`).then(setDetalle).catch(e => setError(e.message));
  }, [id, alcance, version]);
  async function accion(fn, exito) {
    setOcupado(true); setError(''); setAviso('');
    try { const r = await fn(); setAviso(typeof exito === 'function' ? exito(r) : exito); setVersion(v => v + 1); }
    catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  const p = detalle?.pedido, editable = p && ['borrador', 'en_revision'].includes(p.estado);
  const tiendaEdicion = Number(editar), propios = (detalle?.renglones || []).filter(r => r.sucursal_id === tiendaEdicion && r.estado === 'activo');
  const cambios = cambiosTienda(propios, valores, motivos);
  const faltaMotivo = cambios.some(c => necesitaMotivo(propios.find(r => r.clave === c.clave), c.pedido) && c.motivo.length < 3);
  const claves = [...new Set((detalle?.renglones || []).map(r => r.clave))];
  const columnas = [...new Set((detalle?.renglones || []).map(r => r.sucursal_id))].sort();
  const cuerpo = extra => ({ sucursal_id: tiendaEdicion, cambios, ...extra });
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Marca<select className={CAMPO} value={marca} onChange={e => setMarca(e.target.value)}>
        <option>JR</option><option>SOLCOR</option></select></label>
      {lista && <label className="text-sm">Pedido<select className={CAMPO} value={id ?? ''} onChange={e => setId(Number(e.target.value))}>
        {!lista.pedidos.length && <option value="">Sin pedidos</option>}
        {lista.pedidos.map(x => <option key={x.id} value={x.id}>
          {x.periodo} · {x.tipo === 'extra' ? 'extra' : 'mensual'} · {textoEstadoPedido(x.estado)}</option>)}
      </select></label>}
      {puedeAprobar && <button type="button" className={PRIMARIO} disabled={ocupado} onClick={() => accion(
        () => enviar(`/resurtido/pedidos?${alcance}`, 'POST', { marca }),
        r => r.creado ? 'Borrador armado.' : 'Ya existía el borrador de este mes; se muestra ese.')}>Armar borrador ahora</button>}
    </div>
    {lista?.pausados && <div className={AVISO}>
      <p>Los pedidos están pausados porque se restauró un respaldo: el sistema no arma borradores solo.</p>
      {puedeAprobar && <button type="button" className={`${BOTON} mt-2`} disabled={ocupado}
        onClick={() => accion(() => enviar(`/resurtido/pedidos/reactivar?${alcance}`, 'POST'), 'Pedidos reactivados.')}>Reactivar pedidos</button>}
    </div>}
    {error && <p role="alert" className={ERROR}>{error}</p>}
    {aviso && <p role="status" className={BIEN}>{aviso}</p>}
    {!lista && !error && <p role="status">Cargando pedidos…</p>}
    {lista && !lista.pedidos.length && <p className="text-slate-600">No hay pedidos de {marca} todavía.</p>}
    {p && <>
      <div className="rounded-lg border border-slate-200 p-4 text-sm">
        <p className="text-lg font-semibold">Pedido {p.marca} {p.periodo}{p.tipo === 'extra' ? ' (extra)' : ''} · {textoEstadoPedido(p.estado)}</p>
        <p className="text-slate-600">Armado {fecha(p.creado_en)} por {p.nombre_creado_por || 'el sistema'}.
          {editable && ` Plazo para el visto bueno: ${fecha(p.plazo_visto_bueno)}.`}
          {p.aprobado_en && ` Aprobado ${fecha(p.aprobado_en)} por ${p.nombre_aprobado_por}.`}
          {p.enviado_en && ` Enviado ${fecha(p.enviado_en)} por ${p.nombre_enviado_por}${p.referencia_envio ? ` (${p.referencia_envio})` : ''}.`}</p>
        {!!p.tiendas_atrasadas.length && <p className={`${AVISO} mt-2`}>
          Con datos atrasados, no entraron: {p.tiendas_atrasadas.map(nombreTienda).join(', ')}.</p>}
        <ul className="mt-2 flex flex-wrap gap-3">{estadoTiendas(detalle.renglones).map(t => <li key={t.sucursal_id}>
          <strong>{nombreTienda(t.sucursal_id)}:</strong> {TEXTO_TIENDA[t.estado]}{t.marcados ? ` · ${t.marcados} subidos más del doble` : ''}
        </li>)}</ul>
      </div>
      {editable && puedeVistoBueno && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
        {verTodas && <label>Tienda que revisas<select className={CAMPO} value={editar} onChange={e => { setEditar(e.target.value); setValores({}); }}>
          <option value="">Elige</option>{columnas.map(s => <option key={s} value={s}>{nombreTienda(s)}</option>)}</select></label>}
        {!!propios.length && <>
          <button type="button" className={BOTON} disabled={ocupado || !cambios.length || faltaMotivo} onClick={() => accion(
            () => enviar(`/resurtido/pedidos/${p.id}/tienda?${alcance}`, 'PUT', cuerpo()), 'Cambios guardados. Falta tu visto bueno.')}>
            Guardar cambios</button>
          <button type="button" className={PRIMARIO} disabled={ocupado || faltaMotivo} onClick={() => accion(
            () => enviar(`/resurtido/pedidos/${p.id}/visto-bueno?${alcance}`, 'POST', cuerpo()), 'Visto bueno registrado.')}>
            Doy visto bueno</button>
          {faltaMotivo && <span className="text-red-800">Escribe el motivo de lo que subiste más del doble.</span>}
        </>}
      </div>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>{['Clave', 'Producto', ...columnas.map(nombreTienda), 'Total'].map(h =>
            <th key={h} scope="col" className={CELDA}>{h}</th>)}</tr></thead>
          <tbody>{claves.map(clave => {
            const fila = detalle.renglones.filter(r => r.clave === clave), primero = fila[0];
            const total = fila.filter(r => r.estado === 'activo').reduce((n, r) => n + r.pedido, 0);
            return <tr key={clave}>
              <td className={CELDA}>{clave}</td>
              <td className={CELDA}>{primero.descripcion}{primero.sobra && <p className="text-xs text-amber-800">{textoSobra(primero.sobra)}</p>}</td>
              {columnas.map(s => {
                const r = fila.find(x => x.sucursal_id === s);
                if (!r) return <td key={s} className={CELDA} />;
                const enEdicion = editable && puedeVistoBueno && s === tiendaEdicion && r.estado === 'activo';
                const valor = valores[clave] ?? String(piezas(r.pedido));
                return <td key={s} className={CELDA}>
                  {enEdicion ? <input aria-label={`${clave} ${nombreTienda(s)}`} className={NUMERO} type="number" min="0" step="1" value={valor}
                    onChange={e => setValores(v => ({ ...v, [clave]: e.target.value }))} /> : <span>{piezas(r.pedido)}</span>}
                  <p className="text-xs text-slate-600">sugerido {piezas(r.sugerido)}{r.llegado ? ` · llegó ${piezas(r.llegado)}` : ''}</p>
                  {r.estado === 'fuera_de_tiempo' && <p className="text-xs text-amber-800">fuera de tiempo</p>}
                  {!!r.marcado && <p className="text-xs text-red-800">Más del doble: {r.motivo_cambio}</p>}
                  {enEdicion && necesitaMotivo(r, valor) && <input aria-label={`Motivo ${clave}`} className={`${NUMERO} mt-1 w-40 text-left`}
                    placeholder="Motivo" maxLength={200} value={motivos[clave] || ''} onChange={e => setMotivos(m => ({ ...m, [clave]: e.target.value }))} />}
                </td>;
              })}
              <td className={`${CELDA} font-semibold`}>{piezas(total)}</td>
            </tr>;
          })}</tbody>
        </table>
        {!claves.length && <p className="p-6 text-center text-slate-600">Este pedido no tiene productos para tu tienda.</p>}
      </div>
      {puedeAprobar && <div className="flex flex-wrap items-end gap-3">
        {editable && <button type="button" className={PRIMARIO} disabled={ocupado}
          onClick={() => window.confirm('¿Aprobar el pedido? Después nadie puede cambiar cantidades.') && accion(
          () => enviar(`/resurtido/pedidos/${p.id}/aprobar?${alcance}`, 'POST'),
          r => `Pedido aprobado.${r.fuera_de_tiempo.length ? ` Quedaron fuera: ${r.fuera_de_tiempo.map(nombreTienda).join(', ')}.` : ''}`
            + (r.marcados ? ` Revisa los ${r.marcados} renglones subidos más del doble.` : ''))}>Aprobar pedido</button>}
        {['aprobado', 'enviado', 'surtido'].includes(p.estado) && <button type="button" className={BOTON} onClick={() => setProveedor(true)}>
          Lista para el proveedor</button>}
        {p.estado === 'aprobado' && <>
          <label className="text-sm">Cómo lo mandaste (opcional)<input className={`${CAMPO} block`} maxLength={200} value={referencia}
            onChange={e => setReferencia(e.target.value)} /></label>
          <button type="button" className={BOTON} disabled={ocupado} onClick={() => accion(
            () => enviar(`/resurtido/pedidos/${p.id}/envio?${alcance}`, 'POST', { referencia }), 'Envío registrado.')}>Ya lo mandé al proveedor</button>
        </>}
      </div>}
      {puedeAprobar && ['enviado', 'surtido'].includes(p.estado) && (p.compra_com_id
        ? <p className="text-sm">Compra de CEDIS confirmada: {p.compra_com_id} por {p.nombre_compra_confirmada_por}.</p>
        : <Compras id={p.id} alcance={alcance} recargar={() => setVersion(v => v + 1)} />)}
      <details className="rounded-lg border border-slate-200 p-3 text-sm">
        <summary className="cursor-pointer">Historial ({detalle.historial.length})</summary>
        <ul className="mt-2 space-y-1">{detalle.historial.map(h => <li key={h.id}>
          {fecha(h.fecha)} · {h.nombre_actor} · {h.accion}{h.sucursal_id ? ` · ${nombreTienda(h.sucursal_id)}` : ''}
          {h.clave ? ` · ${h.clave}` : ''}{h.antes != null ? ` · ${piezas(h.antes)} → ${piezas(h.despues)}` : ''}{h.motivo ? ` · ${h.motivo}` : ''}
        </li>)}</ul>
      </details>
    </>}
    {proveedor && p && <ListaPedido id={p.id} alcance={alcance} cerrar={() => setProveedor(false)} />}
  </section>;
}
