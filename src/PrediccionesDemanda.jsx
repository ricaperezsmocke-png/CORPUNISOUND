import React, { useState, useEffect, useMemo } from "react";
import { Search, X, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { apiFetch } from "./api";

function Modal({ titulo, onCerrar, children, ancho = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto animate-panel-in`}>
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold text-sm text-slate-700">{titulo}</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const RESULTADOS_POR_PAGINA = 8;

function fechaMinima() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function fechaMaxima() {
  const d = new Date();
  d.setMonth(d.getMonth() + 24);
  return d.toISOString().slice(0, 10);
}

// Meses entre hoy y la fecha elegida, con tope de 24 (más allá de eso una
// regresión lineal simple pierde sentido estadístico - ver spec, sección
// "Riesgo abierto").
function calcularMesesAdelante(fechaLimiteStr) {
  if (!fechaLimiteStr) return 3;
  const hoy = new Date();
  const limite = new Date(fechaLimiteStr + "T00:00:00");
  const meses = (limite.getFullYear() - hoy.getFullYear()) * 12 + (limite.getMonth() - hoy.getMonth());
  return Math.min(24, Math.max(1, meses));
}

const CONFIANZA_ESTILO = {
  alta: "bg-emerald-100 text-emerald-700",
  media: "bg-amber-100 text-amber-700",
  baja: "bg-red-100 text-red-700",
};

export default function PrediccionesDemanda({ onVolver, permisos, usuario }) {
  const [modo, setModo] = useState("producto"); // "producto" | "categoria"
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [productoId, setProductoId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [fechaLimite, setFechaLimite] = useState("");
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const [modalBuscar, setModalBuscar] = useState(false);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);

  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [sucursales, setSucursales] = useState([]);
  const [sucursalImportar, setSucursalImportar] = useState("");
  const [previsualizacionHistorial, setPrevisualizacionHistorial] = useState(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const inputHistorialRef = React.useRef(null);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 3000); };

  useEffect(() => {
    apiFetch("/productos").then((r) => r.json()).then(setProductos).catch(() => {});
    apiFetch("/categorias").then((r) => r.json()).then(setCategorias).catch(() => {});
  }, []);

  useEffect(() => { apiFetch("/sucursales").then((r) => r.json()).then(setSucursales).catch(() => {}); }, []);

  useEffect(() => { setResultado(null); }, [modo, productoId, categoriaId]);

  const productoSeleccionado = productos.find((p) => p.id === Number(productoId)) || null;

  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase())
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const abrirBuscarProducto = () => {
    setBusquedaTexto(""); setFiltroCategoria(""); setPaginaBusqueda(1);
    setModalBuscar(true);
  };

  const elegirProducto = (p) => {
    setProductoId(String(p.id));
    setModalBuscar(false);
  };

  const calcular = async () => {
    if (modo === "producto" && !productoId) return mostrarAviso("Selecciona un producto");
    if (modo === "categoria" && !categoriaId) return mostrarAviso("Selecciona una categoría");
    if (!fechaLimite) return mostrarAviso("Elige hasta qué fecha quieres predecir");
    const meses_adelante = calcularMesesAdelante(fechaLimite);
    setCargando(true);
    setResultado(null);
    try {
      const params = new URLSearchParams({ meses_adelante: String(meses_adelante) });
      if (modo === "producto") params.set("producto_id", productoId);
      else params.set("categoria_id", categoriaId);
      const r = await apiFetch(`/predicciones?${params.toString()}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo calcular la predicción");
      setResultado(data);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargando(false);
    }
  };

  const leerArchivoComoBase64 = (archivo) =>
    new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(",")[1]);
      lector.onerror = reject;
      lector.readAsDataURL(archivo);
    });

  const subirHistorial = async (archivo) => {
    if (usuario?.ver_todas && !sucursalImportar) {
      return mostrarAviso("Selecciona la sucursal de origen del archivo primero");
    }
    setCargandoHistorial(true);
    setPrevisualizacionHistorial(null);
    try {
      const archivo_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch("/predicciones/historial/previsualizar", { method: "POST", body: JSON.stringify({ archivo_base64 }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPrevisualizacionHistorial(data);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargandoHistorial(false);
      if (inputHistorialRef.current) inputHistorialRef.current.value = "";
    }
  };

  const aplicarHistorial = async () => {
    setCargandoHistorial(true);
    try {
      const r = await apiFetch("/predicciones/historial/aplicar", {
        method: "POST",
        body: JSON.stringify({ agregados: previsualizacionHistorial.agregados, sucursal_id: sucursalImportar || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`Historial aplicado: ${data.renglones_aplicados} renglones, ${data.producto_id_actualizados} productos actualizados`);
      setPrevisualizacionHistorial(null);
      setMostrarImportar(false);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargandoHistorial(false);
    }
  };

  // Combina historico + prediccion en un solo arreglo por periodo, para que
  // Recharts dibuje ambas series sobre el mismo eje de tiempo compartido.
  const datosGrafica = useMemo(() => {
    if (!resultado || resultado.error) return [];
    const filas = {};
    (resultado.historico || []).forEach((h) => { filas[h.periodo] = { periodo: h.periodo, historico: h.cantidad }; });
    (resultado.prediccion || []).forEach((p) => {
      filas[p.periodo] = { ...(filas[p.periodo] || { periodo: p.periodo }), prediccion: p.cantidad_estimada };
    });
    const filasOrdenadas = Object.values(filas).sort((a, b) => a.periodo.localeCompare(b.periodo));
    // El histórico y la predicción son periodos consecutivos, nunca el mismo
    // mes — sin esto, las dos líneas quedarían con un salto visual entre
    // ellas en vez de verse conectadas.
    const ultimoHistorico = [...filasOrdenadas].reverse().find((f) => f.historico !== undefined);
    if (ultimoHistorico) ultimoHistorico.prediccion = ultimoHistorico.historico;
    return filasOrdenadas;
  }, [resultado]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3 max-w-xl">
          <div className="flex gap-2">
            <button
              onClick={() => setModo("producto")}
              className={`flex-1 py-2 rounded text-xs font-medium border ${modo === "producto" ? "bg-blue-700 text-white border-blue-700" : "border-slate-300 text-slate-600"}`}
            >
              Producto
            </button>
            <button
              onClick={() => setModo("categoria")}
              className={`flex-1 py-2 rounded text-xs font-medium border ${modo === "categoria" ? "bg-blue-700 text-white border-blue-700" : "border-slate-300 text-slate-600"}`}
            >
              Categoría
            </button>
          </div>

          {modo === "producto" ? (
            <div>
              <label className="text-xs text-slate-500 block mb-1">Producto</label>
              <button type="button" onClick={abrirBuscarProducto} className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-left hover:bg-slate-50 flex items-center justify-between">
                <span className={productoSeleccionado ? "text-slate-800" : "text-slate-400"}>
                  {productoSeleccionado ? productoSeleccionado.nombre : "Buscar producto..."}
                </span>
                <Search size={14} className="text-slate-400 shrink-0" />
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs text-slate-500 block mb-1">Categoría</label>
              <select className={inputCls} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Selecciona...</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 block mb-1">Predecir hasta</label>
            <input type="date" className={inputCls} min={fechaMinima()} max={fechaMaxima()} value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} />
            <p className="text-[11px] text-slate-500 mt-1">Máximo 24 meses hacia adelante.</p>
          </div>

          <button onClick={calcular} disabled={cargando} className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white py-2 rounded font-semibold flex items-center justify-center gap-2">
            <TrendingUp size={15} /> {cargando ? "Calculando..." : "Calcular predicción"}
          </button>
        </div>

        {resultado?.error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-4 max-w-xl">
            {resultado.error}
          </div>
        )}

        {resultado && !resultado.error && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CONFIANZA_ESTILO[resultado.confianza] || "bg-slate-100 text-slate-600"}`}>
                Confianza {resultado.confianza}
              </span>
              <span className="text-xs text-slate-500">{resultado.meses_de_historial} mes(es) de historial real</span>
            </div>
            {resultado.nota && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{resultado.nota}</p>
            )}

            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={datosGrafica}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="historico" name="Histórico" stroke="#1a7fe8" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="prediccion" name="Predicción" stroke="#1a7fe8" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <table className="w-full text-xs">
              <thead className="bg-[#1a7fe8] text-white">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Periodo</th>
                  <th className="py-2 px-3 text-right font-medium">Cantidad</th>
                  <th className="py-2 px-3 text-left font-medium">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {(resultado.historico || []).map((h) => (
                  <tr key={"h-" + h.periodo} className="border-b border-slate-100">
                    <td className="py-1.5 px-3">{h.periodo}</td>
                    <td className="py-1.5 px-3 text-right">{h.cantidad}</td>
                    <td className="py-1.5 px-3 text-slate-500">Histórico</td>
                  </tr>
                ))}
                {(resultado.prediccion || []).map((p) => (
                  <tr key={"p-" + p.periodo} className="border-b border-slate-100">
                    <td className="py-1.5 px-3">{p.periodo}</td>
                    <td className="py-1.5 px-3 text-right">{p.cantidad_estimada}</td>
                    <td className="py-1.5 px-3 text-blue-700">Proyectado</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg p-4 max-w-xl">
          <button onClick={() => setMostrarImportar((v) => !v)} className="text-sm font-semibold text-blue-700 hover:text-blue-800">
            {mostrarImportar ? "▾" : "▸"} Importar historial de ventas (SICAR)
          </button>
          {mostrarImportar && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-slate-500">
                Sube el reporte de ventas de SICAR (CSV, "Reporte General de Ventas") de una sucursal para mejorar la confianza de las predicciones con historial real.
              </p>
              {usuario?.ver_todas && (
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Sucursal de origen del archivo</label>
                  <select className={inputCls} value={sucursalImportar} onChange={(e) => setSucursalImportar(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              )}
              <input ref={inputHistorialRef} type="file" accept=".csv" disabled={cargandoHistorial}
                onChange={(e) => e.target.files[0] && subirHistorial(e.target.files[0])} />

              {cargandoHistorial && <p className="text-slate-400 text-center py-2">Procesando...</p>}

              {previsualizacionHistorial && (
                <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-col gap-2 text-xs">
                  <p><b>{previsualizacionHistorial.tickets_leidos}</b> tickets leídos, <b>{previsualizacionHistorial.renglones_leidos}</b> renglones de producto.</p>
                  <p>Periodo: {previsualizacionHistorial.fecha_min} a {previsualizacionHistorial.fecha_max}</p>
                  <p className="text-emerald-700"><b>{previsualizacionHistorial.claves_reconocidas}</b> claves de producto reconocidas</p>
                  <p className="text-amber-700"><b>{previsualizacionHistorial.claves_ignoradas}</b> claves no reconocidas (se ignoran)</p>
                  <button onClick={aplicarHistorial} disabled={cargandoHistorial} className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white py-2 rounded font-semibold mt-1">
                    Aplicar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
      )}

      {modalBuscar && (
        <Modal titulo="Buscar producto" onCerrar={() => setModalBuscar(false)} ancho="max-w-2xl">
          <input
            autoFocus
            value={busquedaTexto}
            onChange={(e) => { setBusquedaTexto(e.target.value); setPaginaBusqueda(1); }}
            placeholder="Clave o descripción..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => elegirProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-center gap-3 mt-3">
            <button disabled={paginaBusqueda <= 1} onClick={() => setPaginaBusqueda((p) => p - 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-500">Página {paginaBusqueda} de {totalPaginas}</span>
            <button disabled={paginaBusqueda >= totalPaginas} onClick={() => setPaginaBusqueda((p) => p + 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </Modal>
      )}
    </div>
  );
}
