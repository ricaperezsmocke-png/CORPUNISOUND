import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, FileText } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porTipo", etiqueta: "Por Tipo" },
  { id: "porSucursal", etiqueta: "Por Sucursal" },
];

const TIPOS = [
  { valor: "traslado", etiqueta: "Traslado" },
  { valor: "reparacion", etiqueta: "Reparación" },
  { valor: "otro", etiqueta: "Otro" },
];

export default function ReporteGastosGarantias({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [tipo, setTipo] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [tab, setTab] = useState("general");
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
      if (tipo) params.set("tipo", tipo);
      const r = await apiFetch(`/reportes/gastos-garantias?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId, tipo]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`gastos_garantias_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Producto", "Tipo", "Descripcion", "Comprobante", "Monto"],
        datos.general.map((f) => [f.fecha, f.folio, f.sucursal_nombre, f.producto_nombre, f.tipo_etiqueta, f.descripcion, f.nombre_archivo || "Sin comprobante", f.monto]));
    } else if (tab === "porTipo") {
      descargarCSV(`gastos_garantias_por_tipo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Tipo", "No. Gastos", "Total"],
        datos.porTipo.map((f) => [f.tipo_etiqueta, f.numero_gastos, f.total]));
    } else {
      descargarCSV(`gastos_garantias_por_sucursal_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Sucursal", "No. Gastos", "Total"],
        datos.porSucursal.map((f) => [f.sucursal, f.numero_gastos, f.total]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline no-imprimir">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Gastos de Garantías</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Tipo de gasto</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
            </select>
          </div>
        }
      />

      <div className="bg-white border-b border-slate-200 flex no-imprimir">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 ${tab === t.id ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : tab === "general" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">Tipo</th>
                <th className="py-2 px-3 text-left font-medium">Descripción</th>
                <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                <th className="py-2 px-3 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.folio}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.producto_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_etiqueta}</td>
                  <td className="py-2 px-3 text-slate-500">{f.descripcion || "—"}</td>
                  <td className="py-2 px-3 text-center">
                    {f.drive_link ? (
                      <a href={f.drive_link} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#1a7fe8] hover:underline" title={f.nombre_archivo || "Comprobante"}>
                        <FileText size={14} /> Ver
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">${f.monto.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porTipo" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Tipo</th>
                <th className="py-2 px-3 text-right font-medium">No. Gastos</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.porTipo.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porTipo.map((f) => (
                <tr key={f.tipo} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.tipo_etiqueta}</td>
                  <td className="py-2 px-3 text-right">{f.numero_gastos}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-right font-medium">No. Gastos</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.porSucursal.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porSucursal.map((f) => (
                <tr key={f.sucursal} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.sucursal}</td>
                  <td className="py-2 px-3 text-right">{f.numero_gastos}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span>
            {datos.totales.numero_gastos} gasto(s) en {datos.totales.numero_garantias} garantía(s)
            {datos.totales.numero_sin_comprobante > 0 && ` — ${datos.totales.numero_sin_comprobante} sin comprobante`}
          </span>
          <span>Total: <b>${datos.totales.total.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
