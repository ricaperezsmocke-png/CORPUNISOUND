import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Truck, PackagePlus, History, X, Search, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto`}>
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

export default function RecepcionCompras({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [recepciones, setRecepciones] = useState([]);
  const [tab, setTab] = useState("nueva"); // "nueva" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);

  const [proveedorId, setProveedorId] = useState("");
  const [sucursalOrigenId, setSucursalOrigenId] = useState("");
  const [factura, setFactura] = useState("");
  const [comentario, setComentario] = useState("");
  const [renglones, setRenglones] = useState([]); // [{ producto_id, cantidad, costo }]

  const [modalBuscar, setModalBuscar] = useState(false);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreProveedor = (id) => proveedores.find((p) => p.id === id)?.nombre || `Proveedor ${id}`;
  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;

  const origenEfectivo = usuario?.ver_todas ? (sucursalOrigenId || "todas") : usuario?.sucursal_id;

  const cargarProductos = useCallback(async (origen) => {
    try {
      const r = await apiFetch(`/productos?sucursal_id=${origen || "todas"}`);
      setProductos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rSuc, rProv, rCat, rDep, rComp] = await Promise.all([
        apiFetch(`/sucursales`), apiFetch(`/proveedores`), apiFetch(`/categorias`), apiFetch(`/departamentos`), apiFetch(`/compras`)
      ]);
      setSucursales(await rSuc.json());
      setProveedores(await rProv.json());
      setCategorias(await rCat.json());
      setDepartamentos(await rDep.json());
      setRecepciones(await rComp.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);
  useEffect(() => { cargarProductos(origenEfectivo); }, [origenEfectivo, cargarProductos]);

  const crearProveedorRapido = async () => {
    const nombre = prompt("Nombre del nuevo proveedor:");
    if (!nombre || !nombre.trim()) return;
    try {
      const r = await apiFetch(`/proveedores`, { method: "POST", body: JSON.stringify({ nombre }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setProveedores((prev) => [...prev, nuevo]);
      setProveedorId(nuevo.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirBuscarProducto = () => {
    setBusquedaTexto(""); setFiltroCategoria(""); setFiltroDepartamento(""); setPaginaBusqueda(1);
    setModalBuscar(true);
  };

  const agregarRenglon = (p) => {
    setRenglones((prev) => {
      if (prev.some((r) => r.producto_id === p.id)) return prev; // ya está en la lista
      return [...prev, { producto_id: p.id, cantidad: "1", costo: String(p.costo ?? 0) }];
    });
    setModalBuscar(false);
  };

  const actualizarRenglon = (producto_id, campo, valor) => {
    setRenglones((prev) => prev.map((r) => (r.producto_id === producto_id ? { ...r, [campo]: valor } : r)));
  };

  const quitarRenglon = (producto_id) => {
    setRenglones((prev) => prev.filter((r) => r.producto_id !== producto_id));
  };

  const limpiarFormulario = () => {
    setProveedorId(""); setSucursalOrigenId(""); setFactura(""); setComentario(""); setRenglones([]);
  };

  const registrarRecepcion = async () => {
    if (!proveedorId) return mostrarAviso("Selecciona un proveedor");
    if (renglones.length === 0) return mostrarAviso("Agrega al menos un producto");
    for (const r of renglones) {
      if (!r.cantidad || Number(r.cantidad) <= 0) return mostrarAviso("Cada producto necesita una cantidad válida");
    }
    try {
      const payload = {
        proveedor_id: proveedorId,
        factura,
        comentario,
        sucursal_id: sucursalOrigenId,
        renglones: renglones.map((r) => ({ producto_id: r.producto_id, cantidad: r.cantidad, costo: r.costo })),
      };
      const r = await apiFetch(`/compras?sucursal_id=todas`, { method: "POST", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Recepción registrada");
      limpiarFormulario();
      await Promise.all([cargarTodo(), cargarProductos(origenEfectivo)]);
      setTab("historial");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  // ---------- Buscador de producto (idéntico visualmente al de Traspasos / Punto de Venta) ----------
  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria, filtroDepartamento]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
        <button onClick={() => setTab("nueva")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "nueva" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <PackagePlus size={14} className="inline mr-1.5 -mt-0.5" /> Nueva recepción
        </button>
        <button onClick={() => setTab("historial")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "historial" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <History size={14} className="inline mr-1.5 -mt-0.5" /> Historial ({recepciones.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Cargando...</p>
        ) : tab === "nueva" ? (
          <div className="max-w-2xl bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Proveedor">
                <div className="flex gap-1.5">
                  <select className={inputCls} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  <button onClick={crearProveedorRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo proveedor"><Plus size={14} /></button>
                </div>
              </Campo>
              <Campo label="Factura / remisión">
                <input className={inputCls} value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="ej: A-1024" />
              </Campo>
            </div>
            {puede("ver_todas_las_sucursales") && (
              <Campo label="Sucursal que recibe">
                <select className={inputCls} value={sucursalOrigenId} onChange={(e) => setSucursalOrigenId(e.target.value)}>
                  <option value="">Selecciona...</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Comentario (opcional)">
              <input className={inputCls} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Campo>

            <div className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500">Productos</span>
                <button type="button" onClick={abrirBuscarProducto} className="text-xs bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded flex items-center gap-1">
                  <Search size={13} /> Agregar producto
                </button>
              </div>
              {renglones.length === 0 ? (
                <p className="text-center text-slate-400 py-6 text-xs border border-dashed border-slate-200 rounded">Sin productos agregados</p>
              ) : (
                <table className="w-full text-sm border border-slate-200 rounded overflow-hidden">
                  <thead className="bg-[#1a7fe8] text-white">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium">Producto</th>
                      <th className="py-2 px-3 text-center font-medium w-24">Cantidad</th>
                      <th className="py-2 px-3 text-center font-medium w-28">Costo</th>
                      <th className="py-2 px-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {renglones.map((r) => (
                      <tr key={r.producto_id} className="border-b border-slate-100">
                        <td className="py-2 px-3">{nombreProducto(r.producto_id)}</td>
                        <td className="py-1 px-2">
                          <input type="number" className={inputCls} value={r.cantidad} onChange={(e) => actualizarRenglon(r.producto_id, "cantidad", e.target.value)} />
                        </td>
                        <td className="py-1 px-2">
                          <input type="number" className={inputCls} value={r.costo} onChange={(e) => actualizarRenglon(r.producto_id, "costo", e.target.value)} />
                        </td>
                        <td className="text-center">
                          <button onClick={() => quitarRenglon(r.producto_id)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <button onClick={registrarRecepcion} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-2">Registrar recepción</button>
          </div>
        ) : (
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Proveedor</th>
                <th className="py-2 px-3 text-left font-medium">Factura</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-center font-medium">Productos</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recepciones.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin recepciones registradas</td></tr>
              )}
              {recepciones.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{nombreProveedor(c.proveedor_id)}</td>
                  <td className="py-2 px-3">{c.factura || "—"}</td>
                  <td className="py-2 px-3">{nombreSucursal(c.sucursal_id)}</td>
                  <td className="py-2 px-3 text-center">{c.renglones.length}</td>
                  <td className="py-2 px-3 text-slate-500">{new Date(c.fecha).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
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
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-center font-medium w-20">Exist.</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Costo</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => agregarRenglon(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-600">{p.existencia}</td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.costo || 0).toFixed(2)}</td>
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
