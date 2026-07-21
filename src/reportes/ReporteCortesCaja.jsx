import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

export default function ReporteCortesCaja({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fechaInicial) params.set("fecha_inicio", fechaInicial);
      if (fechaFinal) params.set("fecha_fin", fechaFinal);
      if (sucursalId) params.set("sucursal_id", sucursalId);
      const r = await apiFetch(`/reportes/cortes-caja?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV(`cortes_de_caja_${fechaInicial}_a_${fechaFinal}.csv`,
      ["Fecha", "Folio", "Sucursal", "Usuario", "Calculado", "Contado", "Diferencia", "Retiro"],
      datos.filas.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.usuario_nombre, f.total_calculado, f.total_contado, f.total_diferencia, f.total_retiro]));
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Cortes de Caja</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
      />

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Usuario</th>
                <th className="py-2 px-3 text-right font-medium">Calculado</th>
                <th className="py-2 px-3 text-right font-medium">Contado</th>
                <th className="py-2 px-3 text-right font-medium">Diferencia</th>
                <th className="py-2 px-3 text-right font-medium">Retiro</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.filas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.usuario_nombre}</td>
                  <td className="py-2 px-3 text-right">${f.total_calculado.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.total_contado.toFixed(2)}</td>
                  <td className={`py-2 px-3 text-right ${f.total_diferencia < 0 ? "text-red-600" : "text-emerald-700"}`}>${f.total_diferencia.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total_retiro.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_cortes} corte(s)</span>
          <span>Calculado: ${datos.totales.total_calculado.toFixed(2)} — Contado: ${datos.totales.total_contado.toFixed(2)} — Retiro: <b>${datos.totales.total_retiro.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
