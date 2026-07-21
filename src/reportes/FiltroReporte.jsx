import React from "react";

export default function FiltroReporte({
  fechaInicial, fechaFinal, onCambiarFechaInicial, onCambiarFechaFinal,
  sucursales = [], sucursalId, onCambiarSucursal,
  mostrarFechas = true, hijos,
}) {
  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end no-imprimir">
      {mostrarFechas && (
        <>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Fecha Inicial</label>
            <input
              type="date" value={fechaInicial}
              onChange={(e) => onCambiarFechaInicial(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Fecha Final</label>
            <input
              type="date" value={fechaFinal}
              onChange={(e) => onCambiarFechaFinal(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </>
      )}
      {onCambiarSucursal && (
        <div>
          <label className="text-xs text-slate-500 block mb-1">Sucursal</label>
          <select
            value={sucursalId} onChange={(e) => onCambiarSucursal(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      )}
      {hijos}
    </div>
  );
}
