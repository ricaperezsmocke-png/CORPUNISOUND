import React from "react";
import AsistenteIA from "./AsistenteIA";
import { Badge } from "@/components/ui/badge";

/**
 * Dashboard.jsx — La pantalla de inicio.
 *
 * Antes era el menú Y el asistente. El menú se mudó a BarraLateral.jsx y el
 * encabezado a App.jsx, así que aquí solo queda el asistente. En la fase 2 este
 * archivo recibe las tarjetas de métricas.
 */
export default function Dashboard({ usuario }) {
  if (usuario?.permisos && !usuario.permisos.includes("usar_asistente_ia")) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm px-6 text-center">
        <Badge variant="outline" className="text-xs">Acceso restringido</Badge>
        <p>Tu rol no tiene acceso al Asistente de IA. Usa los módulos del menú o pide al administrador que habilite el permiso.</p>
      </div>
    );
  }
  return <AsistenteIA />;
}
