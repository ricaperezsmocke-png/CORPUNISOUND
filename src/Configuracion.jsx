import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutGrid, Search, Settings, FileBarChart, PieChart, Wrench,
  RefreshCw, Save, Banknote, CreditCard, Landmark, Ticket, ArrowLeftRight,
  Package, Cloud, Info, UserCircle2, ShoppingCart, Lock
} from "lucide-react";
import { apiFetch } from "./api";

const TIPOS_DOCUMENTO = ["Ticket", "Factura", "Nota de Venta", "Factura CFDI", "Remisión"];

const ICONOS_FORMA_PAGO = {
  EFECTIVO: Banknote, TARJETA: CreditCard, VALES: Ticket,
  CHEQUE: Landmark, TRANSFERENCIA: ArrowLeftRight, CRÉDITO: CreditCard,
};

// Opciones de la pantalla "Ventas" de SICAR que no tienen sistema real
// detrás todavía en este proyecto (CFDI, Lotes, Inventario en Ruta...).
// Se muestran para que la pantalla se vea completa, pero deshabilitadas
// y marcadas honestamente, en vez de fingir que hacen algo.
const OPCIONES_NO_DISPONIBLES = [
  "Permitir Ventas de Artículos donde la Utilidad es Negativa",
  "Preguntar antes de Imprimir",
  "Seleccionar Precio en Descuentos",
  "Preguntar si se desea Enviar Documento por eMail",
  "Solicitar Cantidad al Agregar un Artículo a la Lista de Venta",
  "Permitir Ventas a Granel de Artículos que no están Marcados para Venderse a Granel",
  "Calcular descuentos en base al No. de Precio de Cliente",
  "Permitir Ventas con Cantidades Negativas",
  "Enviar las ventas directamente a crédito",
  "Vincular venta a Inventario en Ruta automáticamente",
];

function Tab({ activo, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activo ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
      {children}
    </button>
  );
}

export default function Configuracion({ onVolverAVenta, onVolverInicio, permisos }) {
  const puedeEditar = !permisos || permisos.includes("editar_configuracion_pos");

  const [tab, setTab] = useState("ventas");
  const [config, setConfig] = useState(null);
  const [condicionesPago, setCondicionesPago] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2200); };

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rConf, rCond] = await Promise.all([
        apiFetch("/configuracion"), apiFetch("/condiciones-pago?sucursal_id=1"),
      ]);
      if (rConf.ok) setConfig(await rConf.json());
      if (rCond.ok) setCondicionesPago(await rCond.json());
    } catch { mostrarAviso("❌ No se pudo conectar con el backend"); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const guardarConfig = async (cambios) => {
    if (!puedeEditar) return mostrarAviso("No tienes permiso para editar la configuración");
    const nuevo = { ...config, ...cambios };
    setConfig(nuevo);
    setGuardando(true);
    try {
      const r = await apiFetch("/configuracion", { method: "PUT", body: JSON.stringify(cambios) });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
      cargarTodo();
    } finally {
      setGuardando(false);
    }
  };

  const actualizarDescuentoPago = async (id, nuevoPct) => {
    if (!puedeEditar) return mostrarAviso("No tienes permiso para editar la configuración");
    setCondicionesPago((prev) => prev.map((c) => (c.id === id ? { ...c, descuento_pct: nuevoPct } : c)));
    try {
      const r = await apiFetch(`/condiciones-pago/${id}`, { method: "PUT", body: JSON.stringify({ descuento_pct: nuevoPct }) });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (e) { mostrarAviso("❌ " + e.message); cargarTodo(); }
  };

  if (cargando || !config) {
    return <div className="w-full h-full flex items-center justify-center text-slate-400">Cargando configuración...</div>;
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm select-none">
      <div className="bg-white border-b border-slate-100 flex items-center shrink-0">
        <button onClick={cargarTodo} className="flex flex-col items-center justify-center gap-1 px-3 py-2 border-r border-slate-100 hover:bg-blue-50">
          <RefreshCw size={18} className="text-[#1a7fe8]" /><span className="text-[10px] font-medium text-slate-500">Recargar</span>
        </button>
        <div className="flex flex-col items-center justify-center gap-1 px-3 py-2 border-r border-slate-100 text-slate-400">
          <Save size={18} /><span className="text-[10px] font-medium">{guardando ? "Guardando..." : "Auto-guardado"}</span>
        </div>
        {!puedeEditar && (
          <div className="flex items-center gap-1.5 px-3 text-xs text-amber-700 bg-amber-50 py-1.5 rounded ml-3">
            <Lock size={12} /> Sin permiso de edición — solo lectura
          </div>
        )}
      </div>

      <div className="bg-white border-b border-slate-200 flex overflow-x-auto shrink-0">
        <Tab activo={tab === "ventas"} onClick={() => setTab("ventas")}>Ventas</Tab>
        <Tab activo={tab === "formas_pago"} onClick={() => setTab("formas_pago")}>Formas de Pago</Tab>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "ventas" && (
          <div className="max-w-3xl">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">General</h3>
            <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 flex items-center gap-6">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Documento por defecto</label>
                <select
                  disabled={!puedeEditar}
                  value={config.documento_por_defecto}
                  onChange={(e) => guardarConfig({ documento_por_defecto: e.target.value })}
                  className="border border-slate-300 rounded px-3 py-1.5 text-sm min-w-[180px] disabled:bg-slate-100"
                >
                  {TIPOS_DOCUMENTO.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
            </div>

            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">CRM / Postventa</h3>
            <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
              <label className="text-xs text-slate-500 block mb-1">Días para seguimiento postventa</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" disabled={!puedeEditar}
                  value={config.dias_seguimiento_postventa}
                  onChange={(e) => guardarConfig({ dias_seguimiento_postventa: Number(e.target.value) || 0 })}
                  className="border border-slate-300 rounded px-3 py-1.5 text-sm w-24 disabled:bg-slate-100"
                />
                <span className="text-sm text-slate-500">días después de la compra (0 desactiva el seguimiento)</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Cuando una venta lleva más de estos días sin seguimiento, aparece en CRM → Hoy con un mensaje de WhatsApp ya redactado para preguntarle al cliente cómo le fue con su compra.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-6">
              {[
                { clave: "permitir_ventas_sin_existencia", etiqueta: "Permitir Ventas de Artículos Sin Existencia" },
                { clave: "cerrar_venta_con_enter", etiqueta: "Cerrar Venta con Enter" },
                { clave: "solicitar_vendedor_al_cerrar_venta", etiqueta: "Solicitar Vendedor al Cerrar Venta" },
                { clave: "permitir_cambio_en_todas_las_formas_de_pago", etiqueta: "Permitir dar Cambio en Efectivo en todas las Formas de Pago" },
              ].map((op) => (
                <label key={op.clave} className={`flex items-center gap-3 px-4 py-3 ${puedeEditar ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed opacity-70"}`}>
                  <input
                    type="checkbox"
                    disabled={!puedeEditar}
                    checked={!!config[op.clave]}
                    onChange={(e) => guardarConfig({ [op.clave]: e.target.checked })}
                  />
                  <span className="text-sm">{op.etiqueta}</span>
                </label>
              ))}
            </div>

            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Otras opciones de SICAR (no disponibles todavía en este sistema)</h3>
            <div className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-100">
              {OPCIONES_NO_DISPONIBLES.map((op) => (
                <div key={op} className="flex items-center gap-3 px-4 py-2.5 text-slate-400">
                  <input type="checkbox" disabled />
                  <span className="text-sm">{op}</span>
                  <Lock size={12} className="ml-auto" />
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "formas_pago" && (
          <div className="max-w-xl">
            <h3 className="text-base font-semibold text-slate-700 mb-4">Descuentos por Forma de Pago</h3>

            <label className={`flex items-center gap-3 mb-6 ${puedeEditar ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
              <button
                disabled={!puedeEditar}
                onClick={() => guardarConfig({ descuentos_pago_habilitado: !config.descuentos_pago_habilitado })}
                className={`w-11 h-6 rounded-full relative transition-colors ${config.descuentos_pago_habilitado ? "bg-blue-600" : "bg-slate-300"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.descuentos_pago_habilitado ? "left-5" : "left-0.5"}`} />
              </button>
              <span className="text-sm font-medium">Habilitar Descuentos por Forma de Pago</span>
            </label>

            {!config.descuentos_pago_habilitado && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mb-4">
                Desactivado: en el cobro se cobrará el total completo sin importar la forma de pago elegida.
              </p>
            )}

            <div className={`bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 ${!config.descuentos_pago_habilitado ? "opacity-50 pointer-events-none" : ""}`}>
              <div className="grid grid-cols-2 px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <span>Formas de Pago</span><span>Descuento</span>
              </div>
              {condicionesPago.map((c) => {
                const Icono = ICONOS_FORMA_PAGO[c.nombre] || Banknote;
                return (
                  <div key={c.id} className="grid grid-cols-2 items-center px-4 py-3">
                    <span className="flex items-center gap-2 text-sm capitalize"><Icono size={16} className="text-slate-400" /> {c.nombre.charAt(0) + c.nombre.slice(1).toLowerCase()}:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" step="0.01" disabled={!puedeEditar}
                        value={c.descuento_pct}
                        onChange={(e) => actualizarDescuentoPago(c.id, Number(e.target.value) || 0)}
                        className="border border-slate-300 rounded px-2 py-1 w-24 text-right disabled:bg-slate-100"
                      />
                      <span className="text-slate-400">%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
      )}
    </div>
  );
}
