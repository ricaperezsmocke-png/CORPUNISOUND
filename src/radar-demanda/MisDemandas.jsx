import React from "react";
import { CalendarDays, Package } from "lucide-react";
import { MOTIVOS } from "./radarDemandaApi";

const motivos = Object.fromEntries(MOTIVOS);
const etiquetasEstado = {
  REGISTRADA: "Registrada", EN_SEGUIMIENTO: "En seguimiento", PRODUCTO_DISPONIBLE: "Producto disponible",
  CLIENTE_CONTACTADO: "Cliente contactado", CONVERTIDA: "Convertida", NO_CONVERTIDA: "No convertida", CANCELADA: "Cancelada",
};
const colorEstado = { CONVERTIDA: "bg-emerald-100 text-emerald-800", NO_CONVERTIDA: "bg-slate-200 text-slate-700", CANCELADA: "bg-red-100 text-red-700", PRODUCTO_DISPONIBLE: "bg-amber-100 text-amber-800", CLIENTE_CONTACTADO: "bg-purple-100 text-purple-800", EN_SEGUIMIENTO: "bg-blue-100 text-blue-800", REGISTRADA: "bg-slate-100 text-slate-700" };

export function nombreProducto(demanda) { return demanda.producto_nombre_registrado || demanda.producto_buscado || "Producto sin nombre"; }
export function nombreContacto(demanda, clientes) { return clientes.find((c) => Number(c.id) === Number(demanda.cliente_id))?.nombre || demanda.nombre_contacto || "Anónimo"; }
export function fechaCorta(fecha) { if (!fecha) return "Sin fecha"; const d = new Date(fecha); return Number.isNaN(d.getTime()) ? fecha : d.toLocaleDateString("es-MX"); }

export default function MisDemandas({ demandas, clientes, cargando, error }) {
  if (cargando) return <p className="py-12 text-center text-sm text-slate-500">Cargando demandas…</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!demandas.length) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center"><Package className="mx-auto mb-2 text-slate-300" size={34} /><p className="font-medium text-slate-600">Todavía no hay demandas registradas.</p></div>;
  return <div className="grid gap-3 lg:grid-cols-2">{demandas.map((d) => <article key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-800">{nombreProducto(d)}</h3><p className="mt-1 text-xs text-slate-500">{motivos[d.motivo_no_venta] || d.motivo_no_venta} · Cantidad: {d.cantidad}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${colorEstado[d.estado] || colorEstado.REGISTRADA}`}>{etiquetasEstado[d.estado] || d.estado}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{nombreContacto(d, clientes)}</span><span className="flex items-center gap-1"><CalendarDays size={13} />{fechaCorta(d.fecha_registro)}</span></div></article>)}</div>;
}

