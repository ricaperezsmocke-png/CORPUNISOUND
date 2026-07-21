import React from "react";
import { Eye, Download, Printer } from "lucide-react";

function BotonBarra({ icono: Icono, etiqueta, onClick, tono = "slate" }) {
  const tonos = { slate: "text-[#1a7fe8]", verde: "text-emerald-600" };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors"
    >
      <Icono size={18} className={tonos[tono]} />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

export default function BarraAccionesReporte({ onConsultar, onExportarExcel }) {
  return (
    <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0 no-imprimir">
      <BotonBarra icono={Eye} etiqueta="Consultar" tono="verde" onClick={onConsultar} />
      <BotonBarra icono={Download} etiqueta="Excel" onClick={onExportarExcel} />
      <BotonBarra icono={Printer} etiqueta="Imprimir" onClick={() => window.print()} />
    </div>
  );
}
