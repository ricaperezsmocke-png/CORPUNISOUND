import React, { useState, useEffect, useRef } from "react";
import { FileSpreadsheet, Download, Upload } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const TIPOS = [
  { id: "articulos", etiqueta: "Artículos", pideSucursal: true },
  { id: "clientes", etiqueta: "Clientes", pideSucursal: true },
  { id: "proveedores", etiqueta: "Proveedores", pideSucursal: false },
];

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

export default function MigracionDatos({ onVolver, permisos, usuario, onImportado }) {
  const [tab, setTab] = useState("articulos");
  const [sucursales, setSucursales] = useState([]);
  const [sucursalId, setSucursalId] = useState("");
  const [previsualizacion, setPrevisualizacion] = useState(null);
  const [confirmados, setConfirmados] = useState({});
  const [defaults, setDefaults] = useState({ categoria: "", departamento: "", unidad: "" });
  const [resumen, setResumen] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const nombreArchivoRef = useRef("");
  const inputArchivoRef = useRef(null);

  const tipoActual = TIPOS.find((t) => t.id === tab);
  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 3000); };

  useEffect(() => { apiFetch("/sucursales").then((r) => r.json()).then(setSucursales).catch(() => {}); }, []);
  useEffect(() => { setPrevisualizacion(null); setConfirmados({}); setResumen(null); setSucursalId(""); }, [tab]);

  const subirArchivo = async (archivo) => {
    if (tipoActual.pideSucursal && usuario?.ver_todas && !sucursalId) {
      return mostrarAviso("Selecciona la sucursal de origen del archivo primero");
    }
    setCargando(true);
    nombreArchivoRef.current = archivo.name;
    try {
      const archivo_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch("/migracion/previsualizar", {
        method: "POST",
        body: JSON.stringify({ tipo: tab, archivo_base64, sucursal_id: sucursalId || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPrevisualizacion(data);
      setConfirmados({});
      setResumen(null);
    } catch (e) { mostrarAviso("❌ " + e.message); }
    finally { setCargando(false); if (inputArchivoRef.current) inputArchivoRef.current.value = ""; }
  };

  const aplicar = async () => {
    const filas = previsualizacion.filas.filter((f) => f.valida && confirmados[f.numero_fila]).map((f) => f.datos);
    if (filas.length === 0) return mostrarAviso("Confirma al menos un renglón antes de aplicar");
    setCargando(true);
    try {
      const r = await apiFetch("/migracion/aplicar", {
        method: "POST",
        body: JSON.stringify({ tipo: tab, filas, sucursal_id: sucursalId || undefined, defaults, nombre_archivo: nombreArchivoRef.current }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResumen(data);
      setPrevisualizacion(null);
      setConfirmados({});
      mostrarAviso(`${data.nuevos} nuevos, ${data.actualizados} actualizados${data.errores.length ? `, ${data.errores.length} con error` : ""}`);
      if (tab === "articulos" && onImportado) onImportado();
    } catch (e) { mostrarAviso("❌ " + e.message); }
    finally { setCargando(false); }
  };

  const exportarRespaldo = async () => {
    if (tipoActual.pideSucursal && usuario?.ver_todas && !sucursalId) {
      return mostrarAviso("Selecciona la sucursal a exportar primero");
    }
    const params = new URLSearchParams({ tipo: tab });
    if (sucursalId) params.set("sucursal_id", sucursalId);
    const r = await apiFetch(`/migracion/exportar?${params.toString()}`);
    if (!r.ok) { const data = await r.json().catch(() => ({})); return mostrarAviso("❌ " + (data.error || "No se pudo exportar")); }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `respaldo-${tab}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const hayAltasSinDefaults = previsualizacion?.filas.some(
    (f) => f.valida && confirmados[f.numero_fila] && f.accion === "alta" && tab === "articulos" && (!f.datos.categoria || !f.datos.departamento || !f.datos.unidad)
  );

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex items-center px-2">
        {TIPOS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
            <FileSpreadsheet size={14} className="inline mr-1.5 -mt-0.5" /> {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
        {tipoActual.pideSucursal && usuario?.ver_todas && (
          <div className="max-w-xs">
            <label className="text-xs text-slate-500 block mb-1">Sucursal de origen del archivo</label>
            <select className={inputCls} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Selecciona...</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input ref={inputArchivoRef} type="file" accept=".xls,.xlsx" disabled={cargando}
            onChange={(e) => e.target.files[0] && subirArchivo(e.target.files[0])} />
          <button onClick={exportarRespaldo} className="ml-auto flex items-center gap-1.5 border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            <Download size={14} /> Exportar respaldo
          </button>
        </div>

        {cargando && <p className="text-slate-400 text-center py-4">Procesando...</p>}

        {previsualizacion && (
          <div className="flex-1 flex flex-col min-h-0">
            {previsualizacion.columnas_no_reconocidas?.length > 0 && (
              <div className="mb-2 bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 text-xs">
                Columnas no reconocidas (se ignoraron): {previsualizacion.columnas_no_reconocidas.join(", ")}
              </div>
            )}
            <div className="flex gap-4 items-center text-xs text-slate-600 mb-2">
              <span>Total: {previsualizacion.resumen.total}</span>
              <span className="text-emerald-600">Altas: {previsualizacion.resumen.altas}</span>
              <span className="text-blue-600">Actualizaciones: {previsualizacion.resumen.actualizaciones}</span>
              <span className="text-red-600">Inválidas: {previsualizacion.resumen.invalidas}</span>
              <button
                onClick={() => setConfirmados(Object.fromEntries(previsualizacion.filas.filter((f) => f.valida).map((f) => [f.numero_fila, true])))}
                className="ml-auto border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Confirmar todas las válidas
              </button>
              <button
                onClick={() => setConfirmados({})}
                className="border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Quitar todas
              </button>
            </div>
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded">
              <table className="w-full text-xs">
                <thead className="bg-[#1a7fe8] text-white sticky top-0">
                  <tr>
                    <th className="py-2 px-2 text-left">Fila</th>
                    <th className="py-2 px-2 text-left">Clave/RFC</th>
                    <th className="py-2 px-2 text-left">Nombre</th>
                    {tab === "articulos" && <th className="py-2 px-2 text-right">Costo</th>}
                    <th className="py-2 px-2 text-center">Acción</th>
                    <th className="py-2 px-2 text-center">Confirmar</th>
                  </tr>
                </thead>
                <tbody>
                  {previsualizacion.filas.map((f) => (
                    <tr key={f.numero_fila} className="border-b border-slate-100">
                      <td className="py-1.5 px-2">{f.numero_fila}</td>
                      <td className="py-1.5 px-2">{f.datos.clave || f.datos.rfc}</td>
                      <td className="py-1.5 px-2">{f.datos.descripcion || f.datos.nombre}</td>
                      {tab === "articulos" && (
                        <td className="py-1.5 px-2 text-right">{f.datos.costo !== undefined && f.datos.costo !== "" ? f.datos.costo : "—"}</td>
                      )}
                      <td className="py-1.5 px-2 text-center">
                        {!f.valida
                          ? <span className="text-red-600" title={f.errores.join("; ")}>Inválida</span>
                          : f.accion === "alta" ? <span className="text-emerald-600">Alta nueva</span> : <span className="text-blue-600">Actualización</span>}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <input type="checkbox" disabled={!f.valida} checked={!!confirmados[f.numero_fila]}
                          onChange={(e) => setConfirmados((prev) => ({ ...prev, [f.numero_fila]: e.target.checked }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hayAltasSinDefaults && tab === "articulos" && (
              <div className="mt-3 grid grid-cols-3 gap-2 bg-white border border-slate-200 rounded p-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Categoría por defecto</label>
                  <input className={inputCls} value={defaults.categoria} onChange={(e) => setDefaults((d) => ({ ...d, categoria: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Departamento por defecto</label>
                  <input className={inputCls} value={defaults.departamento} onChange={(e) => setDefaults((d) => ({ ...d, departamento: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Unidad por defecto</label>
                  <input className={inputCls} value={defaults.unidad} onChange={(e) => setDefaults((d) => ({ ...d, unidad: e.target.value }))} />
                </div>
              </div>
            )}

            <button onClick={aplicar} className="mt-3 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold flex items-center justify-center gap-2">
              <Upload size={15} /> Aplicar importación
            </button>
          </div>
        )}

        {resumen && (
          <div className="bg-white border border-slate-200 rounded p-3 text-sm">
            <p><b>{resumen.nuevos}</b> nuevos, <b>{resumen.actualizados}</b> actualizados, <b>{resumen.errores.length}</b> con error.</p>
            {resumen.errores.length > 0 && (
              <table className="w-full text-xs mt-2">
                <thead><tr className="text-left text-slate-500"><th>Fila</th><th>Clave</th><th>Motivo</th></tr></thead>
                <tbody>
                  {resumen.errores.map((e, i) => (
                    <tr key={i} className="border-t border-slate-100"><td>{e.numero_fila}</td><td>{e.clave}</td><td>{e.motivo}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}
    </div>
  );
}
