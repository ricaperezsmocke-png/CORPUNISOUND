import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";
import { hoyLocal, haceDiasLocal } from "../fechas";

/**
 * Quién canceló, cuándo, cuánto y por qué.
 *
 * El sistema guardaba `cancelada_por` y `fecha_hora_cancelacion` desde hace
 * tiempo y no los mostraba en ninguna parte: el dato existía y nadie podía
 * verlo. Cancelar una venta ya cobrada saca el dinero del cajón y devuelve la
 * mercancía al inventario, dejando la caja y el stock aparentemente cuadrados
 * — esta pantalla es lo que vuelve visible ese movimiento.
 */
export default function ReporteCancelaciones({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(haceDiasLocal(30));
  const [fechaFinal, setFechaFinal] = useState(hoyLocal());
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
      const r = await apiFetch(`/reportes/cancelaciones?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId]);

  useEffect(() => { consultar(); }, [consultar]);

  /** La hora importa tanto como el día: es lo que dice a qué turno afectó. */
  const horaDe = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-MX");
  };

  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV(`cancelaciones_${fechaInicial}_a_${fechaFinal}.csv`,
      ["Fecha", "Folio", "Sucursal", "Tipo", "Importe", "Canceló", "Cuándo", "Motivo"],
      datos.filas.map((f) => [f.fecha, f.folio, f.sucursal_nombre, f.tipo_documento, f.total, f.cancelada_por, horaDe(f.fecha_hora_cancelacion), f.motivo_cancelacion]));
  };

  return (
    <div className="w-full h-full flex flex-col bg-background text-slate-800 text-sm">
      <div className="neu rounded-none px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline no-imprimir">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Cancelaciones</h2>
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
                <th className="py-2 px-3 text-left font-medium">Tipo</th>
                <th className="py-2 px-3 text-right font-medium">Importe</th>
                <th className="py-2 px-3 text-left font-medium">Canceló</th>
                <th className="py-2 px-3 text-left font-medium">Cuándo</th>
                <th className="py-2 px-3 text-left font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin cancelaciones en el periodo</td></tr>}
              {datos.filas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.folio}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_documento}</td>
                  <td className="py-2 px-3 text-right font-medium text-red-600">${f.total.toFixed(2)}</td>
                  <td className="py-2 px-3">{f.cancelada_por}</td>
                  <td className="py-2 px-3 text-slate-500">{horaDe(f.fecha_hora_cancelacion)}</td>
                  <td className="py-2 px-3 text-slate-500">{f.motivo_cancelacion || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span>{datos.totales.numero_cancelaciones} cancelación(es)</span>
          <span className="font-semibold">Importe cancelado: ${datos.totales.total_cancelado.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
