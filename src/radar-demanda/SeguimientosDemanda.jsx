import React from "react";
import { CalendarClock, Eye, Phone } from "lucide-react";
import { ESTADOS_TERMINALES } from "./radarDemandaApi";
import { fechaCorta, nombreContacto, nombreProducto } from "./MisDemandas";

function grupoFecha(fecha) {
  if (!fecha) return "sin";
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const valor = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(valor.getTime())) return "sin";
  if (valor < hoy) return "vencidos";
  if (valor.getTime() === hoy.getTime()) return "hoy";
  return "proximos";
}
function diasDesde(fecha) { const valor = new Date(fecha); return Number.isNaN(valor.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - valor.getTime()) / 86400000)); }
const grupos = [["vencidos", "🔴 Vencidos"], ["hoy", "🟠 Hoy"], ["proximos", "🟡 Próximos"], ["sin", "⚪ Sin fecha"]];

export default function SeguimientosDemanda({ demandas, clientes, cargando, error, onVer }) {
  const pendientes = demandas.filter((d) => d.requiere_seguimiento && !ESTADOS_TERMINALES.has(d.estado));
  if (cargando) return <p className="py-12 text-center text-sm text-slate-500">Cargando seguimientos…</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!pendientes.length) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center"><CalendarClock className="mx-auto mb-2 text-slate-300" size={34} /><p className="font-medium text-slate-600">No hay seguimientos pendientes.</p></div>;
  return <div className="space-y-6">{grupos.map(([clave, titulo]) => { const items = pendientes.filter((d) => grupoFecha(d.fecha_seguimiento) === clave); return <section key={clave}><h2 className="mb-2 text-sm font-extrabold text-slate-700">{titulo} <span className="text-slate-400">({items.length})</span></h2>{items.length ? <div className="space-y-3">{items.map((d) => { const cliente = clientes.find((c) => Number(c.id) === Number(d.cliente_id)); const telefono = d.telefono_contacto || cliente?.celular || cliente?.telefono; return <article key={d.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-800">{nombreProducto(d)}</h3><p className="mt-1 text-sm text-slate-600">{nombreContacto(d, clientes)}</p>{telefono && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Phone size={13} />{telefono}</p>}<p className="mt-1 text-xs text-slate-400">{diasDesde(d.fecha_registro)} días desde registro</p></div><div className="flex items-end justify-between gap-3 sm:flex-col"><div className="sm:text-right"><span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-800">{d.estado.replaceAll("_", " ")}</span><p className="mt-2 text-xs text-slate-500">Seguimiento: {fechaCorta(d.fecha_seguimiento)}</p></div><button onClick={() => onVer(d.id)} className="flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-bold text-blue-700 hover:bg-blue-50"><Eye size={15} /> Ver</button></div></article>; })}</div> : <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-xs text-slate-400">Sin seguimientos en este grupo.</div>}</section>; })}</div>;
}
