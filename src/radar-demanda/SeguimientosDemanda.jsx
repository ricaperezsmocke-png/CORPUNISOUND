import React from "react";
import { CalendarClock, Phone } from "lucide-react";
import { ESTADOS_TERMINALES } from "./radarDemandaApi";
import { fechaCorta, nombreContacto, nombreProducto } from "./MisDemandas";

export default function SeguimientosDemanda({ demandas, clientes, cargando, error }) {
  const pendientes = demandas.filter((d) => d.requiere_seguimiento && !ESTADOS_TERMINALES.has(d.estado));
  if (cargando) return <p className="py-12 text-center text-sm text-slate-500">Cargando seguimientos…</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!pendientes.length) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center"><CalendarClock className="mx-auto mb-2 text-slate-300" size={34} /><p className="font-medium text-slate-600">No hay seguimientos pendientes.</p></div>;
  return <div className="space-y-3">{pendientes.map((d) => { const cliente = clientes.find((c) => Number(c.id) === Number(d.cliente_id)); const telefono = d.telefono_contacto || cliente?.celular || cliente?.telefono; return <article key={d.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-800">{nombreProducto(d)}</h3><p className="mt-1 text-sm text-slate-600">{nombreContacto(d, clientes)}</p>{telefono && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Phone size={13} />{telefono}</p>}</div><div className="sm:text-right"><span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-800">{d.estado.replaceAll("_", " ")}</span><p className="mt-2 text-xs text-slate-500">Seguimiento: {fechaCorta(d.fecha_seguimiento)}</p></div></article>; })}</div>;
}

