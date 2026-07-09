import React, { useState, useEffect, useCallback } from "react";
import { ArrowRightLeft, Send, PackageCheck, X } from "lucide-react";
import { apiFetch } from "./api";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

const FORM_VACIO = { producto_id: "", cantidad: "", sucursal_destino_id: "", sucursal_origen_id: "", comentario: "" };

export default function Traspasos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [traspasos, setTraspasos] = useState([]);
  const [tab, setTab] = useState("enviar"); // "enviar" | "pendientes" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [modalRecibir, setModalRecibir] = useState(null); // traspaso seleccionado o null
  const [comentarioRecepcion, setComentarioRecepcion] = useState("");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rProd, rSuc, rTras] = await Promise.all([
        apiFetch(`/productos?sucursal_id=todas`), apiFetch(`/sucursales`), apiFetch(`/traspasos`)
      ]);
      setProductos(await rProd.json());
      setSucursales(await rSuc.json());
      setTraspasos(await rTras.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

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
      await cargarTodo();
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
      await cargarTodo();
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const pendientes = traspasos.filter((t) => t.estatus === "en_transito");
  const historial = traspasos.filter((t) => t.estatus === "recibido");

  // Un traspaso pendiente solo se puede recibir si el usuario es global (puede recibir
  // en nombre de cualquier sucursal) o si su propia sucursal es el destino real.
  const puedeRecibir = (t) => !!usuario?.ver_todas || t.sucursal_destino_id === usuario?.sucursal_id;

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
              <select className={inputCls} value={form.producto_id} onChange={(e) => setForm({ ...form, producto_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modalRecibir && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
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
    </div>
  );
}
