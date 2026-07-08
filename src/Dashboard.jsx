import React from "react";
import { ShoppingCart, Users, Boxes, Sparkles, Lock, ShieldCheck, LogOut, Landmark } from "lucide-react";
import AsistenteIA from "./AsistenteIA";
import SelectorSucursal from "./SelectorSucursal.jsx";

const MODULOS = [
  { id: "pos",        nombre: "Punto de Venta",       icono: ShoppingCart, disponible: true, modulo: "pos" },
  { id: "corte",      nombre: "Corte de Caja",         icono: Landmark,     disponible: true, modulo: "corte",     permiso: "realizar_corte_caja" },
  { id: "inventario", nombre: "Inventario y Productos", icono: Boxes,        disponible: true, modulo: "inventario" },
  { id: "roles",      nombre: "Roles y Personal",       icono: ShieldCheck,  disponible: true, modulo: "admin" },
  { id: "crm",        nombre: "CRM",                    icono: Users,        disponible: true, modulo: "crm" },
];

export default function Dashboard({ onEntrarModulo, usuario, onSalir }) {
  const modulosVisibles = MODULOS.filter((m) => {
    const moduloOk = !usuario?.modulos || usuario.modulos.includes(m.modulo);
    const permisoOk = !m.permiso || !usuario?.permisos || usuario.permisos.includes(m.permiso);
    return moduloOk && permisoOk;
  });

  return (
    <div className="w-full h-full flex flex-col bg-uni-graylight">

      {/* Encabezado */}
      <header className="bg-uni-blue text-white px-5 py-3 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <img src="/logo-unisound.jpg" alt="Unisound" className="h-10 object-contain bg-white rounded-lg px-1" />
          <div>
            <div className="font-semibold text-sm leading-tight">Asistente de Negocio</div>
            <div className="text-[11px] text-blue-100 leading-tight">Pregunta lo que necesites o entra a un módulo</div>
          </div>
        </div>

        {usuario && (
          <div className="flex items-center gap-3 text-xs">
            <SelectorSucursal usuario={usuario} onCambio={() => window.location.reload()} />
            <div className="text-right leading-tight">
              <div className="font-semibold">{usuario.nombre}</div>
              <div className="text-blue-100">{usuario.rol}</div>
            </div>
            <button
              onClick={onSalir}
              className="flex items-center gap-1.5 bg-uni-bluedark hover:bg-blue-900 px-3 py-1.5 rounded-lg transition-colors"
            >
              <LogOut size={13} /> Salir
            </button>
          </div>
        )}
      </header>

      {/* Módulos */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex gap-3 flex-wrap shrink-0 shadow-sm">
        {modulosVisibles.map(({ id, nombre, icono: Icono, disponible }) => (
          <button
            key={id}
            onClick={() => disponible && onEntrarModulo(id)}
            disabled={!disponible}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
              disponible
                ? "border-uni-blue bg-uni-bluelight text-uni-blue hover:bg-uni-blue hover:text-white"
                : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Icono size={17} />
            {nombre}
            {!disponible && <Lock size={12} className="ml-1" />}
          </button>
        ))}
      </div>

      {/* Asistente IA */}
      <div className="flex-1 min-h-0">
        {!usuario?.permisos || usuario.permisos.includes("usar_asistente_ia") ? (
          <AsistenteIA />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm px-6 text-center">
            Tu rol no tiene acceso al Asistente de IA — usa los módulos de arriba, o pide a un administrador que te habilite el permiso.
          </div>
        )}
      </div>
    </div>
  );
}
