import React from "react";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SelectorSucursal from "./SelectorSucursal.jsx";
import SelectorCaja from "./SelectorCaja.jsx";

const TITULOS = {
  dashboard:  "Inicio",
  pos:        "Punto de Venta",
  inventario: "Inventario y Productos",
  traspasos:  "Traspasos entre Sucursales",
  garantias:  "Garantías",
  gastos:     "Gastos",
  estado_cuenta: "Estado de Cuenta",
  roles:      "Roles y Personal",
  crm:        "CRM",
  corte:      "Corte de Caja",
  ml:         "MercadoLibre",
  reportes:   "Reportes",
  respaldos: "Respaldos",
  gerencia_ventas: "Mi Objetivo de Venta",
  radar_demanda: "Radar de Demanda",
  configuracion: "Configuración",
};

export default function EncabezadoModulo({ vista, usuario, onSalir, onAbrirMenu, menuAbierto }) {
  return (
    <header
      // flex-wrap: a 360px la fila no cabe entera con los dos selectores; que
      // envuelva a un segundo renglón en vez de apretar o esconder algo.
      className="shrink-0 shadow-md flex flex-wrap lg:flex-nowrap items-center justify-between px-4 py-2 gap-x-3 gap-y-2"
      style={{ background: "var(--encabezado-fondo)" }}
    >
      {/* Izquierda: botón de menú (solo celular) + logo + título. */}
      <div className="flex items-center gap-2 min-w-0 sm:gap-3">
        <button
          type="button"
          onClick={onAbrirMenu}
          className="lg:hidden shrink-0 flex h-11 w-11 items-center justify-center rounded-lg text-white hover:bg-white/10"
          aria-label="Abrir el menú"
          aria-expanded={!!menuAbierto}
        >
          <Menu size={20} />
        </button>
        <img
          src="/logo-unisound.jpg"
          alt="Unisound"
          className="h-9 object-contain bg-white rounded-lg px-2 py-0.5 shrink-0"
        />
        <span className="text-white font-semibold text-sm truncate">
          {TITULOS[vista] || ""}
        </span>
      </div>

      {/* Derecha: sucursal + usuario + salir */}
      <div className="flex items-center gap-3 shrink-0">
        <SelectorSucursal
          usuario={usuario}
          onCambio={() => {
            localStorage.removeItem("caja_activa");
            window.location.reload();
          }}
        />
        <SelectorCaja />
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
