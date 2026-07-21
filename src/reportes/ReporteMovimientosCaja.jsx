import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

export default function ReporteMovimientosCaja({ onVolver }) {
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
      const r = await apiFetch(`/reportes/movimientos-caja?${params.toString()}`);
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
    descargarCSV(`movimientos_de_caja_${fechaInicial}_a_${fechaFinal}.csv`,
      ["Tipo", "Detalle", "Total"],
      [
        ...datos.entradas.map((f) => ["Entrada", f.forma_pago, f.total]),
        ...datos.salidas.map((f) => ["Salida", `Retiro corte #${f.id} — ${f.sucursal_nombre} — ${f.usuario_nombre}`, f.total_retiro]),
      ]);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Movimientos de Caja</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
      />

      <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Entradas (ventas por forma de pago)</h3>
          <table className="w-full text-sm bg-white rounded border border-slate-200">
            <thead className="bg-emerald-600 text-white">
              <tr><th className="py-2 px-3 text-left font-medium">Forma de Pago</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={2} className="text-center text-slate-400 py-10">Consultando...</td></tr>}
              {!cargando && datos && datos.entradas.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-10">Sin entradas</td></tr>}
              {datos && datos.entradas.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.forma_pago}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Salidas (retiros de corte de caja)</h3>
          <table className="w-full text-sm bg-white rounded border border-slate-200">
            <thead className="bg-red-500 text-white">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Sucursal</th><th className="py-2 px-3 text-left font-medium">Usuario</th><th className="py-2 px-3 text-right font-medium">Retiro</th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={4} className="text-center text-slate-400 py-10">Consultando...</td></tr>}
              {!cargando && datos && datos.salidas.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-10">Sin salidas</td></tr>}
              {datos && datos.salidas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.usuario_nombre}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total_retiro.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>Entradas: <b>${datos.totales.total_entradas.toFixed(2)}</b></span>
          <span>Salidas: <b>${datos.totales.total_salidas.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
