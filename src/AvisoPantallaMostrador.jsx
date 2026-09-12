import React from "react";
import { Info } from "lucide-react";

export default function AvisoPantallaMostrador() {
  return (
    <div className="lg:hidden shrink-0 flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <Info size={15} className="shrink-0" />
      <span>Esta pantalla está hecha para la tableta del mostrador o la computadora. Desde el celular se ve apretada.</span>
    </div>
  );
}
