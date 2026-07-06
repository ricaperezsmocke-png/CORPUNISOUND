import React from "react";
import { ShoppingCart, Users, Boxes, Sparkles, Lock, ShieldCheck, LogOut, Landmark } from "lucide-react";
import AsistenteIA from "./AsistenteIA";

const MODULOS = [
  { id: "pos", nombre: "Punto de Venta", icono: ShoppingCart, disponible: true, modulo: "pos" },
  { id: "corte", nombre: "Corte de Caja", icono: Landmark, disponible: true, modulo: "corte", permiso: "realizar_corte_caja" },
  { id: "inventario", nombre: "Inventario y Productos", icono: Boxes, disponible: true, modulo: "inventario" },
  { id: "roles", nombre: "Roles y Personal", icono: ShieldCheck, disponible: true, modulo: "admin" },
  { id: "crm", nombre: "CRM", icono: Users, disponible: true, modulo: "crm" },
];

export default function Dashboard({ onEntrarModulo, usuario, onSalir }) {
  // Si el usuario tiene lista de módulos habilitados (por su rol), filtramos.
  // Si no viene esa info (por compatibilidad), se muestran todos los disponibles.
  // Además, si un módulo declara un "permiso" específico, se oculta a quien no lo tenga
  // (ej. Corte de Caja solo aparece con realizar_corte_caja).
  const modulosVisibles = MODULOS.filter((m) => {
    const moduloOk = !usuario?.modulos || usuario.modulos.includes(m.modulo);
    const permisoOk = !m.permiso || !usuario?.permisos || usuario.permisos.includes(m.permiso);
    return moduloOk && permisoOk;
  });

  return (
    <div className="w-full h-screen flex flex-col bg-slate-50">
      {/* Encabezado */}
      <header className="bg-emerald-800 text-white px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={20} />
          <div>
            <div className="font-semibold text-sm leading-tight">Inicio — Asistente de Negocio</div>
            <div className="text-[11px] text-emerald-200 leading-tight">Pregunta lo que necesites o entra a un módulo</div>
          </div>
        </div>
        {usuario && (
          <div className="flex items-center gap-3 text-xs">
            <div className="text-right leading-tight">
              <div className="font-medium">{usuario.nombre}</div>
              <div className="text-emerald-200">{usuario.rol}</div>
            </div>
            <button onClick={onSalir} className="flex items-center gap-1 bg-emerald-900 hover:bg-emerald-950 px-2.5 py-1.5 rounded">
              <LogOut size={13} /> Salir
            </button>
          </div>
        )}
      </header>

      {/* Selector de módulos */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex gap-3 flex-wrap shrink-0">
        {modulosVisibles.map(({ id, nombre, icono: Icono, disponible }) => (
          <button
            key={id}
            onClick={() => disponible && onEntrarModulo(id)}
            disabled={!disponible}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
              disponible
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400"
                : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Icono size={17} />
            {nombre}
            {!disponible && <Lock size={12} className="ml-1" />}
          </button>
        ))}
      </div>

      {/* Asistente de IA como pantalla principal (solo con permiso) */}
      <div className="flex-1 min-h-0">
        {!usuario?.permisos || usuario.permisos.includes("usar_asistente_ia") ? (
          <AsistenteIA />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm px-6 text-center">
            Tu rol no tiene acceso al Asistente de IA — usa los módulos de arriba, o pide a un administrador que te habilite el permiso "Usar el Asistente de IA del Inicio".
          </div>
        )}
      </div>
    </div>
  );
}
