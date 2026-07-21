import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "porArticulo", etiqueta: "Por Artículo" },
  { id: "porDepartamento", etiqueta: "Por Departamento" },
];

export default function ReporteUtilidad({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [tab, setTab] = useState("porArticulo");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
    apiFetch("/vendedores").then((r) => r.ok && r.json()).then((d) => d && setVendedores(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    if (vendedorId) params.set("vendedor_id", vendedorId);
    const r = await apiFetch(`/reportes/utilidad?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId, vendedorId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "porArticulo") {
      descargarCSV(`utilidad_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Venta", "Costo", "Utilidad"],
        datos.porArticulo.map((f) => [f.producto, f.venta, f.costo, f.utilidad]));
    } else {
      descargarCSV(`utilidad_por_departamento_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Departamento", "Venta", "Costo", "Utilidad"],
        datos.porDepartamento.map((f) => [f.departamento, f.venta, f.costo, f.utilidad]));
    }
  };

  const filas = datos ? (tab === "porArticulo" ? datos.porArticulo : datos.porDepartamento) : [];

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Utilidad / Ganancia</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Vendedor</label>
            <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
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
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">{tab === "porArticulo" ? "Producto" : "Departamento"}</th>
                <th className="py-2 px-3 text-right font-medium">Venta</th>
                <th className="py-2 px-3 text-right font-medium">Costo</th>
                <th className="py-2 px-3 text-right font-medium">Utilidad</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {filas.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.producto || f.departamento}</td>
                  <td className="py-2 px-3 text-right">${f.venta.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.costo.toFixed(2)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${f.utilidad < 0 ? "text-red-600" : "text-emerald-700"}`}>${f.utilidad.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>Venta: ${datos.totales.venta.toFixed(2)} — Costo: ${datos.totales.costo.toFixed(2)}</span>
          <span>Utilidad: <b>${datos.totales.utilidad.toFixed(2)}</b> ({datos.totales.margen_pct.toFixed(1)}% margen)</span>
        </div>
      )}
    </div>
  );
}
