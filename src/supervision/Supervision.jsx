import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { pestanasSupervision } from "./pestanasSupervision";
import VisitaTienda from "./VisitaTienda";
import PendientesTienda from "./PendientesTienda";
import ResumenSupervision from "./ResumenSupervision";
import EditorChecklist from "./EditorChecklist";

const PESTANA = "px-3 py-2 rounded-lg text-sm whitespace-nowrap";

// Supervisión de tiendas (spec 2026-10-22 F2): cada quien ve las pestañas que su permiso le abre.
export default function Supervision({ permisos = [], usuario }) {
  const pestanas = pestanasSupervision(permisos);
  const [activa, setActiva] = useState(pestanas[0]?.clave || null);
  const [sucursales, setSucursales] = useState([]);
  useEffect(() => {
    apiFetch("/sucursales").then((r) => leer(r, "No se pudieron cargar las tiendas"))
      .then((lista) => setSucursales(lista.filter((s) => !s.sin_ubicacion))).catch(() => setSucursales([]));
  }, []);
  if (!pestanas.length) return <p className="p-4 text-sm text-slate-500">No tienes permisos de supervisión.</p>;
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <h2 className="text-lg font-semibold text-slate-800">Supervisión de tiendas</h2>
      <nav className="flex gap-2 overflow-x-auto" aria-label="Secciones de supervisión">
        {pestanas.map((p) => (
          <button key={p.clave} type="button" aria-pressed={activa === p.clave} onClick={() => setActiva(p.clave)}
            className={`${PESTANA} ${activa === p.clave ? "bg-blue-600 text-white" : "bg-white border border-slate-300 text-slate-700"}`}>
            {p.etiqueta}
          </button>
        ))}
      </nav>
      {activa === "visita" && <VisitaTienda sucursales={sucursales} usuario={usuario} />}
      {activa === "pendientes" && <PendientesTienda />}
      {activa === "resumen" && <ResumenSupervision sucursales={sucursales} />}
      {activa === "checklist" && <EditorChecklist />}
    </div>
  );
}
