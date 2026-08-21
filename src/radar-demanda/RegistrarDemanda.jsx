import React, { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Minus, PackageSearch, Plus, Search, UserRound, X } from "lucide-react";
import { MOTIVOS, mensajeErrorRadar, registrarDemanda } from "./radarDemandaApi";

const VACIO = {
  producto_id: null, producto_buscado: "", marca_solicitada: "", modelo_solicitado: "",
  variante_solicitada: "", categoria_solicitada: "", motivo_no_venta: "", cantidad: 1,
  cliente_id: null, nombre_contacto: "", telefono_contacto: "", requiere_seguimiento: false,
  fecha_seguimiento: "", notas: "",
};

const input = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const RESULTADOS_POR_PAGINA = 8;

export default function RegistrarDemanda({ productos, clientes, catalogosProducto = {}, puedeRegistrar, sinSucursal, onRegistrada }) {
  const [form, setForm] = useState(VACIO);
  const [busqueda, setBusqueda] = useState("");
  const [buscadorProductoAbierto, setBuscadorProductoAbierto] = useState(false);
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);
  const [modoProducto, setModoProducto] = useState("catalogo");
  const [modoCliente, setModoCliente] = useState("anonimo");
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [observacionAbierta, setObservacionAbierta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState(false);
  const envioEnCurso = useRef(false);

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase("es");
    let lista = productos.filter((p) => !q || `${p.sku || ""} ${p.nombre || ""} ${p.codigo || ""}`.toLocaleLowerCase("es").includes(q));
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroProveedor) lista = lista.filter((p) => String(p.proveedor_id) === filtroProveedor);
    return lista;
  }, [busqueda, productos, filtroDepartamento, filtroCategoria, filtroProveedor]);
  const totalPaginas = Math.max(1, Math.ceil(coincidencias.length / RESULTADOS_POR_PAGINA));
  const productosPagina = coincidencias.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const clientesFiltrados = useMemo(() => {
    const q = busquedaCliente.trim().toLocaleLowerCase("es");
    if (!q) return clientes.slice(0, 8);
    return clientes.filter((c) => `${c.nombre || ""} ${c.telefono || ""} ${c.celular || ""}`.toLocaleLowerCase("es").includes(q)).slice(0, 8);
  }, [busquedaCliente, clientes]);

  const actualizar = (campo, valor) => setForm((actual) => ({ ...actual, [campo]: valor }));
  const reiniciar = () => {
    setForm(VACIO); setBusqueda(""); setBusquedaCliente(""); setModoProducto("catalogo");
    setModoCliente("anonimo"); setObservacionAbierta(false); setError(""); setExito(false);
  };

  const elegirProducto = (producto) => {
    setForm((actual) => ({ ...actual, producto_id: producto.id, producto_buscado: "" }));
    setBusqueda(producto.nombre);
    setBuscadorProductoAbierto(false);
  };

  const abrirCapturaLibre = () => {
    setBuscadorProductoAbierto(false);
    setModoProducto("libre");
    setBusqueda("");
    actualizar("producto_id", null);
  };

  const cambiarModoCliente = (modo) => {
    setModoCliente(modo);
    setForm((actual) => ({ ...actual, cliente_id: null, nombre_contacto: "", telefono_contacto: "" }));
  };

  const guardar = async (evento) => {
    evento.preventDefault();
    if (envioEnCurso.current) return;
    setError("");
    const cantidad = Number(form.cantidad);
    if (!form.producto_id && !form.producto_buscado.trim()) return setError("Indica qué producto pidió el cliente.");
    if (!form.motivo_no_venta) return setError("Selecciona el motivo por el que no se realizó la venta.");
    if (!Number.isInteger(cantidad) || cantidad < 1) return setError("La cantidad debe ser mayor que cero.");
    if (!puedeRegistrar) return setError("No tienes permiso para registrar demandas.");
    if (sinSucursal) return setError("Elige una sucursal en el encabezado antes de registrar la demanda.");
    envioEnCurso.current = true;
    setGuardando(true);
    try {
      const payload = { ...form, cantidad, fecha_seguimiento: form.fecha_seguimiento || null };
      await registrarDemanda(payload);
      setExito(true);
      onRegistrada?.();
    } catch (e) {
      setError(mensajeErrorRadar(e));
    } finally {
      envioEnCurso.current = false;
      setGuardando(false);
    }
  };

  if (exito) return (
    <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={28} /></div>
      <h2 className="text-xl font-bold text-slate-800">Demanda registrada</h2>
      <p className="mt-2 text-sm text-slate-500">La solicitud quedó guardada para seguimiento.</p>
      <button onClick={reiniciar} className="mt-6 min-h-11 rounded-xl bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700">Registrar otra</button>
    </div>
  );

  return (
    <form onSubmit={guardar} className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <section>
        <label className="mb-2 block font-semibold text-slate-800">1. ¿Qué pidió el cliente?</label>
        {modoProducto === "catalogo" ? <>
          <button type="button" onClick={() => setBuscadorProductoAbierto(true)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-left transition hover:border-blue-500 hover:bg-blue-50">
            <Search className="shrink-0 text-blue-600" size={19} />
            <span className="min-w-0 flex-1"><span className={`block truncate text-sm font-semibold ${form.producto_id ? "text-slate-800" : "text-slate-500"}`}>{form.producto_id ? busqueda : "Abrir buscador de productos"}</span>{form.producto_id && <span className="text-xs text-slate-500">Haz clic para cambiar el producto</span>}</span>
            {form.producto_id && <span role="button" aria-label="Quitar producto" onClick={(e) => { e.stopPropagation(); setBusqueda(""); actualizar("producto_id", null); }} className="rounded-full p-1 text-slate-400 hover:bg-white hover:text-slate-700"><X size={18} /></span>}
          </button>
          <button type="button" onClick={abrirCapturaLibre} className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border-2 border-dashed border-blue-300 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50"><PackageSearch size={18} /> No encuentro el producto</button>
        </> : <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-start justify-between gap-3"><p className="text-xs font-medium text-amber-800">Este registro NO dará de alta el producto en inventario.</p><button type="button" onClick={() => { setModoProducto("catalogo"); setForm((actual) => ({ ...actual, producto_buscado: "", marca_solicitada: "", modelo_solicitado: "", variante_solicitada: "", categoria_solicitada: "" })); }} className="text-xs font-semibold text-blue-700">Buscar catálogo</button></div>
          <input className={input} value={form.producto_buscado} onChange={(e) => actualizar("producto_buscado", e.target.value)} placeholder="Producto solicitado *" autoFocus />
          <div className="grid gap-3 sm:grid-cols-2"><input className={input} value={form.marca_solicitada} onChange={(e) => actualizar("marca_solicitada", e.target.value)} placeholder="Marca" /><input className={input} value={form.modelo_solicitado} onChange={(e) => actualizar("modelo_solicitado", e.target.value)} placeholder="Modelo" /><input className={input} value={form.variante_solicitada} onChange={(e) => actualizar("variante_solicitada", e.target.value)} placeholder="Variante" /><input className={input} value={form.categoria_solicitada} onChange={(e) => actualizar("categoria_solicitada", e.target.value)} placeholder="Categoría" /></div>
        </div>}
      </section>

      <section><label className="mb-2 block font-semibold text-slate-800">2. ¿Por qué no se vendió?</label><div className="flex flex-wrap gap-2">{MOTIVOS.map(([valor, etiqueta]) => <button type="button" key={valor} onClick={() => actualizar("motivo_no_venta", valor)} className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition ${form.motivo_no_venta === valor ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50"}`}>{etiqueta}</button>)}</div></section>

      <section><label className="mb-2 block font-semibold text-slate-800">3. Cantidad</label><div className="flex w-fit items-center overflow-hidden rounded-xl border border-slate-300"><button type="button" aria-label="Restar cantidad" onClick={() => actualizar("cantidad", Math.max(1, Number(form.cantidad) - 1 || 1))} className="flex h-11 w-12 items-center justify-center bg-slate-50 hover:bg-slate-100"><Minus size={18} /></button><input aria-label="Cantidad" type="number" step="1" value={form.cantidad} onChange={(e) => actualizar("cantidad", e.target.value)} className="h-11 w-16 border-x border-slate-300 text-center font-bold outline-none" /><button type="button" aria-label="Sumar cantidad" onClick={() => actualizar("cantidad", Math.max(1, Number(form.cantidad) || 1) + 1)} className="flex h-11 w-12 items-center justify-center bg-slate-50 hover:bg-slate-100"><Plus size={18} /></button></div></section>

      <section><label className="mb-1 block font-semibold text-slate-800">4. Cliente / contacto</label><p className="mb-2 text-xs text-slate-500">¿Quieres guardar quién lo pidió?</p><div className="flex flex-wrap gap-2">{[["anonimo", "No / Anónimo"], ["cliente", "Buscar cliente"], ["rapido", "Contacto rápido"]].map(([valor, etiqueta]) => <button type="button" key={valor} onClick={() => cambiarModoCliente(valor)} className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${modoCliente === valor ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600"}`}>{etiqueta}</button>)}</div>
        {modoCliente === "cliente" && <div className="mt-3 rounded-xl border border-slate-200 p-3"><input className={input} value={busquedaCliente} onChange={(e) => setBusquedaCliente(e.target.value)} placeholder="Buscar cliente por nombre o teléfono..." /><div className="mt-2 max-h-48 overflow-y-auto">{clientesFiltrados.map((c) => <button type="button" key={c.id} onClick={() => actualizar("cliente_id", c.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${form.cliente_id === c.id ? "bg-blue-50 font-semibold text-blue-700" : ""}`}><UserRound size={16} />{c.nombre}</button>)}</div></div>}
        {modoCliente === "rapido" && <div className="mt-3 grid gap-3 sm:grid-cols-2"><input className={input} value={form.nombre_contacto} onChange={(e) => actualizar("nombre_contacto", e.target.value)} placeholder="Nombre" /><input className={input} value={form.telefono_contacto} onChange={(e) => actualizar("telefono_contacto", e.target.value)} placeholder="Teléfono / WhatsApp" /></div>}
      </section>

      <section><label className="mb-2 block font-semibold text-slate-800">5. ¿Debemos avisarle si conseguimos el producto?</label><div className="flex gap-2"><button type="button" onClick={() => actualizar("requiere_seguimiento", true)} className={`min-h-11 rounded-xl border px-6 font-semibold ${form.requiere_seguimiento ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>Sí</button><button type="button" onClick={() => actualizar("requiere_seguimiento", false)} className={`min-h-11 rounded-xl border px-6 font-semibold ${!form.requiere_seguimiento ? "border-slate-600 bg-slate-700 text-white" : "border-slate-300"}`}>No</button></div>{form.requiere_seguimiento && <div className="mt-3"><label className="text-xs text-slate-500">Fecha de seguimiento (opcional)</label><input type="date" className={`${input} mt-1 max-w-xs`} value={form.fecha_seguimiento} onChange={(e) => actualizar("fecha_seguimiento", e.target.value)} />{modoCliente === "anonimo" && <p className="mt-2 text-xs text-amber-700">Necesitamos un contacto para poder darle seguimiento.</p>}</div>}</section>

      <section><button type="button" onClick={() => setObservacionAbierta((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700">{observacionAbierta ? <ChevronUp size={16} /> : <ChevronDown size={16} />} 6. {observacionAbierta ? "Ocultar observación" : "Agregar observación"}</button>{observacionAbierta && <textarea className={`${input} mt-2 min-h-20 resize-y`} value={form.notas} onChange={(e) => actualizar("notas", e.target.value)} placeholder="Observaciones opcionales..." />}</section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
      <button type="submit" disabled={guardando || !puedeRegistrar || sinSucursal} className="min-h-12 w-full rounded-xl bg-blue-600 px-5 font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{guardando ? "Registrando…" : "Registrar demanda"}</button>

      {buscadorProductoAbierto && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-buscador-productos" onMouseDown={(e) => { if (e.target === e.currentTarget) setBuscadorProductoAbierto(false); }}>
        <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5"><h2 id="titulo-buscador-productos" className="text-lg font-bold text-slate-800">Buscar producto</h2><button type="button" aria-label="Cerrar buscador" onClick={() => setBuscadorProductoAbierto(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
          <div className="p-4 sm:p-5">
            <div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input autoFocus className={`${input} pl-10`} value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPaginaBusqueda(1); }} placeholder="Clave, descripción o código de barras..." /></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <select aria-label="Filtrar por departamento" className={input} value={filtroDepartamento} onChange={(e) => { setFiltroDepartamento(e.target.value); setPaginaBusqueda(1); }}><option value="">Todos los departamentos</option>{(catalogosProducto.departamentos || []).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select>
              <select aria-label="Filtrar por categoría" className={input} value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }}><option value="">Todas las categorías</option>{(catalogosProducto.categorias || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
              <select aria-label="Filtrar por proveedor" className={input} value={filtroProveedor} onChange={(e) => { setFiltroProveedor(e.target.value); setPaginaBusqueda(1); }}><option value="">Todos los proveedores</option>{(catalogosProducto.proveedores || []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
            </div>
            <div className="mt-4 max-h-[55vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[650px] text-sm"><thead className="sticky top-0 bg-blue-600 text-white"><tr><th className="px-3 py-2 text-left font-semibold">Clave / Descripción</th><th className="w-32 px-3 py-2 text-left font-semibold">Localización</th><th className="w-24 px-3 py-2 text-center font-semibold">Exist.</th><th className="w-28 px-3 py-2 text-right font-semibold">Precio</th></tr></thead><tbody>
                {productosPagina.map((p) => <tr key={p.id} onClick={() => elegirProducto(p)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-blue-50"><td className="px-3 py-3"><span className="block text-xs text-slate-400">{p.sku || p.codigo || "Sin clave"}</span><span className="font-semibold text-slate-800">{p.nombre}</span></td><td className="px-3 py-3 text-slate-500">{p.ubicacion || "—"}</td><td className={`px-3 py-3 text-center font-semibold ${Number(p.existencia) <= 0 ? "text-red-600" : "text-emerald-700"}`}>{p.existencia ?? 0}</td><td className="px-3 py-3 text-right font-semibold text-blue-700">${Number(p.precio_venta || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td></tr>)}
                {!productosPagina.length && <tr><td colSpan="4" className="px-4 py-10 text-center text-slate-400">Sin resultados</td></tr>}
              </tbody></table>
            </div>
            <div className="mt-3 flex items-center justify-center gap-3"><button type="button" aria-label="Página anterior" disabled={paginaBusqueda <= 1} onClick={() => setPaginaBusqueda((p) => Math.max(1, p - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-600 disabled:opacity-30">‹</button><span className="text-sm text-slate-500">Página {paginaBusqueda} de {totalPaginas}</span><button type="button" aria-label="Página siguiente" disabled={paginaBusqueda >= totalPaginas} onClick={() => setPaginaBusqueda((p) => Math.min(totalPaginas, p + 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-600 disabled:opacity-30">›</button></div>
            <button type="button" onClick={abrirCapturaLibre} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 text-sm font-semibold text-blue-700 hover:bg-blue-50"><PackageSearch size={18} /> No encuentro el producto</button>
          </div>
        </div>
      </div>}
    </form>
  );
}
