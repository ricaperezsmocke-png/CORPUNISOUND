import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowRightLeft, Send, PackageCheck, X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "./api";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

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

const FORM_VACIO = { producto_id: "", cantidad: "", sucursal_destino_id: "", sucursal_origen_id: "", comentario: "" };
const RESULTADOS_POR_PAGINA = 8;

export default function Traspasos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [traspasos, setTraspasos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [tab, setTab] = useState("enviar"); // "enviar" | "pendientes" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [modalRecibir, setModalRecibir] = useState(null); // traspaso seleccionado o null

  const [modalBuscar, setModalBuscar] = useState(false);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);
  const [comentarioRecepcion, setComentarioRecepcion] = useState("");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;

  // Sucursal origen efectiva: la propia (usuario amarrado) o la elegida en el
  // formulario (usuario global). La existencia mostrada en el buscador debe
  // ser siempre la de ESTA sucursal, no una suma global.
  const origenEfectivo = usuario?.ver_todas ? (form.sucursal_origen_id || "todas") : usuario?.sucursal_id;

  const cargarProductos = useCallback(async (origen) => {
    try {
      const r = await apiFetch(`/productos?sucursal_id=${origen || "todas"}`);
      setProductos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rSuc, rTras, rCat, rDep, rProv] = await Promise.all([
        apiFetch(`/sucursales`), apiFetch(`/traspasos`), apiFetch(`/categorias`), apiFetch(`/departamentos`), apiFetch(`/proveedores`)
      ]);
      setSucursales(await rSuc.json());
      setTraspasos(await rTras.json());
      setCategorias(await rCat.json());
      setDepartamentos(await rDep.json());
      setProveedores(await rProv.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);
  useEffect(() => { cargarProductos(origenEfectivo); }, [origenEfectivo, cargarProductos]);

  const enviarTraspaso = async () => {
    if (!form.producto_id) return mostrarAviso("Selecciona un producto");
    if (!form.cantidad || Number(form.cantidad) <= 0) return mostrarAviso("Escribe una cantidad válida");
    if (!form.sucursal_destino_id) return mostrarAviso("Selecciona la sucursal destino");
    try {
      // sucursal_id=todas explícito: evita que apiFetch pise la sucursal_origen_id elegida
      // en el formulario con la sucursal_activa ambiental del selector global.
      const r = await apiFetch(`/traspasos?sucursal_id=todas`, { method: "POST", body: JSON.stringify(form) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Traspaso enviado — queda en tránsito hasta que destino confirme");
      setForm(FORM_VACIO);
      await Promise.all([cargarTodo(), cargarProductos(origenEfectivo)]);
      setTab("pendientes");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const abrirRecibir = (t) => { setModalRecibir(t); setComentarioRecepcion(""); };

  const confirmarRecepcion = async () => {
    try {
      // sucursal_id=todas explícito: evita que apiFetch pise el destino real del traspaso
      // (resuelto server-side) con la sucursal_activa ambiental del selector global.
      const r = await apiFetch(`/traspasos/${modalRecibir.id}/recibir?sucursal_id=todas`, {
        method: "POST", body: JSON.stringify({ comentario: comentarioRecepcion }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Traspaso recibido");
      setModalRecibir(null);
      await Promise.all([cargarTodo(), cargarProductos(origenEfectivo)]);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const pendientes = traspasos.filter((t) => t.estatus === "en_transito");
  const historial = traspasos.filter((t) => t.estatus === "recibido");

  // Un traspaso pendiente solo se puede recibir si el usuario es global (puede recibir
  // en nombre de cualquier sucursal) o si su propia sucursal es el destino real.
  const puedeRecibir = (t) => !!usuario?.ver_todas || t.sucursal_destino_id === usuario?.sucursal_id;

  // ---------- Buscador de producto (idéntico visualmente al de Punto de Venta) ----------
  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    if (filtroProveedor) lista = lista.filter((p) => String(p.proveedor_id) === filtroProveedor);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria, filtroDepartamento, filtroProveedor]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const productoSeleccionado = productos.find((p) => p.id === Number(form.producto_id)) || null;

  const abrirBuscarProducto = () => {
    setBusquedaTexto(""); setFiltroCategoria(""); setFiltroDepartamento(""); setFiltroProveedor(""); setPaginaBusqueda(1);
    setModalBuscar(true);
  };

  const elegirProducto = (p) => {
    setForm((f) => ({ ...f, producto_id: p.id }));
    setModalBuscar(false);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
        <button onClick={() => setTab("enviar")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "enviar" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <Send size={14} className="inline mr-1.5 -mt-0.5" /> Enviar traspaso
        </button>
        <button onClick={() => setTab("pendientes")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "pendientes" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <PackageCheck size={14} className="inline mr-1.5 -mt-0.5" /> Pendientes de recibir ({pendientes.length})
        </button>
        <button onClick={() => setTab("historial")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "historial" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <ArrowRightLeft size={14} className="inline mr-1.5 -mt-0.5" /> Historial
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Cargando...</p>
        ) : tab === "enviar" ? (
          <div className="max-w-md bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3">
            <Campo label="Producto">
              <button type="button" onClick={abrirBuscarProducto} className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-left hover:bg-slate-50 flex items-center justify-between">
                <span className={productoSeleccionado ? "text-slate-800" : "text-slate-400"}>
                  {productoSeleccionado ? productoSeleccionado.nombre : "Buscar producto..."}
                </span>
                <Search size={14} className="text-slate-400 shrink-0" />
              </button>
              {productoSeleccionado && (
                <p className="text-[11px] text-slate-500 mt-1">Existencia en origen: <b>{productoSeleccionado.existencia}</b></p>
              )}
            </Campo>
            <Campo label="Cantidad">
              <input type="number" className={inputCls} value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} />
            </Campo>
            {puede("ver_todas_las_sucursales") && (
              <Campo label="Sucursal origen">
                <select className={inputCls} value={form.sucursal_origen_id} onChange={(e) => setForm({ ...form, sucursal_origen_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Sucursal destino">
              <select className={inputCls} value={form.sucursal_destino_id} onChange={(e) => setForm({ ...form, sucursal_destino_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Comentario (opcional)">
              <input className={inputCls} value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} placeholder="ej: reabasto de fin de mes" />
            </Campo>
            <button onClick={enviarTraspaso} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-2">Enviar traspaso</button>
          </div>
        ) : (
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-center font-medium">Cantidad</th>
                <th className="py-2 px-3 text-left font-medium">Origen → Destino</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                {tab === "pendientes" && <th className="py-2 px-3"></th>}
                {tab === "historial" && <th className="py-2 px-3 text-left font-medium">Comentario recepción</th>}
              </tr>
            </thead>
            <tbody>
              {(tab === "pendientes" ? pendientes : historial).length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin traspasos {tab === "pendientes" ? "pendientes" : "en el historial"}</td></tr>
              )}
              {(tab === "pendientes" ? pendientes : historial).map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{nombreProducto(t.producto_id)}</td>
                  <td className="py-2 px-3 text-center">{t.cantidad}</td>
                  <td className="py-2 px-3">{nombreSucursal(t.sucursal_origen_id)} → {nombreSucursal(t.sucursal_destino_id)}</td>
                  <td className="py-2 px-3 text-slate-500">{new Date(t.fecha_envio).toLocaleString()}</td>
                  {tab === "pendientes" && (
                    <td className="py-2 px-3 text-right">
                      {puedeRecibir(t) ? (
                        <button onClick={() => abrirRecibir(t)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded">Confirmar recepción</button>
                      ) : (
                        <span className="text-xs text-slate-400">Enviado, en tránsito</span>
                      )}
                    </td>
                  )}
                  {tab === "historial" && <td className="py-2 px-3 text-slate-500">{t.comentario_recepcion || "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
      )}

      {modalRecibir && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-panel-in">
            <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Confirmar recepción</h3>
              <button onClick={() => setModalRecibir(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-sm text-slate-600">
                {nombreProducto(modalRecibir.producto_id)} — cantidad: <b>{modalRecibir.cantidad}</b><br />
                De {nombreSucursal(modalRecibir.sucursal_origen_id)} a {nombreSucursal(modalRecibir.sucursal_destino_id)}
              </p>
              <Campo label="Comentario (opcional — ej: mercancía dañada, faltante evidente)">
                <input autoFocus className={inputCls} value={comentarioRecepcion} onChange={(e) => setComentarioRecepcion(e.target.value)} placeholder="Se recibe siempre la cantidad enviada" />
              </Campo>
              <button onClick={confirmarRecepcion} className="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-semibold">Confirmar recepción</button>
            </div>
          </div>
        </div>
      )}

      {modalBuscar && (
        <Modal titulo="Buscar producto" onCerrar={() => setModalBuscar(false)} ancho="max-w-3xl">
          <input
            autoFocus
            value={busquedaTexto}
            onChange={(e) => { setBusquedaTexto(e.target.value); setPaginaBusqueda(1); }}
            placeholder="Clave, descripción o código de barras..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
            <select value={filtroDepartamento} onChange={(e) => { setFiltroDepartamento(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los departamentos</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtroProveedor} onChange={(e) => { setFiltroProveedor(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-center font-medium w-20">Exist.</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Precio</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => elegirProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className={`py-2 px-3 text-center ${p.existencia < p.existencia_minima ? "text-red-600 font-semibold" : "text-slate-600"}`}>{p.existencia}</td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.precio_venta).toFixed(2)}</td>
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
