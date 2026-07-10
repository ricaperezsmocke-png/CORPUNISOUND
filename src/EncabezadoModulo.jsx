import React from "react";
import { ChevronLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SelectorSucursal from "./SelectorSucursal.jsx";

const TITULOS = {
  pos:        "Punto de Venta",
  inventario: "Inventario y Productos",
  traspasos:  "Traspasos entre Sucursales",
  compras:    "Recepción de Compras",
  roles:      "Roles y Personal",
  crm:        "CRM",
  corte:      "Corte de Caja",
  ml:         "MercadoLibre",
};

export default function EncabezadoModulo({ vista, usuario, onVolver, onSalir }) {
  return (
    <header
      className="shrink-0 shadow-md flex items-center justify-between px-4 py-2 gap-3"
      style={{ background: "linear-gradient(90deg, #1a7fe8 0%, #1262b8 100%)" }}
    >
      {/* Izquierda: logo + volver + título */}
      <div className="flex items-center gap-3 min-w-0">
        <img
          src="/logo-unisound.jpg"
          alt="Unisound"
          className="h-9 object-contain bg-white rounded-lg px-2 py-0.5 shrink-0"
        />
        <Button
          onClick={onVolver}
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/20 gap-1.5 shrink-0 px-2"
        >
          <ChevronLeft size={15} />
          Inicio
        </Button>
        <span className="text-white font-semibold text-sm truncate">
          {TITULOS[vista] || ""}
        </span>
      </div>

      {/* Derecha: sucursal + usuario + salir */}
      <div className="flex items-center gap-3 shrink-0">
        <SelectorSucursal usuario={usuario} onCambio={() => window.location.reload()} />
        {usuario && (
          <div className="text-right hidden sm:block">
            <div className="text-white text-xs font-semibold leading-tight">{usuario.nombre}</div>
            <div className="text-blue-100 text-[11px] leading-tight">{usuario.rol}</div>
          </div>
        )}
        <Button
          onClick={onSalir}
          size="sm"
          variant="secondary"
          className="bg-white/20 hover:bg-white/30 text-white border-0 gap-1.5"
        >
          <LogOut size={13} />
          <span className="hidden sm:inline">Salir</span>
        </Button>
      </div>
    </header>
  );
}
