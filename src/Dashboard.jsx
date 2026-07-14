import React from "react";
import { ShoppingCart, Users, Boxes, Lock, ShieldCheck, LogOut, Landmark, Store, ArrowRightLeft, Truck, FileSpreadsheet } from "lucide-react";
import AsistenteIA from "./AsistenteIA";
import SelectorSucursal from "./SelectorSucursal.jsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MODULOS = [
  { id: "pos",        nombre: "Punto de Venta",        icono: ShoppingCart, disponible: true, modulo: "pos" },
  { id: "corte",      nombre: "Corte de Caja",          icono: Landmark,     disponible: true, modulo: "corte",     permiso: "realizar_corte_caja" },
  { id: "inventario", nombre: "Inventario y Productos",  icono: Boxes,        disponible: true, modulo: "inventario" },
  { id: "traspasos",  nombre: "Traspasos entre Sucursales", icono: ArrowRightLeft, disponible: true, modulo: "inventario", permiso: "realizar_traspasos" },
  { id: "compras",    nombre: "Recepción de Compras",   icono: Truck,          disponible: true, modulo: "inventario", permiso: "recibir_compra" },
  { id: "migracion",  nombre: "Migración de Datos",     icono: FileSpreadsheet, disponible: true, modulo: "inventario", permiso: "migrar_datos" },
  { id: "roles",      nombre: "Roles y Personal",        icono: ShieldCheck,  disponible: true, modulo: "admin" },
  { id: "crm",        nombre: "CRM",                     icono: Users,        disponible: true, modulo: "crm" },
  { id: "ml",         nombre: "MercadoLibre",             icono: Store,        disponible: true, modulo: "ml" },
];

export default function Dashboard({ onEntrarModulo, usuario, onSalir }) {
  const modulosVisibles = MODULOS.filter((m) => {
    const moduloOk = !usuario?.modulos || usuario.modulos.includes(m.modulo);
    const permisoOk = !m.permiso || !usuario?.permisos || usuario.permisos.includes(m.permiso);
    return moduloOk && permisoOk;
  });

  return (
    <div className="w-full h-full flex flex-col bg-muted/30">

      {/* Encabezado */}
      <header className="shrink-0 shadow-md" style={{ background: "linear-gradient(90deg, #1a7fe8 0%, #1262b8 100%)" }}>
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-unisound.jpg" alt="Unisound" className="h-10 object-contain bg-white rounded-lg px-2 py-0.5" />
            <div className="text-white">
              <div className="font-semibold text-sm leading-tight">Asistente de Negocio</div>
              <div className="text-xs text-blue-100 leading-tight">Pregunta lo que necesites o entra a un módulo</div>
            </div>
          </div>

          {usuario && (
            <div className="flex items-center gap-3">
              <SelectorSucursal usuario={usuario} onCambio={() => window.location.reload()} />
              <div className="text-right text-white">
                <div className="text-sm font-semibold leading-tight">{usuario.nombre}</div>
                <div className="text-xs text-blue-100 leading-tight">{usuario.rol}</div>
              </div>
              <Button
                onClick={onSalir}
                size="sm"
                variant="secondary"
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
              >
                <LogOut size={13} /> Salir
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Barra de módulos */}
      <div className="bg-background border-b px-5 py-3 flex gap-2 flex-wrap shrink-0 shadow-sm">
        {modulosVisibles.map(({ id, nombre, icono: Icono, disponible }) => (
          <Button
            key={id}
            onClick={() => disponible && onEntrarModulo(id)}
            disabled={!disponible}
            variant="outline"
            size="sm"
            className={`flex items-center gap-2 rounded-xl transition-all ${
              disponible
                ? "border-[#1a7fe8] text-[#1a7fe8] hover:bg-[#1a7fe8] hover:text-white"
                : "opacity-50 cursor-not-allowed"
            }`}
          >
            <Icono size={16} />
            {nombre}
            {!disponible && <Lock size={11} />}
          </Button>
        ))}
      </div>

      {/* Asistente IA */}
      <div className="flex-1 min-h-0">
        {!usuario?.permisos || usuario.permisos.includes("usar_asistente_ia") ? (
          <AsistenteIA />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm px-6 text-center">
            <Badge variant="outline" className="text-xs">Acceso restringido</Badge>
            <p>Tu rol no tiene acceso al Asistente de IA. Usa los módulos de arriba o pide al administrador que habilite el permiso.</p>
          </div>
        )}
      </div>
    </div>
  );
}
