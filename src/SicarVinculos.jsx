import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';

const BOTON = 'rounded border border-slate-400 bg-white px-3 py-2 text-sm disabled:opacity-50';
const TARJETA = 'space-y-3 rounded-lg border border-slate-300 bg-white p-4';
const ESTADOS = { pendiente: 'Unión pendiente', confirmado: 'Unión confirmada', separado: 'Unión deshecha',
  revision: 'Requiere revisión', externo: 'Ficha externa sin coincidencia' };
// fecha_local de SICAR viene sin zona (hora de la tienda): se muestra tal cual, solo el día.
const fecha = valor => (valor ? new Date(`${String(valor).slice(0, 10)}T12:00:00`).toLocaleDateString('es-MX') : 'Sin compras');
const importe = centavos => (centavos / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

async function consultar(ruta, opciones) {
  const respuesta = await apiFetch(ruta, opciones);
  const datos = await respuesta.json();
  if (!respuesta.ok) {
    const error = new Error(datos.error || 'No se pudo cargar la cola.');
    error.status = respuesta.status;
    throw error;
  }
  return datos;
}

function Identidad({ item, ocupado, resolver, tiendas }) {
  const [motivo, setMotivo] = useState('');
  const tieneUnion = ['pendiente', 'confirmado'].includes(item.estado);
  return <article className={TARJETA}>
    <div>
      <h4 className="font-semibold">
        {item.nombre} · {tiendas.find(t => Number(t.id) === Number(item.sucursal_id))?.nombre || `Tienda ${item.sucursal_id}`}
      </h4>
      <p className="text-sm">SICAR {item.cli_id} · {item.telefono || item.celular || 'Sin teléfono'}</p>
      <p className="font-semibold">{ESTADOS[item.estado] || item.estado}</p>
      <p>{item.motivo}</p>
      {item.cliente_nombre && <p>Cliente CRM: {item.cliente_nombre}</p>}
      <p>{item.numero_compras} {item.numero_compras === 1 ? 'compra' : 'compras'} · {importe(item.monto_centavos)} · Última: {fecha(item.ultima_compra)}</p>
      <p className="text-sm text-slate-600">Compras de esta identidad y tienda. La fuente SICAR es de consulta.</p>
      {item.estado === 'pendiente' && <p className="text-amber-800">Estas compras ya están vinculadas; falta revisar la unión.</p>}
    </div>
    {tieneUnion && item.puede_resolver && <div className="space-y-2">
      <label className="block">Motivo de la decisión
        <input className="mt-1 w-full rounded border border-slate-400 p-2" maxLength={500}
          value={motivo} onChange={e => setMotivo(e.target.value)} disabled={ocupado} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={BOTON} disabled={ocupado || !motivo.trim()}
          onClick={() => resolver(item, 'confirmar', motivo)}>Confirmar unión</button>
        <button className={BOTON} disabled={ocupado || !motivo.trim()}
          onClick={() => resolver(item, 'deshacer', motivo)}>Deshacer unión</button>
      </div>
      <p className="text-sm">Deshacer devuelve las compras a la ficha SICAR y evita que el siguiente lote las vuelva a unir.</p>
    </div>}
    {tieneUnion && !item.puede_resolver && <p>Esta unión requiere revisión de un Administrador.</p>}
    {item.estado === 'revision' && <p>Sin unión automática. Revisa los teléfonos en las fuentes antes de volver a evaluar.</p>}
  </article>;
}

export default function SicarVinculos() {
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState({ items: [], siguiente: null });
  const [ocupado, setOcupado] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [tiendas, setTiendas] = useState([]);
  useEffect(() => {
    let activo = true;
    consultar('/sucursales').then(resultado => { if (activo) setTiendas(resultado); })
      .catch(() => { if (activo) setError('No se pudieron cargar los nombres de las tiendas.'); });
    return () => { activo = false; };
  }, []);
  const cargar = useCallback(async () => {
    const resultado = await consultar(`/sicar/vinculos?cursor=${pagina}`);
    setDatos(resultado);
  }, [pagina]);
  useEffect(() => {
    let activo = true;
    setOcupado(true);
    setError('');
    consultar(`/sicar/vinculos?cursor=${pagina}`)
      .then(resultado => { if (activo) setDatos(resultado); })
      .catch(e => { if (activo) { setError(e.message); setDatos({ items: [], siguiente: null }); } })
      .finally(() => { if (activo) setOcupado(false); });
    return () => { activo = false; };
  }, [pagina]);

  async function resolver(item, accion, motivo) {
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      await consultar(`/sicar/vinculos/${item.sucursal_id}/${encodeURIComponent(item.cli_id)}/resolver`, {
        method: 'POST', body: JSON.stringify({ accion, expected_version: item.version, motivo }),
      });
      setAviso(accion === 'confirmar' ? 'Unión confirmada.' : 'Unión deshecha; las compras permanecen en SICAR.');
      await cargar();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) {
        try { await cargar(); } catch { setDatos({ items: [], siguiente: null }); }
      }
    } finally { setOcupado(false); }
  }

  return <section className="space-y-4" aria-label="Cola de revisión SICAR">
    <h3 className="text-lg font-bold">Vínculos y cola de revisión</h3>
    <p>Confirma o deshaz las uniones por teléfono. Las decisiones no cambian cobros, inventario ni datos del cliente nativo.</p>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {aviso && <p role="status">{aviso}</p>}
    {ocupado && <p role="status">Cargando…</p>}
    {!ocupado && !error && !datos.items.length && <p>No hay identidades SICAR en esta página.</p>}
    {datos.items.map(item => <Identidad key={`${item.sucursal_id}:${item.cli_id}:${item.version}`}
      item={item} ocupado={ocupado} resolver={resolver} tiendas={tiendas} />)}
    <div className="flex flex-wrap gap-2">
      <button className={BOTON} disabled={ocupado || pagina === 0} onClick={() => setPagina(Math.max(0, pagina - 50))}>Anterior</button>
      <button className={BOTON} disabled={ocupado || datos.siguiente === null} onClick={() => setPagina(datos.siguiente)}>Siguiente</button>
      <button className={BOTON} disabled={ocupado} onClick={async () => {
        setOcupado(true); setError('');
        try { await cargar(); } catch (e) { setError(e.message); }
        finally { setOcupado(false); }
      }}>Actualizar cola</button>
    </div>
  </section>;
}
