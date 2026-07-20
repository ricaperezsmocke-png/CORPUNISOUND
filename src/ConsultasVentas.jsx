import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Eye, RefreshCw, Ban, Download, DollarSign, Mail, FileCheck,
  FileText, FileCode, Users, Printer, LayoutGrid, Search, Settings,
  FileBarChart, PieChart, Wrench, Cloud, Info, UserCircle2, ShoppingCart,
  Package, X
} from "lucide-react";
import { apiFetch } from "./api";

const TIPOS_DOCUMENTO = ["Todos", "Ticket", "Factura", "Nota de Venta", "Factura CFDI", "Remisión"];
const ESTADOS = ["Todos", "cerrada", "cancelada"];

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick, tono = "slate" }) {
  const tonos = { slate: "text-[#1a7fe8]", verde: "text-emerald-600", rojo: "text-red-500" };
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors">
      <Icono size={18} className={tonos[tono]} />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

export default function ConsultasVentas({ onVolverAVenta, onVolverInicio, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  const [ventas, setVentas] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [documento, setDocumento] = useState("Todos");
  const [estado, setEstado] = useState("Todos");
  const [sucursalFiltro, setSucursalFiltro] = useState("");
  const [vendedorFiltro, setVendedorFiltro] = useState("");
  const [texto, setTexto] = useState("");

  const [seleccionadaId, setSeleccionadaId] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [modal, setModal] = useState(null); // "detalle" | "cancelar"
  const [motivoCancelacion, setMotivoCancelacion] = useState("");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const cargarCatalogos = useCallback(async () => {
    try {
      const [rSuc, rVen] = await Promise.all([apiFetch("/sucursales"), apiFetch("/vendedores")]);
      if (rSuc.ok) setSucursales(await rSuc.json());
      if (rVen.ok) setVendedores(await rVen.json());
    } catch { /* silencioso */ }
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fechaInicial) params.set("fecha_inicio", fechaInicial);
      if (fechaFinal) params.set("fecha_fin", fechaFinal);
      if (documento !== "Todos") params.set("tipo_documento", documento);
      if (estado !== "Todos") params.set("estatus", estado);
      if (sucursalFiltro) params.set("sucursal_id", sucursalFiltro);
      if (vendedorFiltro) params.set("vendedor_id", vendedorFiltro);
      if (texto) params.set("texto", texto);
      const r = await apiFetch(`/ventas?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setVentas(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend (http://localhost:4000).");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, documento, estado, sucursalFiltro, vendedorFiltro, texto]);

  useEffect(() => { cargarCatalogos(); consultar(); /* eslint-disable-next-line */ }, []);

  const seleccionada = ventas.find((v) => v.id === seleccionadaId) || null;

  const verDetalle = async () => {
    if (!seleccionada) return mostrarAviso("Selecciona una venta primero");
    if (!puede("mostrar_detalle_venta")) return mostrarAviso("No tienes permiso para ver el detalle de la venta");
    try {
      const r = await apiFetch(`/ventas/${seleccionada.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDetalle(data);
      setModal("detalle");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirCancelar = () => {
    if (!seleccionada) return mostrarAviso("Selecciona una venta primero");
    if (seleccionada.estatus === "cancelada") return mostrarAviso("Esta venta ya está cancelada");
    setMotivoCancelacion("");
    setModal("cancelar");
  };

  const confirmarCancelacion = async () => {
    try {
      const r = await apiFetch(`/ventas/${seleccionada.id}/cancelar`, { method: "PUT", body: JSON.stringify({ motivo: motivoCancelacion }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`Venta folio ${seleccionada.id} cancelada — inventario reintegrado`);
      setModal(null);
      consultar();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const exportarCSV = () => {
    if (!puede("exportar_ventas")) return mostrarAviso("No tienes permiso para exportar");
    if (ventas.length === 0) return mostrarAviso("No hay ventas para exportar");
    const encabezados = ["Folio", "Fecha", "Documento", "Cliente", "Vendedor", "Estado", "Total"];
    const filas = ventas.map((v) => [v.id, v.fecha, v.tipo_documento || "Ticket", v.cliente_nombre, v.vendedor_nombre, v.estatus, v.total]);
    const csv = [encabezados, ...filas].map((f) => f.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ventas_${fechaInicial}_a_${fechaFinal}.csv`; a.click();
    URL.revokeObjectURL(url);
    mostrarAviso("Exportado a CSV");
  };

  const totalPeriodo = useMemo(() => ventas.filter((v) => v.estatus === "cerrada").reduce((a, v) => a + v.total, 0), [ventas]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm select-none">
      <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
        <BotonBarra icono={Eye} etiqueta="Mostrar" atajo="F4" tono="verde" onClick={consultar} />
        <BotonBarra icono={RefreshCw} etiqueta="Recargar" atajo="F5" onClick={consultar} />
        {puede("cancelar_ventas") && <BotonBarra icono={Ban} etiqueta="Cancelar" atajo="F6" tono="rojo" onClick={abrirCancelar} />}
        {puede("exportar_ventas") && <BotonBarra icono={Download} etiqueta="Exportar" atajo="F7" onClick={exportarCSV} />}
        <BotonBarra icono={DollarSign} etiqueta="Saldo" atajo="F8" onClick={() => mostrarAviso("Consulta de saldos — próximamente")} />
        <BotonBarra icono={Mail} etiqueta="eMail" atajo="F11" onClick={() => mostrarAviso("Envío por correo — requiere facturación CFDI")} />
        <BotonBarra icono={FileCheck} etiqueta="Acuse X" atajo="F12" onClick={() => mostrarAviso("Acuse de cancelación — requiere facturación CFDI")} />
        <BotonBarra icono={FileText} etiqueta="Docs" atajo="Alt+D" onClick={verDetalle} />
        <BotonBarra icono={FileCode} etiqueta="XML" atajo="Alt+X" onClick={() => mostrarAviso("XML del CFDI — requiere facturación CFDI")} />
        {puede("imprimir_ventas") && <BotonBarra icono={Printer} etiqueta="Imp" atajo="Alt+P" onClick={() => mostrarAviso("Enviando a impresora...")} />}
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex flex-wrap gap-3 items-end mb-2">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Fecha Inicial</label>
            <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Fecha Final</label>
            <input type="date" value={fechaFinal} onChange={(e) => setFechaFinal(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Documento</label>
            <select value={documento} onChange={(e) => setDocumento(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              {TIPOS_DOCUMENTO.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Estado</label>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm capitalize">
              {ESTADOS.map((e) => <option key={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Caja / Sucursal</label>
            <select value={sucursalFiltro} onChange={(e) => setSucursalFiltro(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todas</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1 flex items-center gap-1"><Users size={11} /> Vendedor</label>
            <select value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
          <button onClick={consultar} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">Consultar</button>
        </div>
        <div className="flex items-center gap-2">
          <Search size={16} className="text-slate-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && consultar()} placeholder="Buscar por folio o cliente..." className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm max-w-md focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Documento</th>
                <th className="py-2 px-3 text-left font-medium">Cliente</th>
                <th className="py-2 px-3 text-left font-medium">Vendedor</th>
                <th className="py-2 px-3 text-center font-medium">Estado</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {ventas.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-400 py-16">Sin resultados para estos filtros</td></tr>
              )}
              {ventas.map((v) => (
                <tr key={v.id} onClick={() => setSeleccionadaId(v.id)} onDoubleClick={verDetalle}
                  className={`border-b border-slate-100 cursor-pointer ${seleccionadaId === v.id ? "bg-blue-50" : "hover:bg-slate-50"} ${v.estatus === "cancelada" ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3">{v.fecha}</td>
                  <td className="py-2 px-3 font-medium">{v.id}</td>
                  <td className="py-2 px-3">{v.tipo_documento || "Ticket"}</td>
                  <td className="py-2 px-3">{v.cliente_nombre}</td>
                  <td className="py-2 px-3">{v.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${v.estatus === "cancelada" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {v.estatus === "cancelada" ? "Cancelada" : "Cerrada"}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-medium">${Number(v.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
        <span>{ventas.length} documento(s) en el rango consultado</span>
        <span>Total del periodo (ventas cerradas): <b>${totalPeriodo.toFixed(2)} MXN</b></span>
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
      )}

      {modal === "detalle" && detalle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-panel-in">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-sm">Detalle — Folio {detalle.id}</h3>
              <button onClick={() => setModal(null)} className="hover:bg-blue-800 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3 text-xs mb-4">
                <div><span className="text-slate-400">Fecha:</span> {detalle.fecha}</div>
                <div><span className="text-slate-400">Documento:</span> {detalle.tipo_documento}</div>
                <div><span className="text-slate-400">Cliente:</span> {detalle.cliente_nombre}</div>
                <div><span className="text-slate-400">Vendedor:</span> {detalle.vendedor_nombre}</div>
                <div><span className="text-slate-400">Sucursal:</span> {detalle.sucursal_nombre}</div>
                <div><span className="text-slate-400">Forma de pago:</span> {detalle.metodo_pago}</div>
              </div>
              <table className="w-full text-xs mb-3">
                <thead><tr className="border-b border-slate-200 text-slate-500"><th className="text-left py-1">Producto</th><th className="text-center py-1">Cant.</th><th className="text-right py-1">Precio</th><th className="text-right py-1">Importe</th></tr></thead>
                <tbody>
                  {detalle.lineas.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-1.5">{l.descripcion}</td>
                      <td className="py-1.5 text-center">{l.cantidad}</td>
                      <td className="py-1.5 text-right">${Number(l.precio_unitario).toFixed(2)}</td>
                      <td className="py-1.5 text-right font-medium">${Number(l.subtotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end gap-6 text-sm">
                <span className="text-slate-500">Subtotal: ${Number(detalle.subtotal).toFixed(2)}</span>
                <span className="text-slate-500">Descuento: ${Number(detalle.descuento).toFixed(2)}</span>
                <span className="font-bold">Total: ${Number(detalle.total).toFixed(2)}</span>
              </div>
              {detalle.estatus === "cancelada" && (
                <div className="mt-3 text-xs bg-red-50 text-red-700 rounded px-3 py-2">Cancelada — motivo: {detalle.motivo_cancelacion || "sin especificar"}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {modal === "cancelar" && seleccionada && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-panel-in">
            <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Cancelar venta — Folio {seleccionada.id}</h3>
              <button onClick={() => setModal(null)} className="hover:bg-red-700 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">Esto reintegra al inventario los productos de esta venta. Esta acción no se puede deshacer.</p>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Motivo de la cancelación</label>
                <input autoFocus value={motivoCancelacion} onChange={(e) => setMotivoCancelacion(e.target.value)} placeholder="ej: Error de captura, cliente se arrepintió..." className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" />
              </div>
              <button onClick={confirmarCancelacion} className="bg-red-600 hover:bg-red-700 text-white py-2 rounded font-semibold">Confirmar cancelación</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
