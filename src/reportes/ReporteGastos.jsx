import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, FileText } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";
import { hoyLocal, haceDiasLocal } from "../fechas";

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porCategoria", etiqueta: "Por Categoría" },
  { id: "porSucursal", etiqueta: "Por Sucursal" },
  { id: "porFormaPago", etiqueta: "Por Forma de Pago" },
];

const FORMAS_PAGO = [
  { valor: "EFECTIVO", etiqueta: "Efectivo" },
  { valor: "TRANSFERENCIA", etiqueta: "Transferencia" },
  { valor: "TARJETA", etiqueta: "Tarjeta" },
];

/** Las 3 pestañas de agrupación (Por Categoría / Por Sucursal / Por Forma de
 *  Pago) son la misma tabla con otro encabezado y otro campo de nombre. Se
 *  extrae aquí para no repetir el mismo bloque tres veces. */
function TablaAgrupada({ encabezado, filas, campoNombre }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-[#1a7fe8] text-white sticky top-0">
        <tr>
          <th className="py-2 px-3 text-left font-medium">{encabezado}</th>
          <th className="py-2 px-3 text-right font-medium">No. Gastos</th>
          <th className="py-2 px-3 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody>
        {filas.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
        {filas.map((f) => (
          <tr key={f[campoNombre]} className="border-b border-slate-100">
            <td className="py-2 px-3">{f[campoNombre]}</td>
            <td className="py-2 px-3 text-right">{f.numero_gastos}</td>
            <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReporteGastos({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(haceDiasLocal(30));
  const [fechaFinal, setFechaFinal] = useState(hoyLocal());
  const [sucursalId, setSucursalId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [formaPago, setFormaPago] = useState("");
  const [estatus, setEstatus] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [tab, setTab] = useState("general");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
    // Si esto falla (p.ej. por permisos), no se traga el error: el filtro de
    // Categoría se queda en "Todas" pero el mismo aviso rojo que usa la
    // consulta principal le explica al usuario por qué.
    apiFetch("/gastos/categorias?solo_activas=1").then((r) => {
      if (!r.ok) { setError("No se pudo cargar el catálogo de categorías."); return null; }
      return r.json();
    }).then((d) => d && setCategorias(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fechaInicial) params.set("fecha_inicio", fechaInicial);
      if (fechaFinal) params.set("fecha_fin", fechaFinal);
      if (sucursalId) params.set("sucursal_id", sucursalId);
      if (categoriaId) params.set("categoria_id", categoriaId);
      if (formaPago) params.set("forma_pago", formaPago);
      if (estatus) params.set("estatus", estatus);
      const r = await apiFetch(`/reportes/gastos?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId, categoriaId, formaPago, estatus]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`gastos_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Folio", "Fecha", "Sucursal", "Grupo", "Categoría", "Concepto", "Proveedor", "Forma de pago", "Estatus", "Monto"],
        datos.general.map((f) => [f.folio, f.fecha, f.sucursal_nombre, f.grupo_nombre, f.categoria_nombre, f.concepto, f.proveedor_nombre || "—", f.forma_pago, f.estatus, f.monto]));
    } else if (tab === "porCategoria") {
      descargarCSV(`gastos_por_categoria_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Grupo", "Categoría", "No. Gastos", "Total"],
        datos.porCategoria.map((f) => [f.grupo, f.categoria, f.numero_gastos, f.total]));
    } else if (tab === "porSucursal") {
      descargarCSV(`gastos_por_sucursal_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Sucursal", "No. Gastos", "Total"],
        datos.porSucursal.map((f) => [f.sucursal, f.numero_gastos, f.total]));
    } else {
      descargarCSV(`gastos_por_forma_pago_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Forma de pago", "No. Gastos", "Total"],
        datos.porFormaPago.map((f) => [f.forma_pago, f.numero_gastos, f.total]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline no-imprimir">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Gastos</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Categoría</label>
              <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                {categorias.filter((c) => c.categoria_padre_id === null).map((grupo) => (
                  <optgroup key={grupo.id} label={grupo.nombre}>
                    {categorias.filter((c) => c.categoria_padre_id === grupo.id).map((hija) => (
                      <option key={hija.id} value={hija.id}>{hija.nombre}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Forma de pago</label>
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                {FORMAS_PAGO.map((f) => <option key={f.valor} value={f.valor}>{f.etiqueta}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Estatus</label>
              <select value={estatus} onChange={(e) => setEstatus(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="">Solo activos</option>
                <option value="todos">Todos (incluye cancelados)</option>
              </select>
            </div>
          </>
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

      <div className="flex-1 overflow-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : tab === "general" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Grupo</th>
                <th className="py-2 px-3 text-left font-medium">Categoría</th>
                <th className="py-2 px-3 text-left font-medium">Concepto</th>
                <th className="py-2 px-3 text-left font-medium">Proveedor</th>
                <th className="py-2 px-3 text-left font-medium">Forma de pago</th>
                <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                <th className="py-2 px-3 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3 font-medium">
                    {f.folio}
                    {f.estatus === "cancelado" && (
                      <span className="ml-2 text-[10px] font-normal text-red-500 bg-red-50 border border-red-200 rounded px-1 py-0.5">Cancelado</span>
                    )}
                  </td>
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3 text-slate-500">{f.grupo_nombre}</td>
                  <td className="py-2 px-3">{f.categoria_nombre}</td>
                  <td className="py-2 px-3">{f.concepto}</td>
                  <td className="py-2 px-3">{f.proveedor_nombre || "—"}</td>
                  <td className="py-2 px-3">{f.forma_pago}</td>
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
                  <td className={`py-2 px-3 text-right font-medium ${f.estatus === "cancelado" ? "text-slate-400 line-through" : ""}`}>
                    ${f.monto.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porCategoria" ? (
          <TablaAgrupada encabezado="Categoría" filas={datos.porCategoria} campoNombre="categoria" />
        ) : tab === "porSucursal" ? (
          <TablaAgrupada encabezado="Sucursal" filas={datos.porSucursal} campoNombre="sucursal" />
        ) : (
          <TablaAgrupada encabezado="Forma de Pago" filas={datos.porFormaPago} campoNombre="forma_pago" />
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between gap-4 text-xs shrink-0 flex-wrap">
          <span>{datos.totales.numero_gastos} gasto(s)</span>
          <span className="flex items-center gap-4">
            {datos.totales.numero_cancelados > 0 && (
              <span className="text-slate-400" title="Gastos cancelados — nunca sumados al total vigente">
                Cancelados: ${datos.totales.total_cancelado.toFixed(2)}
              </span>
            )}
            <span>Total: <b>${datos.totales.total.toFixed(2)}</b></span>
          </span>
        </div>
      )}
    </div>
  );
}
