import React, { useState } from "react";
import { Receipt, TrendingUp, Truck, Landmark, Boxes, Users, ArrowLeftRight, ShieldAlert, Wallet } from "lucide-react";
import ReporteVentas from "./reportes/ReporteVentas.jsx";
import ReporteUtilidad from "./reportes/ReporteUtilidad.jsx";
import ReporteCompras from "./reportes/ReporteCompras.jsx";
import ReporteCortesCaja from "./reportes/ReporteCortesCaja.jsx";
import ReporteExistencias from "./reportes/ReporteExistencias.jsx";
import ReporteEstadoCuentaClientes from "./reportes/ReporteEstadoCuentaClientes.jsx";
import ReporteMovimientosCaja from "./reportes/ReporteMovimientosCaja.jsx";
import ReporteGastosGarantias from "./reportes/ReporteGastosGarantias.jsx";
import ReporteGastos from "./reportes/ReporteGastos.jsx";

const REPORTES = [
  { id: "ventas", nombre: "Ventas", icono: Receipt, Componente: ReporteVentas },
  { id: "utilidad", nombre: "Utilidad / Ganancia", icono: TrendingUp, Componente: ReporteUtilidad },
  { id: "compras", nombre: "Compras", icono: Truck, Componente: ReporteCompras },
  { id: "cortes", nombre: "Cortes de Caja", icono: Landmark, Componente: ReporteCortesCaja },
  { id: "existencias", nombre: "Existencias / Inventario", icono: Boxes, Componente: ReporteExistencias },
  { id: "clientes", nombre: "Estado de Cuenta de Clientes", icono: Users, Componente: ReporteEstadoCuentaClientes },
  { id: "movimientos", nombre: "Movimientos de Caja", icono: ArrowLeftRight, Componente: ReporteMovimientosCaja },
  { id: "gastos-garantias", nombre: "Gastos de Garantías", icono: ShieldAlert, Componente: ReporteGastosGarantias },
  { id: "gastos", nombre: "Gastos", icono: Wallet, Componente: ReporteGastos },
];

export default function Reportes() {
  const [activo, setActivo] = useState(null);
  const reporte = REPORTES.find((r) => r.id === activo);

  if (reporte) {
    const { Componente } = reporte;
    return <Componente onVolver={() => setActivo(null)} />;
  }

  return (
    <div className="w-full h-full bg-background p-6 overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-w-3xl">
        {REPORTES.map(({ id, nombre, icono: Icono }) => (
          <button
            key={id}
            onClick={() => setActivo(id)}
            className="flex flex-col items-center gap-2 neu rounded-xl p-4 hover:border-[#1a7fe8] hover:shadow-md transition-all"
          >
            <Icono size={28} className="text-[#1a7fe8]" />
            <span className="text-xs font-medium text-slate-700 text-center">{nombre}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
