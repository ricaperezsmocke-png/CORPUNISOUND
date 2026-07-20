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
  { id: "porArticulo", etiqueta: "Por Artículo" },
  { id: "porVendedor", etiqueta: "Por Vendedor" },
  { id: "canceladas", etiqueta: "Canceladas" },
];

export default function ReporteVentas({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [tab, setTab] = useState("general");
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
    const r = await apiFetch(`/reportes/ventas?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId, vendedorId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`ventas_general_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Documento", "Cliente", "Vendedor", "Estado", "Total"],
        datos.general.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.tipo_documento, f.cliente_nombre, f.vendedor_nombre, f.estatus, f.total]));
    } else if (tab === "porArticulo") {
      descargarCSV(`ventas_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Cantidad", "Importe"], datos.porArticulo.map((f) => [f.producto, f.cantidad, f.importe]));
    } else if (tab === "porVendedor") {
      descargarCSV(`ventas_por_vendedor_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Vendedor", "No. Ventas", "Total"], datos.porVendedor.map((f) => [f.vendedor, f.numero_ventas, f.total]));
    } else {
      descargarCSV(`ventas_canceladas_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Cliente", "Vendedor", "Total"],
        datos.canceladas.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.cliente_nombre, f.vendedor_nombre, f.total]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Ventas</h2>
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
        ) : tab === "general" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Documento</th>
                <th className="py-2 px-3 text-left font-medium">Cliente</th>
                <th className="py-2 px-3 text-left font-medium">Vendedor</th>
                <th className="py-2 px-3 text-center font-medium">Estado</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className={`border-b border-slate-100 ${f.estatus === "cancelada" ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_documento}</td>
                  <td className="py-2 px-3">{f.cliente_nombre}</td>
                  <td className="py-2 px-3">{f.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-center">{f.estatus === "cancelada" ? "Cancelada" : "Cerrada"}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porArticulo" ? (
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
        ) : tab === "porVendedor" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Vendedor</th><th className="py-2 px-3 text-right font-medium">No. Ventas</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.porVendedor.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porVendedor.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.vendedor}</td>
                  <td className="py-2 px-3 text-right">{f.numero_ventas}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Folio</th><th className="py-2 px-3 text-left font-medium">Sucursal</th><th className="py-2 px-3 text-left font-medium">Cliente</th><th className="py-2 px-3 text-left font-medium">Vendedor</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.canceladas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Sin canceladas</td></tr>}
              {datos.canceladas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.cliente_nombre}</td>
                  <td className="py-2 px-3">{f.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_ventas} venta(s) vigente(s)</span>
          <span>Total vigente: <b>${datos.totales.total_vigente.toFixed(2)}</b> — Cancelado: ${datos.totales.total_cancelado.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
