import React, { useState } from "react";
import { Receipt, TrendingUp, Truck, Landmark, Boxes, Users, ArrowLeftRight } from "lucide-react";
import ReporteVentas from "./reportes/ReporteVentas.jsx";
import ReporteUtilidad from "./reportes/ReporteUtilidad.jsx";
import ReporteCompras from "./reportes/ReporteCompras.jsx";
import ReporteCortesCaja from "./reportes/ReporteCortesCaja.jsx";
import ReporteExistencias from "./reportes/ReporteExistencias.jsx";
import ReporteEstadoCuentaClientes from "./reportes/ReporteEstadoCuentaClientes.jsx";
import ReporteMovimientosCaja from "./reportes/ReporteMovimientosCaja.jsx";

const REPORTES = [
  { id: "ventas", nombre: "Ventas", icono: Receipt, Componente: ReporteVentas },
  { id: "utilidad", nombre: "Utilidad / Ganancia", icono: TrendingUp, Componente: ReporteUtilidad },
  { id: "compras", nombre: "Compras", icono: Truck, Componente: ReporteCompras },
  { id: "cortes", nombre: "Cortes de Caja", icono: Landmark, Componente: ReporteCortesCaja },
  { id: "existencias", nombre: "Existencias / Inventario", icono: Boxes, Componente: ReporteExistencias },
  { id: "clientes", nombre: "Estado de Cuenta de Clientes", icono: Users, Componente: ReporteEstadoCuentaClientes },
  { id: "movimientos", nombre: "Movimientos de Caja", icono: ArrowLeftRight, Componente: ReporteMovimientosCaja },
];

export default function Reportes() {
  const [activo, setActivo] = useState(null);
  const reporte = REPORTES.find((r) => r.id === activo);

  if (reporte) {
    const { Componente } = reporte;
    return <Componente onVolver={() => setActivo(null)} />;
  }

  return (
    <div className="w-full h-full bg-slate-50 p-6 overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-w-3xl">
        {REPORTES.map(({ id, nombre, icono: Icono }) => (
          <button
            key={id}
            onClick={() => setActivo(id)}
            className="flex flex-col items-center gap-2 bg-white border border-slate-200 rounded-xl p-4 hover:border-[#1a7fe8] hover:shadow-md transition-all"
          >
            <Icono size={28} className="text-[#1a7fe8]" />
            <span className="text-xs font-medium text-slate-700 text-center">{nombre}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
