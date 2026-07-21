import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porProveedor", etiqueta: "Por Proveedor" },
  { id: "porArticulo", etiqueta: "Por Artículo" },
];

export default function ReporteCompras({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [tab, setTab] = useState("general");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
    apiFetch("/proveedores").then((r) => r.ok && r.json()).then((d) => d && setProveedores(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fechaInicial) params.set("fecha_inicio", fechaInicial);
      if (fechaFinal) params.set("fecha_fin", fechaFinal);
      if (sucursalId) params.set("sucursal_id", sucursalId);
      if (proveedorId) params.set("proveedor_id", proveedorId);
      const r = await apiFetch(`/reportes/compras?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId, proveedorId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`compras_general_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Proveedor", "Factura", "Total"],
        datos.general.map((f) => [f.fecha, f.id, f.proveedor_nombre, f.factura, f.total]));
    } else if (tab === "porProveedor") {
      descargarCSV(`compras_por_proveedor_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Proveedor", "No. Compras", "Total"], datos.porProveedor.map((f) => [f.proveedor, f.numero_compras, f.total]));
    } else {
      descargarCSV(`compras_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Cantidad", "Importe"], datos.porArticulo.map((f) => [f.producto, f.cantidad, f.importe]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Compras</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Proveedor</label>
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
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
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Folio</th><th className="py-2 px-3 text-left font-medium">Proveedor</th><th className="py-2 px-3 text-left font-medium">Factura</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.proveedor_nombre}</td>
                  <td className="py-2 px-3">{f.factura}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porProveedor" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Proveedor</th><th className="py-2 px-3 text-right font-medium">No. Compras</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.porProveedor.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porProveedor.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.proveedor}</td>
                  <td className="py-2 px-3 text-right">{f.numero_compras}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Producto</th><th className="py-2 px-3 text-right font-medium">Cantidad</th><th className="py-2 px-3 text-right font-medium">Importe</th></tr>
            </thead>
            <tbody>
              {datos.porArticulo.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porArticulo.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.producto}</td>
                  <td className="py-2 px-3 text-right">{f.cantidad}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.importe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_compras} recepción(es)</span>
          <span>Total: <b>${datos.totales.total.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
