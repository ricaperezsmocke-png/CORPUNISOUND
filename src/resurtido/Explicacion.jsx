import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { MESES, textoExplicacion, textoPedidoEspecial, textoSugerido, textoTemporada } from './resurtido';
const CELDA = 'border-b border-slate-200 px-3 py-2 text-left tabular-nums';

export default function Explicacion({ fila, tienda, cerrar }) {
  const [datos, setDatos] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ sucursal_id: fila.sucursal_id, clave: fila.clave });
    setDatos(null); setError('');
    async function cargar() {
      try {
        const res = await apiFetch(`/resurtido/explicacion?${query}`, { signal: controller.signal });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'No se pudo cargar la explicación.');
        if (!controller.signal.aborted) setDatos(d);
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
    }
    cargar();
    return () => controller.abort();
  }, [fila.sucursal_id, fila.clave]);
  return <Dialog open onOpenChange={abierto => { if (!abierto) cerrar(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
      <DialogTitle>Por qué tiene este mínimo y máximo</DialogTitle>
      <DialogDescription>{tienda} · {fila.clave} · {fila.descripcion}</DialogDescription>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!datos && !error && <p role="status">Cargando explicación…</p>}
      {datos && <div className="space-y-4 text-sm">
        <p className="rounded-md bg-blue-50 p-4 text-blue-950">{textoExplicacion(datos)}</p>
        {datos.piezas_pedido_especial > 0 && <p>{textoPedidoEspecial(datos)}</p>}
        <p className="rounded-md bg-green-50 p-3 font-medium text-green-900">{textoSugerido(datos)}</p>
        {datos.en_camino_viejo > 0 && <p className="text-amber-800">
          Hay {datos.en_camino_viejo} piezas enviadas hace más de 45 días que la tienda no ha recibido: no se descuentan del pedido.
        </p>}
        <p>Existencia actual: {datos.existencia ?? 'sin registro'} piezas. Venta diaria final: {datos.venta_diaria ?? 'sin cálculo'} piezas.</p>
        <p>Ventana: {datos.desde} al {datos.hasta}. Días en cero: {datos.ceros_observados} observados y {datos.ceros_reconstruidos} reconstruidos.</p>
        {!!datos.dias_sin_dato && <p className="text-amber-800">Hay {datos.dias_sin_dato} días sin registro de existencia en esta ventana.</p>}
        {datos.corregido && <p>El mínimo y máximo mostrados incluyen la corrección manual.</p>}
        {datos.ya_no_la_maneja && <p>Ya no la maneja la tienda; conserva su corrección.</p>}
        <p className="text-slate-600">{textoTemporada(datos)}. La temporada promedia el mes indicado y el siguiente.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {datos.indices.map((indice, i) => <p key={i} className="rounded border p-2">{MESES[i]}: ×{indice}</p>)}
        </div>
        <p>Últimos doce meses de calendario; el último llega al {datos.hasta}. Todo se muestra en piezas.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{['Mes', 'Vendidas', 'Entradas por traspaso', 'Entradas por compra', 'Salidas por traspaso', 'Existencia al cierre'].map(h =>
              <th className={CELDA} key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{datos.serie_mensual.map(m => <tr key={m.mes}>
              {[m.mes, m.piezas_vendidas, m.entradas_traspaso, m.entradas_compra, m.salidas_traspaso, m.existencia_cierre ?? 'Sin registro']
                .map((valor, i) => <td className={CELDA} key={i}>{valor}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-slate-600">Los cierres son aproximados: se reconstruyen con los movimientos recibidos.
          Las ventas excluyen cuentas internas; sus salidas sí se consideran para reconstruir existencia.</p>
      </div>}
    </DialogContent>
  </Dialog>;
}
