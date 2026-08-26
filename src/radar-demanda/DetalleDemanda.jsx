import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarClock, CheckCircle2, Clock3, History, Loader2, PackageCheck,
  Phone, Plus, Search, ShoppingCart, UserRound, X,
} from "lucide-react";
import {
  actualizarDemanda, cambiarEstadoDemanda, listarVentasCandidatas, mensajeErrorRadar,
  obtenerDemanda, obtenerHistorialDemanda, registrarSeguimiento,
} from "./radarDemandaApi";
import { fechaCorta, nombreProducto } from "./MisDemandas";

const input = "w-full rounded-xl neu px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const terminales = new Set(["CONVERTIDA", "NO_CONVERTIDA", "CANCELADA"]);
const etiquetas = {
  REGISTRADA: "Registrada", EN_SEGUIMIENTO: "En seguimiento", PRODUCTO_DISPONIBLE: "Producto disponible",
  CLIENTE_CONTACTADO: "Cliente contactado", CONVERTIDA: "Convertida", NO_CONVERTIDA: "No convertida", CANCELADA: "Cancelada",
};
const acciones = {
  EN_SEGUIMIENTO: "Iniciar seguimiento", PRODUCTO_DISPONIBLE: "Producto disponible",
  CLIENTE_CONTACTADO: "Marcar como contactado", CONVERTIDA: "Venta realizada",
  NO_CONVERTIDA: "No se concretó", CANCELADA: "Cancelar",
};
const motivosNoConversion = ["Cliente compró en otro lugar", "Precio", "Tiempo de entrega", "No respondió", "Perdió interés", "Otro"];

function proximaAccion(demanda) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (demanda.fecha_seguimiento) {
    const fecha = new Date(`${demanda.fecha_seguimiento.slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(fecha.getTime()) && fecha < hoy && !terminales.has(demanda.estado)) return "Contactar cliente hoy";
  }
  return {
    REGISTRADA: "Iniciar seguimiento", EN_SEGUIMIENTO: "Revisar disponibilidad",
    PRODUCTO_DISPONIBLE: "Contactar cliente", CLIENTE_CONTACTADO: "Registrar resultado",
    CONVERTIDA: "Venta recuperada", NO_CONVERTIDA: "Oportunidad cerrada", CANCELADA: "Registro cancelado",
  }[demanda.estado] || "Revisar demanda";
}

function Campo({ etiqueta, valor }) {
  return <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-700">{valor || "—"}</dd></div>;
}

function Modal({ titulo, children, onClose }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
    <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl neu-panel p-4 shadow-2xl sm:rounded-2xl sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">{titulo}</h2><button aria-label="Cerrar" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

export default function DetalleDemanda({ id, clientes, meta, permisos, onVolver, onActualizada }) {
  const puedeSeguimiento = permisos.includes("dar_seguimiento_demanda");
  const puedeCerrar = permisos.includes("cerrar_demanda");
  const [demanda, setDemanda] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [comentario, setComentario] = useState("");
  const [fecha, setFecha] = useState("");
  const [estadoOpcional, setEstadoOpcional] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ventas, setVentas] = useState([]);
  const [busquedaVenta, setBusquedaVenta] = useState("");

  const cargar = async () => {
    setCargando(true); setError("");
    try {
      const [detalle, movimientos] = await Promise.all([obtenerDemanda(id), obtenerHistorialDemanda(id)]);
      setDemanda(detalle); setHistorial(movimientos);
    } catch (e) { setError(mensajeErrorRadar(e, "ver")); }
    finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, [id]);

  const cliente = useMemo(() => clientes.find((item) => Number(item.id) === Number(demanda?.cliente_id)), [clientes, demanda]);
  const contacto = demanda?.nombre_contacto || cliente?.nombre || "Anónimo";
  const telefono = demanda?.telefono_contacto || cliente?.celular || cliente?.telefono || "";
  const transiciones = demanda ? (meta?.transiciones?.[demanda.estado] || []) : [];
  const transicionesSeguimiento = transiciones.filter((estado) => !terminales.has(estado));
  const transicionesVisibles = transiciones.filter((estado) => terminales.has(estado) ? puedeCerrar : puedeSeguimiento);

  const terminar = async () => { setModal(null); setComentario(""); setFecha(""); setEstadoOpcional(""); await cargar(); await onActualizada?.(); };
  const ejecutar = async (trabajo) => {
    setGuardando(true); setError("");
    try { await trabajo(); await terminar(); }
    catch (e) { setError(mensajeErrorRadar(e)); }
    finally { setGuardando(false); }
  };
  const guardarSeguimiento = () => ejecutar(async () => {
    if (!comentario.trim()) throw new Error("El comentario es obligatorio.");
    await registrarSeguimiento(id, comentario.trim());
    await actualizarDemanda(id, { fecha_seguimiento: fecha || null, requiere_seguimiento: true });
    if (estadoOpcional) await cambiarEstadoDemanda(id, estadoOpcional, comentario.trim());
  });
  const abrirVenta = async () => {
    setModal("venta"); setError("");
    try { setVentas(await listarVentasCandidatas(id)); }
    catch (e) { setError(mensajeErrorRadar(e)); setVentas([]); }
  };
  const abrirModal = (valor) => { setError(""); setComentario(""); setModal(valor); };
  const cambiarEstado = (estado, textoComentario = comentario, ventaId) => ejecutar(async () => {
    if (estado === "CANCELADA" && !textoComentario.trim()) throw new Error("El comentario es obligatorio para cancelar.");
    await cambiarEstadoDemanda(id, estado, textoComentario.trim(), ventaId);
  });

  if (cargando) return <div className="flex justify-center py-20 text-slate-500"><Loader2 className="animate-spin" /></div>;
  if (!demanda) return <div><button onClick={onVolver} className="mb-4 flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={17} /> Volver</button><div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div></div>;

  return <div className="space-y-4">
    <button onClick={onVolver} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={17} /> Volver a la lista</button>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-700 to-indigo-700 p-5 text-white shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-100">Siguiente acción</p><div className="mt-2 flex items-center gap-3"><Clock3 size={25} /><p className="text-xl font-extrabold">{proximaAccion(demanda)}</p></div>
    </section>
    <section className="neu rounded-2xl p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase text-blue-600">Demanda #{demanda.id}</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900">{nombreProducto(demanda)}</h1><p className="mt-1 text-sm text-slate-500">SKU: {demanda.producto_sku_registrado || "Sin SKU"}</p></div><span className="w-fit rounded-full bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-800">{etiquetas[demanda.estado] || demanda.estado}</span></div>
      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
        <Campo etiqueta="Producto libre" valor={demanda.producto_buscado} /><Campo etiqueta="Marca" valor={demanda.marca_solicitada} /><Campo etiqueta="Modelo" valor={demanda.modelo_solicitado} /><Campo etiqueta="Variante" valor={demanda.variante_solicitada} />
        <Campo etiqueta="Cantidad" valor={demanda.cantidad} /><Campo etiqueta="Motivo" valor={demanda.motivo_no_venta?.replaceAll("_", " ")} /><Campo etiqueta="Sucursal" valor={demanda.sucursal_nombre} /><Campo etiqueta="Fecha" valor={fechaCorta(demanda.fecha_registro)} />
        <Campo etiqueta="Cliente / contacto" valor={contacto} /><Campo etiqueta="Teléfono" valor={telefono} /><Campo etiqueta="Vendedor" valor={demanda.vendedor_nombre} /><Campo etiqueta="Registró" valor={demanda.usuario_nombre} />
        <Campo etiqueta="Seguimiento" valor={fechaCorta(demanda.fecha_seguimiento)} /><Campo etiqueta="Notas" valor={demanda.notas} /><Campo etiqueta="Venta recuperada" valor={demanda.venta_recuperada_id ? `Venta #${demanda.venta_recuperada_id}` : "—"} />
      </dl>
    </section>
    {!terminales.has(demanda.estado) && (puedeSeguimiento || puedeCerrar) && <section className="neu rounded-2xl p-4 sm:p-5">
      <h2 className="font-bold text-slate-900">Acciones</h2><div className="mt-3 flex flex-wrap gap-2">
        {puedeSeguimiento && <button onClick={() => { setFecha(demanda.fecha_seguimiento || ""); abrirModal("seguimiento"); }} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"><Plus size={17} /> Registrar seguimiento</button>}
        {transicionesVisibles.map((estado) => <button key={estado} onClick={() => estado === "CONVERTIDA" ? abrirVenta() : abrirModal(estado)} className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${estado === "CANCELADA" ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>{acciones[estado] || etiquetas[estado]}</button>)}
      </div>
    </section>}
    <section className="neu rounded-2xl p-4 sm:p-6"><div className="mb-4 flex items-center gap-2"><History size={19} className="text-blue-600" /><h2 className="font-bold text-slate-900">Historial</h2></div>{historial.length ? <ol className="space-y-4 border-l-2 border-slate-200 pl-4">{historial.map((item) => <li key={item.id}><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-800">{item.tipo === "CAMBIO_ESTADO" ? `${etiquetas[item.estado_anterior]} → ${etiquetas[item.estado_nuevo]}` : "Seguimiento"}</span><span className="text-xs text-slate-400">{new Date(item.fecha_hora).toLocaleString("es-MX")}</span></div><p className="mt-1 text-sm text-slate-600">{item.comentario || "Sin comentario"}</p><p className="mt-1 text-xs text-slate-400">{item.usuario_nombre || "Usuario"}</p></li>)}</ol> : <p className="text-sm text-slate-500">Sin movimientos todavía.</p>}</section>

    {modal === "seguimiento" && <Modal titulo="Registrar seguimiento" onClose={() => setModal(null)}><div className="space-y-4"><label className="block text-sm font-semibold text-slate-700">Comentario *<textarea autoFocus className={`${input} mt-1 min-h-24`} value={comentario} onChange={(e) => setComentario(e.target.value)} /></label><label className="block text-sm font-semibold text-slate-700">Próxima fecha de seguimiento<input type="date" className={`${input} mt-1`} value={fecha} onInput={(e) => setFecha(e.currentTarget.value)} onChange={(e) => setFecha(e.target.value)} /></label>{transicionesSeguimiento.length > 0 && <label className="block text-sm font-semibold text-slate-700">Cambio de estado opcional<select className={`${input} mt-1`} value={estadoOpcional} onChange={(e) => setEstadoOpcional(e.target.value)}><option value="">Sin cambio</option>{transicionesSeguimiento.map((estado) => <option key={estado} value={estado}>{etiquetas[estado]}</option>)}</select></label>}<button disabled={guardando} onClick={guardarSeguimiento} className="min-h-11 w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50">Guardar seguimiento</button></div></Modal>}
    {modal === "PRODUCTO_DISPONIBLE" && <Modal titulo="Marcar producto disponible" onClose={() => setModal(null)}><p className="mb-4 text-sm text-slate-600">Esta acción es manual y no modifica inventario.</p><textarea className={`${input} min-h-20`} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario opcional" /><button disabled={guardando} onClick={() => cambiarEstado("PRODUCTO_DISPONIBLE")} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 font-bold text-white"><PackageCheck size={18} /> Confirmar disponibilidad</button></Modal>}
    {modal === "CLIENTE_CONTACTADO" && <Modal titulo="Marcar cliente contactado" onClose={() => setModal(null)}><div className="mb-4 rounded-xl bg-slate-50 p-4"><p className="flex items-center gap-2 font-bold text-slate-800"><UserRound size={17} />{contacto}</p><p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Phone size={16} />{telefono || "Sin teléfono"}</p></div><textarea className={`${input} min-h-20`} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario opcional" /><button disabled={guardando} onClick={() => cambiarEstado("CLIENTE_CONTACTADO")} className="mt-4 min-h-11 w-full rounded-xl bg-purple-600 font-bold text-white">Marcar como contactado</button></Modal>}
    {modal === "NO_CONVERTIDA" && <Modal titulo="No se concretó" onClose={() => setModal(null)}><div className="flex flex-wrap gap-2">{motivosNoConversion.map((motivo) => <button key={motivo} onClick={() => setComentario(motivo)} className={`rounded-xl border px-3 py-2 text-sm ${comentario === motivo ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300"}`}>{motivo}</button>)}</div><textarea className={`${input} mt-4 min-h-20`} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario opcional" /><button disabled={guardando} onClick={() => cambiarEstado("NO_CONVERTIDA")} className="mt-4 min-h-11 w-full rounded-xl bg-slate-700 font-bold text-white">Cerrar como no concretada</button></Modal>}
    {modal === "CANCELADA" && <Modal titulo="Cancelar demanda" onClose={() => setModal(null)}><p className="mb-3 text-sm text-red-700">Solo para duplicado, captura incorrecta o solicitud inválida.</p>{error && <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<textarea className={`${input} min-h-24`} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Motivo obligatorio *" /><button disabled={guardando} onClick={() => cambiarEstado("CANCELADA")} className="mt-4 min-h-11 w-full rounded-xl bg-red-600 font-bold text-white">Cancelar demanda</button></Modal>}
    {modal === "venta" && <Modal titulo="Marcar como venta realizada" onClose={() => setModal(null)}><div className="relative mb-3"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className={`${input} pl-9`} value={busquedaVenta} onChange={(e) => setBusquedaVenta(e.target.value)} placeholder="Buscar folio o cliente" /></div><div className="max-h-72 space-y-2 overflow-y-auto">{ventas.filter((venta) => `${venta.id} ${venta.cliente_nombre}`.toLowerCase().includes(busquedaVenta.toLowerCase())).map((venta) => <button key={venta.id} disabled={guardando} onClick={() => cambiarEstado("CONVERTIDA", "Venta recuperada", venta.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-emerald-400 hover:bg-emerald-50"><span><span className="block font-bold text-slate-800">Venta #{venta.id}</span><span className="text-xs text-slate-500">{fechaCorta(venta.fecha)} · {venta.cliente_nombre} · {venta.vendedor_nombre || "Sin vendedor"}</span></span><span className="shrink-0 font-bold text-emerald-700">${Number(venta.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span></button>)}</div>{!ventas.length && <p className="py-8 text-center text-sm text-slate-500">No hay ventas candidatas.</p>}</Modal>}
    {demanda.estado === "CONVERTIDA" && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800"><CheckCircle2 size={21} /> Venta recuperada</div>}
  </div>;
}
