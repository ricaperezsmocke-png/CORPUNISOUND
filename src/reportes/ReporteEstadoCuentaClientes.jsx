import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteEstadoCuentaClientes({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Estado de Cuenta de Clientes — en construcción
      </div>
    </div>
  );
}
