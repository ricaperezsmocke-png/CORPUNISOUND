import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Edit3, RefreshCw, Trash2, SlidersHorizontal, Copy, Printer,
  Search, ChevronLeft, ChevronRight, Camera, MapPin, X, Tag
} from "lucide-react";

import { apiFetch } from "./api";
import RecepcionCompras from "./RecepcionCompras.jsx";
import MigracionDatos from "./MigracionDatos.jsx";
// Carga diferida: recharts (usado solo aqui) es una dependencia pesada -
// que no se descargue para todo el mundo, solo para quien abre esta pestaña.
const PrediccionesDemanda = React.lazy(() => import("./PrediccionesDemanda.jsx"));

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick, tono = "slate" }) {
  const tonos = {
    slate: "text-[#1a7fe8]",
    verde: "text-emerald-600",
    rojo: "text-red-500",
  };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors"
    >
      <Icono size={18} className={tonos[tono]} />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

function Campo({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

const FORM_VACIO = {
  clave: "", clave_alterna: "", servicio: false, descripcion: "",
  categoria_id: "", departamento_id: "", proveedor_id: "",
  unidad_compra: "PZA", unidad_venta: "PZA", factor: 1,
  iva: false, precio_compra: "", neto: true,
  precios: [{ utilidad: "", precioVenta: 0 }, { utilidad: "", precioVenta: 0 }, { utilidad: "", precioVenta: 0 }, { utilidad: "", precioVenta: 0 }],
  unidades_por_mayoreo: 0,
  existencia_inicial: 0, existencia_minima: 0, existencia_maxima: 0,
  imagen_url: "",
};

const TABS = [
  { id: "productos", etiqueta: "Productos" },
  { id: "compras", etiqueta: "Recepción de Compras", permiso: "recibir_compra" },
  { id: "migracion", etiqueta: "Migración de Datos", permiso: "migrar_datos" },
  { id: "predicciones", etiqueta: "Predicciones", permiso: "ver_predicciones" },
];

export default function InventarioProductos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [tab, setTab] = useState("productos");
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [seleccionadoId, setSeleccionadoId] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [modal, setModal] = useState(null); // "form" | "ajustar" | null
  const [modoForm, setModoForm] = useState("crear"); // "crear" | "editar"
  const [form, setForm] = useState(FORM_VACIO);
  const [ajusteCantidad, setAjusteCantidad] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const [cargandoImagen, setCargandoImagen] = useState(false);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2200); };

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rProd, rCat, rProv, rDep] = await Promise.all([
        apiFetch(`/productos`), apiFetch(`/categorias`), apiFetch(`/proveedores`), apiFetch(`/departamentos`)
      ]);
      if (!rProd.ok || !rCat.ok || !rProv.ok || !rDep.ok) throw new Error("El backend respondió con error");
      setProductos(await rProd.json());
      setCategorias(await rCat.json());
      setProveedores(await rProv.json());
      setDepartamentos(await rDep.json());
    } catch (e) {
      setError("No se pudo conectar con el backend (http://localhost:4000). ¿Está corriendo `npm start` dentro de /backend?");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const productosFiltrados = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    if (!t) return productos;
    return productos.filter((p) => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || (p.clave_alterna || "").toLowerCase().includes(t));
  }, [productos, filtro]);

  const seleccionado = productos.find((p) => p.id === seleccionadoId) || null;

  // ---------- Formulario ----------
  const abrirCrear = async () => {
    let clave = "";
    try {
      const r = await apiFetch(`/productos/generar-clave`);
      clave = (await r.json()).clave;
    } catch {}
    setForm({ ...FORM_VACIO, clave });
    setModoForm("crear");
    setModal("form");
  };

  const precioTiersParaEditar = (p) => {
    if (p.precios?.length === 4) return p.precios;
    const costo = Number(p.costo) || 0;
    const precioVenta = Number(p.precio_venta) || 0;
    const utilidad = costo > 0 ? Math.round(((precioVenta - costo) / costo) * 10000) / 100 : 0;
    return [
      { utilidad, precioVenta },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ];
  };

  const abrirEditar = () => {
    if (!seleccionado) return mostrarAviso("Selecciona un producto primero");
    setForm({
      clave: seleccionado.sku, clave_alterna: seleccionado.clave_alterna || "",
      servicio: seleccionado.servicio, descripcion: seleccionado.nombre,
      categoria_id: seleccionado.categoria_id || "", departamento_id: seleccionado.departamento_id || "",
      proveedor_id: seleccionado.proveedor_id || "",
      unidad_compra: seleccionado.unidad_compra, unidad_venta: seleccionado.unidad_venta, factor: seleccionado.factor,
      iva: seleccionado.iva, precio_compra: seleccionado.costo, neto: seleccionado.neto,
      precios: precioTiersParaEditar(seleccionado),
      unidades_por_mayoreo: seleccionado.unidades_por_mayoreo || 0,
      existencia_inicial: seleccionado.existencia, existencia_minima: seleccionado.existencia_minima, existencia_maxima: seleccionado.existencia_maxima,
      imagen_url: seleccionado.imagen_url || "",
    });
    setModoForm("editar");
    setModal("form");
  };

  const jalarImagenML = async () => {
    const itemId = prompt("Ingresa el ID del ítem de MercadoLibre (ej: MLM123456789):");
    if (!itemId) return;
    setCargandoImagen(true);
    try {
      const r = await apiFetch(`/ml/item-imagen/${itemId.trim()}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const url = d.thumbnail || (d.pictures && d.pictures[0]);
      if (url) setForm((f) => ({ ...f, imagen_url: url }));
      else mostrarAviso("El ítem no tiene imágenes");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargandoImagen(false);
    }
  };

  const actualizarTier = (idx, campo, valor) => {
    setForm((f) => {
      const precios = [...f.precios];
      const utilidad = campo === "utilidad" ? Number(valor) || 0 : Number(precios[idx].utilidad) || 0;
      const costo = Number(f.precio_compra) || 0;
      const precioVenta = Math.round(costo * (1 + utilidad / 100) * 100) / 100;
      precios[idx] = { utilidad: campo === "utilidad" ? valor : precios[idx].utilidad, precioVenta };
      return { ...f, precios };
    });
  };

  const recalcularTodosLosTiers = (nuevoPrecioCompra) => {
    setForm((f) => {
      const costo = Number(nuevoPrecioCompra) || 0;
      const precios = f.precios.map((t) => ({ ...t, precioVenta: Math.round(costo * (1 + (Number(t.utilidad) || 0) / 100) * 100) / 100 }));
      return { ...f, precio_compra: nuevoPrecioCompra, precios };
    });
  };

  const guardarProducto = async () => {
    if (!form.descripcion.trim()) return mostrarAviso("La descripción es obligatoria");
    try {
      const payload = { ...form, categoria_id: form.categoria_id || null, proveedor_id: form.proveedor_id || null, departamento_id: form.departamento_id || null };
      const url = modoForm === "crear" ? `/productos` : `/productos/${seleccionado.id}`;
      const metodo = modoForm === "crear" ? "POST" : "PUT";
      const r = await apiFetch(url, { method: metodo, body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error al guardar");
      mostrarAviso(modoForm === "crear" ? "Producto agregado" : "Producto actualizado");
      setModal(null);
      await cargarTodo();
      if (modoForm === "crear") setSeleccionadoId(data.id);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const eliminarSeleccionado = async () => {
    if (!seleccionado) return mostrarAviso("Selecciona un producto primero");
    if (!confirm(`¿Eliminar "${seleccionado.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await apiFetch(`/productos/${seleccionado.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error);
      mostrarAviso("Producto eliminado");
      setSeleccionadoId(null);
      cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const clonarSeleccionado = async () => {
    if (!seleccionado) return mostrarAviso("Selecciona un producto primero");
    try {
      const r = await apiFetch(`/productos/${seleccionado.id}/clonar`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Producto clonado");
      await cargarTodo();
      setSeleccionadoId(data.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirAjustar = () => {
    if (!seleccionado) return mostrarAviso("Selecciona un producto primero");
    setAjusteCantidad(""); setAjusteMotivo("");
    setModal("ajustar");
  };

  const confirmarAjuste = async () => {
    const cantidad = Number(ajusteCantidad);
    if (!cantidad) return mostrarAviso("Escribe una cantidad distinta de cero");
    try {
      const r = await apiFetch(`/productos/${seleccionado.id}/ajustar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad, motivo: ajusteMotivo || "Ajuste manual" })
      });
      if (!r.ok) throw new Error((await r.json()).error);
      mostrarAviso("Existencia ajustada");
      setModal(null);
      cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const crearCategoriaRapida = async () => {
    const nombre = prompt("Nombre de la nueva categoría:");
    if (!nombre) return;
    try {
      const r = await apiFetch(`/categorias`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
      const nueva = await r.json();
      if (!r.ok) throw new Error(nueva.error);
      setCategorias((prev) => [...prev, nueva]);
      setForm((f) => ({ ...f, categoria_id: nueva.id }));
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const crearProveedorRapido = async () => {
    const nombre = prompt("Nombre del nuevo proveedor:");
    if (!nombre) return;
    try {
      const r = await apiFetch(`/proveedores`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setProveedores((prev) => [...prev, nuevo]);
      setForm((f) => ({ ...f, proveedor_id: nuevo.id }));
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const crearDepartamentoRapido = async () => {
    const nombre = prompt("Nombre del nuevo departamento:");
    if (!nombre) return;
    try {
      const r = await apiFetch(`/departamentos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setDepartamentos((prev) => [...prev, nuevo]);
      setForm((f) => ({ ...f, departamento_id: nuevo.id }));
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  // ---------- Atajos de teclado ----------
  useEffect(() => {
    const manejador = (e) => {
      if (tab !== "productos") return;
      if (modal) return;
      if (e.key === "F3" && puede("crear_producto")) { e.preventDefault(); abrirCrear(); }
      else if (e.key === "F4" && puede("editar_producto")) { e.preventDefault(); abrirEditar(); }
      else if (e.key === "F5") { e.preventDefault(); cargarTodo(); mostrarAviso("Lista recargada"); }
      else if (e.key === "F6" && puede("eliminar_producto")) { e.preventDefault(); eliminarSeleccionado(); }
      else if (e.key === "F8" && puede("ajustar_existencia")) { e.preventDefault(); abrirAjustar(); }
      else if (e.key === "F9" && puede("clonar_producto")) { e.preventDefault(); clonarSeleccionado(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "p") { e.preventDefault(); mostrarAviso("Enviando listado a impresora..."); }
    };
    window.addEventListener("keydown", manejador);
    return () => window.removeEventListener("keydown", manejador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, seleccionado, productos, tab]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      {/* Pestañas del módulo */}
      <div className="bg-white border-b border-slate-100 flex items-center px-2 shrink-0">
        {TABS.filter((t) => !t.permiso || puede(t.permiso)).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {tab === "productos" && (
      <div className="flex-1 min-h-0 w-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      {/* Barra de herramientas */}
      <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
        {puede("crear_producto") && <BotonBarra icono={Plus} etiqueta="Agregar" atajo="F3" tono="verde" onClick={abrirCrear} />}
        {puede("editar_producto") && <BotonBarra icono={Edit3} etiqueta="Editar" atajo="F4" onClick={abrirEditar} />}
        <BotonBarra icono={RefreshCw} etiqueta="Recargar" atajo="F5" onClick={() => { cargarTodo(); mostrarAviso("Lista recargada"); }} />
        {puede("eliminar_producto") && <BotonBarra icono={Trash2} etiqueta="Eliminar" atajo="F6" tono="rojo" onClick={eliminarSeleccionado} />}
        {puede("ajustar_existencia") && <BotonBarra icono={SlidersHorizontal} etiqueta="Ajustar" atajo="F8" onClick={abrirAjustar} />}
        {puede("clonar_producto") && <BotonBarra icono={Copy} etiqueta="Clonar" atajo="F9" onClick={clonarSeleccionado} />}
        <BotonBarra icono={Printer} etiqueta="Imp." atajo="Ctrl+P" onClick={() => mostrarAviso("Enviando listado a impresora...")} />
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2">{error}</div>
      )}

      {/* Cuerpo: lista + panel de detalle */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 border-r border-slate-300">
          <div className="p-3 border-b border-slate-200 flex gap-2 bg-white">
            <Search size={16} className="text-slate-400 mt-2" />
            <input
              value={filtro} onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por clave o descripción..."
              className="flex-1 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {cargando ? (
              <p className="text-center text-slate-400 py-16">Cargando catálogo...</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#1a7fe8] text-white sticky top-0">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                    <th className="py-2 px-3 text-center font-medium w-24">Exist.</th>
                    <th className="py-2 px-3 text-right font-medium w-24">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {productosFiltrados.length === 0 && (
                    <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin productos — presiona F3 para agregar el primero</td></tr>
                  )}
                  {productosFiltrados.map((p) => {
                    const bajoStock = p.existencia < p.existencia_minima;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSeleccionadoId(p.id)}
                        className={`border-b border-slate-100 cursor-pointer ${seleccionadoId === p.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="py-2 px-3">
                          <div className="text-[11px] text-slate-400">{p.sku}</div>
                          <div className="font-medium">{p.nombre}</div>
                        </td>
                        <td className={`py-2 px-3 text-center ${bajoStock ? "text-red-600 font-semibold" : "text-slate-600"}`}>{p.existencia}</td>
                        <td className="py-2 px-3 text-right font-medium">${Number(p.precio_venta).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Panel de artículo seleccionado */}
        <div className="w-80 bg-white flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold text-slate-600">Artículo Seleccionado</div>
          {!seleccionado ? (
            <div className="flex-1 flex items-center justify-center text-slate-300 text-center px-6">Selecciona un producto de la lista</div>
          ) : (
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-center bg-slate-50 rounded-lg" style={{ minHeight: 80 }}>
                {seleccionado.imagen_url ? (
                  <img
                    src={seleccionado.imagen_url} alt=""
                    className="max-h-28 max-w-full object-contain rounded py-1"
                    onError={(e) => { e.target.style.display = "none"; e.target.parentNode.querySelector(".img-fallback").style.display = "flex"; }}
                  />
                ) : null}
                <div className={`img-fallback items-center justify-center gap-3 py-4 ${seleccionado.imagen_url ? "hidden" : "flex"}`}>
                  <ChevronLeft size={16} className="text-slate-300" />
                  <Camera size={28} className="text-slate-300" />
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">{seleccionado.sku}</div>
                <div className="font-semibold text-base">{seleccionado.nombre}</div>
                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><Tag size={12} /> {seleccionado.categoria_nombre}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-[11px] text-slate-400">Precio</div>
                  <div className="font-semibold">${Number(seleccionado.precio_venta).toFixed(2)}</div>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-[11px] text-slate-400">Costo</div>
                  <div className="font-semibold">${Number(seleccionado.costo).toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400"><MapPin size={12} /> Sucursal Centro</div>
              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                <span className="text-sm text-slate-500">Cantidad Disponible</span>
                <span className={`text-xl font-bold ${seleccionado.existencia < seleccionado.existencia_minima ? "text-red-600" : "text-emerald-700"}`}>
                  {seleccionado.existencia}
                </span>
              </div>
              {seleccionado.existencia < seleccionado.existencia_minima && (
                <div className="text-[11px] bg-red-50 text-red-700 rounded px-2 py-1.5">
                  Por debajo del mínimo ({seleccionado.existencia_minima}) — considera reabastecer
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pie de estado */}
      <div className="bg-slate-100 border-t border-slate-300 px-3 py-1.5 text-[11px] text-slate-500 shrink-0">
        {productosFiltrados.length} producto(s) {filtro && `· filtrado por "${filtro}"`}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {/* ---------- Modal: Agregar / Editar artículo ---------- */}
      {modal === "form" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-sm text-slate-700">{modoForm === "crear" ? "Agregar artículo" : "Editar artículo"}</h3>
              <button onClick={() => setModal(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Clave">
                  <div className="flex gap-2">
                    <input className={inputCls} value={form.clave} onChange={(e) => setForm({ ...form, clave: e.target.value })} />
                  </div>
                </Campo>
                <Campo label="Clave alterna (código de barras)">
                  <input className={inputCls} value={form.clave_alterna} onChange={(e) => setForm({ ...form, clave_alterna: e.target.value })} />
                </Campo>
              </div>

              <Campo label="Descripción">
                <input autoFocus className={inputCls} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Nombre del producto" />
              </Campo>

              <div className="grid grid-cols-3 gap-3">
                <Campo label="Categoría">
                  <div className="flex gap-1">
                    <select className={inputCls} value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
                      <option value="">Sin definir</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                    <button onClick={crearCategoriaRapida} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nueva categoría"><Plus size={14} /></button>
                  </div>
                </Campo>
                <Campo label="Proveedor">
                  <div className="flex gap-1">
                    <select className={inputCls} value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
                      <option value="">Sin definir</option>
                      {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <button onClick={crearProveedorRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo proveedor"><Plus size={14} /></button>
                  </div>
                </Campo>
                <Campo label="Departamento">
                  <div className="flex gap-1">
                    <select className={inputCls} value={form.departamento_id} onChange={(e) => setForm({ ...form, departamento_id: e.target.value })}>
                      <option value="">Sin definir</option>
                      {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                    </select>
                    <button onClick={crearDepartamentoRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo departamento"><Plus size={14} /></button>
                  </div>
                </Campo>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <Campo label="Unidad de compra"><input className={inputCls} value={form.unidad_compra} onChange={(e) => setForm({ ...form, unidad_compra: e.target.value })} /></Campo>
                <Campo label="Unidad de venta"><input className={inputCls} value={form.unidad_venta} onChange={(e) => setForm({ ...form, unidad_venta: e.target.value })} /></Campo>
                <Campo label="Factor"><input type="number" className={inputCls} value={form.factor} onChange={(e) => setForm({ ...form, factor: e.target.value })} /></Campo>
                <Campo label=" ">
                  <label className="flex items-center gap-2 text-sm mt-2">
                    <input type="checkbox" checked={form.servicio} onChange={(e) => setForm({ ...form, servicio: e.target.checked })} /> Es servicio
                  </label>
                </Campo>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="text-xs font-semibold text-slate-500 mb-2">Precios de venta</div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <Campo label="Precio de compra">
                    <input type="number" className={inputCls} value={form.precio_compra} onChange={(e) => recalcularTodosLosTiers(e.target.value)} />
                  </Campo>
                  <Campo label=" ">
                    <label className="flex items-center gap-2 text-sm mt-2">
                      <input type="checkbox" checked={form.iva} onChange={(e) => setForm({ ...form, iva: e.target.checked })} /> Aplica IVA
                    </label>
                  </Campo>
                  <Campo label=" ">
                    <label className="flex items-center gap-2 text-sm mt-2">
                      <input type="checkbox" checked={form.neto} onChange={(e) => setForm({ ...form, neto: e.target.checked })} /> Precio neto
                    </label>
                  </Campo>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {form.precios.map((tier, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-2.5">
                      <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Precio {idx + 1}</div>
                      <Campo label="% Utilidad">
                        <input type="number" className={inputCls} value={tier.utilidad} onChange={(e) => actualizarTier(idx, "utilidad", e.target.value)} />
                      </Campo>
                      <div className="mt-2 text-xs text-slate-400">Precio venta</div>
                      <div className="font-semibold text-emerald-700">${tier.precioVenta.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <Campo label="Unidades por mayoreo (a partir de cuántas piezas aplica el precio de mayoreo)">
                <input type="number" className={inputCls + " max-w-[160px]"} value={form.unidades_por_mayoreo} onChange={(e) => setForm({ ...form, unidades_por_mayoreo: e.target.value })} />
              </Campo>

              {modoForm === "crear" && (
                <div className="border-t border-slate-200 pt-3">
                  <div className="text-xs font-semibold text-slate-500 mb-2">Inventario inicial</div>
                  <div className="grid grid-cols-3 gap-3">
                    <Campo label="Existencia inicial"><input type="number" className={inputCls} value={form.existencia_inicial} onChange={(e) => setForm({ ...form, existencia_inicial: e.target.value })} /></Campo>
                    <Campo label="Existencia mínima"><input type="number" className={inputCls} value={form.existencia_minima} onChange={(e) => setForm({ ...form, existencia_minima: e.target.value })} /></Campo>
                    <Campo label="Existencia máxima"><input type="number" className={inputCls} value={form.existencia_maxima} onChange={(e) => setForm({ ...form, existencia_maxima: e.target.value })} /></Campo>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-200 pt-3">
                <div className="text-xs font-semibold text-slate-500 mb-2">Imagen del producto</div>
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={form.imagen_url}
                    onChange={(e) => setForm({ ...form, imagen_url: e.target.value })}
                    placeholder="https://... URL de imagen"
                  />
                  <button
                    type="button"
                    onClick={jalarImagenML}
                    disabled={cargandoImagen}
                    className="shrink-0 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 text-slate-800 text-xs font-semibold px-3 rounded"
                  >
                    {cargandoImagen ? "..." : "Jalar de ML"}
                  </button>
                </div>
                {form.imagen_url && (
                  <img
                    src={form.imagen_url} alt="Vista previa"
                    className="mt-2 h-20 w-20 object-cover rounded border border-slate-200"
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                )}
                <p className="text-[10px] text-slate-400 mt-1">Pega una URL directa o usa "Jalar de ML" ingresando el ID de un ítem (ej: MLM123456789)</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setModal(null)} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={guardarProducto} className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modal: Ajustar existencia ---------- */}
      {modal === "ajustar" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
            <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Ajustar existencia (F8)</h3>
              <button onClick={() => setModal(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-sm text-slate-600">{seleccionado.nombre} — existencia actual: <b>{seleccionado.existencia}</b></p>
              <Campo label="Cantidad a sumar (usa negativo para restar)">
                <input autoFocus type="number" className={inputCls} value={ajusteCantidad} onChange={(e) => setAjusteCantidad(e.target.value)} placeholder="ej: 20 ó -5" />
              </Campo>
              <Campo label="Motivo">
                <input className={inputCls} value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)} placeholder="Recepción de mercancía, merma, conteo físico..." />
              </Campo>
              <button onClick={confirmarAjuste} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Aplicar ajuste</button>
            </div>
          </div>
        </div>
      )}
      </div>
      )}

      {tab === "compras" && <RecepcionCompras onVolver={onVolver} permisos={permisos} usuario={usuario} />}
      {tab === "migracion" && <MigracionDatos onVolver={onVolver} permisos={permisos} usuario={usuario} onImportado={cargarTodo} />}
      {tab === "predicciones" && (
        <React.Suspense fallback={<p className="text-center text-slate-400 py-16">Cargando...</p>}>
          <PrediccionesDemanda onVolver={onVolver} permisos={permisos} usuario={usuario} />
        </React.Suspense>
      )}
    </div>
  );
}
