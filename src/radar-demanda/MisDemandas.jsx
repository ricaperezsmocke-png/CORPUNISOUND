import React, { useMemo, useState } from "react";
import { CalendarDays, Eye, Package, Search } from "lucide-react";
import { MOTIVOS } from "./radarDemandaApi";

const motivos = Object.fromEntries(MOTIVOS);
const etiquetasEstado = {
  REGISTRADA: "Registrada", EN_SEGUIMIENTO: "En seguimiento", PRODUCTO_DISPONIBLE: "Producto disponible",
  CLIENTE_CONTACTADO: "Cliente contactado", CONVERTIDA: "Convertida", NO_CONVERTIDA: "No convertida", CANCELADA: "Cancelada",
};
const colorEstado = { CONVERTIDA: "bg-emerald-100 text-emerald-800", NO_CONVERTIDA: "bg-slate-200 text-slate-700", CANCELADA: "bg-red-100 text-red-700", PRODUCTO_DISPONIBLE: "bg-amber-100 text-amber-800", CLIENTE_CONTACTADO: "bg-purple-100 text-purple-800", EN_SEGUIMIENTO: "bg-blue-100 text-blue-800", REGISTRADA: "bg-slate-100 text-slate-700" };

export function nombreProducto(demanda) { return demanda.producto_nombre_registrado || demanda.producto_buscado || "Producto sin nombre"; }
export function nombreContacto(demanda, clientes) { return demanda.nombre_contacto || clientes.find((c) => Number(c.id) === Number(demanda.cliente_id))?.nombre || "Anónimo"; }
export function fechaCorta(fecha) { if (!fecha) return "Sin fecha"; const valor = String(fecha); const d = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T00:00:00`) : new Date(valor); return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("es-MX"); }

const input = "min-h-11 rounded-xl neu-campo px-3 text-sm outline-none";

export default function MisDemandas({ demandas, clientes, meta, cargando, error, onVer }) {
  const [filtros, setFiltros] = useState({ texto: "", estado: "", motivo: "", seguimiento: "", fecha: "" });
  const visibles = useMemo(() => demandas.filter((d) => {
    const q = filtros.texto.trim().toLowerCase();
    const contacto = nombreContacto(d, clientes).toLowerCase();
    if (q && !`${nombreProducto(d)} ${contacto}`.toLowerCase().includes(q)) return false;
    if (filtros.estado && d.estado !== filtros.estado) return false;
    if (filtros.motivo && d.motivo_no_venta !== filtros.motivo) return false;
    if (filtros.seguimiento === "con" && !d.requiere_seguimiento) return false;
    if (filtros.seguimiento === "sin" && d.requiere_seguimiento) return false;
    if (filtros.fecha && !String(d.fecha_registro || "").startsWith(filtros.fecha)) return false;
    return true;
  }), [demandas, clientes, filtros]);
  const cambiar = (campo, valor) => setFiltros((actual) => ({ ...actual, [campo]: valor }));
  if (cargando) return <p className="py-12 text-center text-sm text-slate-500">Cargando demandas…</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!demandas.length) return <div className="rounded-2xl border border-dashed border-slate-300 neu-panel py-12 text-center"><Package className="mx-auto mb-2 text-slate-300" size={34} /><p className="font-medium text-slate-600">Todavía no hay demandas registradas.</p></div>;
  return <div className="space-y-4"><section className="rounded-2xl neu p-3 shadow-sm"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><label className="relative sm:col-span-2 lg:col-span-1"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input aria-label="Buscar demandas" className={`${input} w-full pl-9`} value={filtros.texto} onChange={(e) => cambiar("texto", e.target.value)} placeholder="Producto o cliente" /></label><select aria-label="Filtrar por estado" className={input} value={filtros.estado} onChange={(e) => cambiar("estado", e.target.value)}><option value="">Todos los estados</option>{(meta?.estados || Object.keys(etiquetasEstado)).map((estado) => <option key={estado} value={estado}>{etiquetasEstado[estado] || estado}</option>)}</select><select aria-label="Filtrar por motivo" className={input} value={filtros.motivo} onChange={(e) => cambiar("motivo", e.target.value)}><option value="">Todos los motivos</option>{MOTIVOS.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}</select><select aria-label="Filtrar por seguimiento" className={input} value={filtros.seguimiento} onChange={(e) => cambiar("seguimiento", e.target.value)}><option value="">Todo seguimiento</option><option value="con">Con seguimiento</option><option value="sin">Sin seguimiento</option></select><input aria-label="Filtrar por fecha" type="date" className={input} value={filtros.fecha} onChange={(e) => cambiar("fecha", e.target.value)} /></div></section>{!visibles.length ? <p className="rounded-xl neu-panel p-8 text-center text-sm text-slate-500">No hay demandas con esos filtros.</p> : <div className="grid gap-3 lg:grid-cols-2">{visibles.map((d) => <article key={d.id} className="neu rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-800">{nombreProducto(d)}</h3><p className="mt-1 text-xs text-slate-500">{motivos[d.motivo_no_venta] || d.motivo_no_venta} · Cantidad: {d.cantidad}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${colorEstado[d.estado] || colorEstado.REGISTRADA}`}>{etiquetasEstado[d.estado] || d.estado}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{nombreContacto(d, clientes)}</span><span className="flex items-center gap-1"><CalendarDays size={13} />{fechaCorta(d.fecha_registro)}</span><button onClick={() => onVer(d.id)} className="flex min-h-10 items-center gap-1 rounded-lg px-3 font-bold text-blue-700 hover:bg-blue-50"><Eye size={15} /> Ver</button></div></article>)}</div>}</div>;
}
