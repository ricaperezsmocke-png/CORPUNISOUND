import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

export default function ReporteEstadoCuentaClientes({ onVolver }) {
  const [clienteId, setClienteId] = useState("");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (clienteId) params.set("cliente_id", clienteId);
      const r = await apiFetch(`/reportes/clientes?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [clienteId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV("estado_de_cuenta_clientes.csv",
      ["Clave", "Nombre", "Límite de Crédito", "Saldo", "Crédito Disponible", "Monedero"],
      datos.filas.map((f) => [f.clave, f.nombre, f.limite_credito, f.saldo, f.credito_disponible, f.monedero]));
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline no-imprimir">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Estado de Cuenta de Clientes</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <div className="flex-1 overflow-y-auto flex flex-col md:flex-row">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Clave</th>
                <th className="py-2 px-3 text-left font-medium">Nombre</th>
                <th className="py-2 px-3 text-right font-medium">Límite</th>
                <th className="py-2 px-3 text-right font-medium">Saldo</th>
                <th className="py-2 px-3 text-right font-medium">Disponible</th>
                <th className="py-2 px-3 text-right font-medium">Monedero</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Consultando...</td></tr>}
              {!cargando && datos && datos.filas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Sin clientes</td></tr>}
              {datos && datos.filas.map((f) => (
                <tr key={f.id} onClick={() => setClienteId(String(f.id))}
                  className={`border-b border-slate-100 cursor-pointer ${String(f.id) === clienteId ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                  <td className="py-2 px-3">{f.clave}</td>
                  <td className="py-2 px-3">{f.nombre}</td>
                  <td className="py-2 px-3 text-right">${f.limite_credito.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.saldo.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.credito_disponible.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-emerald-700">${f.monedero.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {datos && datos.detalleCliente && (
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-200 bg-white p-4 no-imprimir">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Ventas a crédito</h3>
            {datos.detalleCliente.ventas_credito.length === 0 ? (
              <p className="text-xs text-slate-400">Sin ventas a crédito registradas</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 border-b border-slate-200"><th className="text-left py-1">Fecha</th><th className="text-left py-1">Folio</th><th className="text-right py-1">Total</th></tr></thead>
                <tbody>
                  {datos.detalleCliente.ventas_credito.map((v) => (
                    <tr key={v.id} className="border-b border-slate-100">
                      <td className="py-1">{v.fecha}</td>
                      <td className="py-1">{v.id}</td>
                      <td className="py-1 text-right">${Number(v.total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span>{datos.totales.numero_clientes} cliente(s)</span>
          <span>Saldo total: <b>${datos.totales.saldo_total.toFixed(2)}</b> — Límite total: ${datos.totales.limite_total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
