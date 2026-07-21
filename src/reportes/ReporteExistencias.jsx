import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const ESTADOS = [
  { id: "", etiqueta: "Todos" },
  { id: "con_existencia", etiqueta: "Con existencia" },
  { id: "sin_existencia", etiqueta: "Sin existencia" },
  { id: "sobre_maximo", etiqueta: "Sobre máximo" },
  { id: "bajo_minimo", etiqueta: "Bajo mínimo" },
];

export default function ReporteExistencias({ onVolver }) {
  const [departamentoId, setDepartamentoId] = useState("");
  const [estado, setEstado] = useState("");
  const [departamentos, setDepartamentos] = useState([]);
  const [tab, setTab] = useState("existencias");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/departamentos").then((r) => r.ok && r.json()).then((d) => d && setDepartamentos(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (departamentoId) params.set("departamento_id", departamentoId);
      if (estado) params.set("estado", estado);
      const r = await apiFetch(`/reportes/existencias?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [departamentoId, estado]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "existencias") {
      descargarCSV("existencias.csv",
        ["Producto", "SKU", "Departamento", "Existencia", "Mínima", "Máxima", "Valor a Costo", "Valor a Precio de Venta"],
        datos.filas.map((f) => [f.nombre, f.sku, f.departamento_nombre, f.cantidad, f.minima, f.maxima, f.valor_a_costo, f.valor_a_precio_venta]));
    } else {
      descargarCSV("articulos_sin_movimiento.csv",
        ["Producto", "SKU", "Departamento", "Existencia"],
        datos.sinMovimiento.map((f) => [f.nombre, f.sku, f.departamento_nombre, f.cantidad]));
    }
  };

  const filas = datos ? (tab === "existencias" ? datos.filas : datos.sinMovimiento) : [];

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Existencias / Inventario</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end no-imprimir">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Departamento</label>
          <select value={departamentoId} onChange={(e) => setDepartamentoId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
            {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.etiqueta}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 flex no-imprimir">
        <button onClick={() => setTab("existencias")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "existencias" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Existencias
        </button>
        <button onClick={() => setTab("sinMovimiento")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "sinMovimiento" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Sin Movimiento
        </button>
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
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">SKU</th>
                <th className="py-2 px-3 text-left font-medium">Departamento</th>
                <th className="py-2 px-3 text-right font-medium">Existencia</th>
                {tab === "existencias" && <th className="py-2 px-3 text-right font-medium">Valor a Costo</th>}
                {tab === "existencias" && <th className="py-2 px-3 text-right font-medium">Valor a Precio de Venta</th>}
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={tab === "existencias" ? 6 : 4} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {filas.map((f) => (
                <tr key={f.producto_id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.nombre}</td>
                  <td className="py-2 px-3">{f.sku}</td>
                  <td className="py-2 px-3">{f.departamento_nombre}</td>
                  <td className="py-2 px-3 text-right">{f.cantidad}</td>
                  {tab === "existencias" && <td className="py-2 px-3 text-right">${f.valor_a_costo.toFixed(2)}</td>}
                  {tab === "existencias" && <td className="py-2 px-3 text-right font-medium">${f.valor_a_precio_venta.toFixed(2)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && tab === "existencias" && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_articulos} artículo(s)</span>
          <span>Valor a costo: ${datos.totales.valor_a_costo.toFixed(2)} — Valor a precio de venta: <b>${datos.totales.valor_a_precio_venta.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
