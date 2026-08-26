import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, FileText } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";
import { hoyLocal, haceDiasLocal } from "../fechas";

// 90 días y no 30 como los reportes de ventas: una garantía con proveedor se
// arrastra meses (el módulo alerta a los 15 días SIN movimiento), así que con
// una ventana de 30 días el reporte se veía casi vacío.

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porTipo", etiqueta: "Por Tipo" },
  { id: "porSucursal", etiqueta: "Por Sucursal" },
  { id: "porProveedor", etiqueta: "Por Proveedor" },
];

const TIPOS = [
  { valor: "traslado", etiqueta: "Traslado" },
  { valor: "reparacion", etiqueta: "Reparación" },
  { valor: "otro", etiqueta: "Otro" },
];

/** Las 3 pestañas de agrupación (Por Tipo / Por Sucursal / Por Proveedor) son
 *  la misma tabla con otro encabezado y otro campo de nombre. Se extrae aquí
 *  para no repetir el mismo bloque tres veces. */
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

export default function ReporteGastosGarantias({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(haceDiasLocal(90));
  const [fechaFinal, setFechaFinal] = useState(hoyLocal());
  const [sucursalId, setSucursalId] = useState("");
  const [tipo, setTipo] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [soloSinComprobante, setSoloSinComprobante] = useState(false);
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
      if (tipo) params.set("tipo", tipo);
      if (proveedorId) params.set("proveedor_id", proveedorId);
      if (soloSinComprobante) params.set("sin_comprobante", "1");
      const r = await apiFetch(`/reportes/gastos-garantias?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId, tipo, proveedorId, soloSinComprobante]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`gastos_garantias_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Producto", "Proveedor", "Tipo", "Estado", "Resolución", "Descripción", "Comprobante", "Monto"],
        datos.general.map((f) => [f.fecha, f.folio, f.sucursal_nombre, f.producto_nombre, f.proveedor_nombre, f.tipo_etiqueta, f.estado_etiqueta, f.resolucion_etiqueta, f.descripcion, f.nombre_archivo || "Sin comprobante", f.monto]));
    } else if (tab === "porTipo") {
      descargarCSV(`gastos_garantias_por_tipo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Tipo", "No. Gastos", "Total"],
        datos.porTipo.map((f) => [f.tipo_etiqueta, f.numero_gastos, f.total]));
    } else if (tab === "porProveedor") {
      descargarCSV(`gastos_garantias_por_proveedor_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Proveedor", "No. Gastos", "Total"],
        datos.porProveedor.map((f) => [f.proveedor, f.numero_gastos, f.total]));
    } else {
      descargarCSV(`gastos_garantias_por_sucursal_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Sucursal", "No. Gastos", "Total"],
        datos.porSucursal.map((f) => [f.sucursal, f.numero_gastos, f.total]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-background text-slate-800 text-sm">
      <div className="neu rounded-none px-4 py-2 flex items-center gap-2">
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
          <>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Tipo de gasto</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="neu-campo rounded-lg px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Proveedor</label>
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="neu-campo rounded-lg px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 pb-1.5 cursor-pointer" title="Para perseguir los papeles que faltan">
              <input
                type="checkbox" checked={soloSinComprobante}
                onChange={(e) => setSoloSinComprobante(e.target.checked)}
                className="w-4 h-4 accent-[#1a7fe8]"
              />
              <span className="text-sm text-slate-600">Solo sin comprobante</span>
            </label>
          </>
        }
      />

      <div className="neu rounded-none flex no-imprimir">
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
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">Proveedor</th>
                <th className="py-2 px-3 text-left font-medium">Tipo</th>
                <th className="py-2 px-3 text-left font-medium">Estado</th>
                <th className="py-2 px-3 text-left font-medium">Resolución</th>
                <th className="py-2 px-3 text-left font-medium">Descripción</th>
                <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                <th className="py-2 px-3 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={11} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.folio}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.producto_nombre}</td>
                  <td className="py-2 px-3">{f.proveedor_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_etiqueta}</td>
                  <td className="py-2 px-3 text-slate-500">{f.estado_etiqueta}</td>
                  {/* En rojo lo que el proveedor rechazó: ese gasto lo absorbió la tienda. */}
                  <td className={`py-2 px-3 ${f.tipo_resolucion === "rechazada" ? "text-red-600 font-medium" : "text-slate-500"}`}>
                    {f.resolucion_etiqueta}
                  </td>
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
          <TablaAgrupada encabezado="Tipo" filas={datos.porTipo} campoNombre="tipo_etiqueta" />
        ) : tab === "porProveedor" ? (
          <TablaAgrupada encabezado="Proveedor" filas={datos.porProveedor} campoNombre="proveedor" />
        ) : (
          <TablaAgrupada encabezado="Sucursal" filas={datos.porSucursal} campoNombre="sucursal" />
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between gap-4 text-xs shrink-0 flex-wrap">
          <span>
            {datos.totales.numero_gastos} gasto(s) en {datos.totales.numero_garantias} garantía(s)
            {datos.totales.numero_sin_comprobante > 0 && ` — ${datos.totales.numero_sin_comprobante} sin comprobante`}
          </span>
          <span className="flex items-center gap-4">
            {/* Lo que el proveedor rechazó: ese dinero lo absorbió la tienda. */}
            {datos.totales.numero_rechazado > 0 && (
              <span className="text-red-300" title="Gastos de garantías que el proveedor rechazó — los absorbió la tienda">
                Rechazado: <b>${datos.totales.total_rechazado.toFixed(2)}</b>
              </span>
            )}
            {datos.totales.numero_sin_resolver > 0 && (
              <span className="text-amber-300" title="Gastos de garantías que todavía no tienen resolución del proveedor (registradas o enviadas) — aún no se sabe si responde. Las ya reparadas o reemplazadas NO cuentan aquí.">
                Sin resolver: <b>${datos.totales.total_sin_resolver.toFixed(2)}</b>
              </span>
            )}
            <span>Total: <b>${datos.totales.total.toFixed(2)}</b></span>
          </span>
        </div>
      )}
    </div>
  );
}
