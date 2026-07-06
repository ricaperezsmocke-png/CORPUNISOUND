import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutGrid, Search, Settings, FileBarChart, PieChart, Wrench,
  Scissors, CircleDollarSign, X, Package, Cloud, Info, UserCircle2,
  ShoppingCart, History
} from "lucide-react";
import { apiFetch } from "./api";

const FORMAS = ["EFECTIVO", "CHEQUE", "VALES", "TARJETA"];
const ETIQUETAS = { EFECTIVO: "Efectivo", CHEQUE: "* Cheque", VALES: "Vales", TARJETA: "* Tarjeta" };

const $fmt = (n) => `$ ${Number(n || 0).toFixed(2)}`;

export default function CorteCaja({ onVolverAVenta, onVolverInicio, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const usuario = (() => { try { return JSON.parse(localStorage.getItem("usuario")) || {}; } catch { return {}; } })();

  const [enCurso, setEnCurso] = useState(null);
  const [cortes, setCortes] = useState([]);
  const [ultimoCorteGuardado, setUltimoCorteGuardado] = useState(null);
  const [modal, setModal] = useState(null); // "corte" | "historial"
  const [contado, setContado] = useState({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
  const [retiro, setRetiro] = useState({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
  const [aviso, setAviso] = useState(null);
  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch("/cortes/en-curso?sucursal_id=1");
      if (r.ok) setEnCurso(await r.json());
      if (puede("ver_historial_cortes")) {
        const rh = await apiFetch("/cortes?sucursal_id=1");
        if (rh.ok) setCortes(await rh.json());
      }
    } catch { mostrarAviso("❌ No se pudo conectar con el backend"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    const manejador = (e) => {
      if (e.key === "F3" && puede("realizar_corte_caja") && !modal) { e.preventDefault(); abrirCorte(); }
      else if (e.key === "Escape" && modal) setModal(null);
    };
    window.addEventListener("keydown", manejador);
    return () => window.removeEventListener("keydown", manejador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, enCurso]);

  const abrirCorte = () => {
    setContado({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
    setRetiro({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
    cargar();
    setModal("corte");
  };

  const dif = (f) => (Number(contado[f]) || 0) - (enCurso?.calculado?.[f] || 0);
  const totalContado = FORMAS.reduce((a, f) => a + (Number(contado[f]) || 0), 0);
  const totalCalculado = enCurso?.total_calculado || 0;
  const totalDif = totalContado - totalCalculado;
  const totalRetiro = FORMAS.reduce((a, f) => a + (Number(retiro[f]) || 0), 0);

  const guardarCorte = async () => {
    try {
      const r = await apiFetch("/cortes", {
        method: "POST",
        body: JSON.stringify({
          sucursal_id: 1,
          contado: Object.fromEntries(FORMAS.map((f) => [f, Number(contado[f]) || 0])),
          retiro: Object.fromEntries(FORMAS.map((f) => [f, Number(retiro[f]) || 0])),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setUltimoCorteGuardado(data);
      setModal(null);
      cargar();
      mostrarAviso(`Corte #${data.id} guardado — el siguiente turno empieza de cero`);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const infoCorte = ultimoCorteGuardado;

  return (
    <div className="w-full h-screen flex flex-col bg-slate-50 text-slate-800 font-sans text-sm select-none">
      {/* Menú superior — mismo patrón que el resto */}
      <div className="bg-blue-700 text-white flex items-stretch justify-between shrink-0">
        <div className="flex">
          <button onClick={onVolverAVenta} className="flex flex-col items-center justify-center gap-1 px-5 py-2 hover:bg-blue-600">
            <LayoutGrid size={20} /><span className="text-[11px] font-medium">Operaciones</span>
          </button>
          {[["Consultas", Search], ["Procesos", Settings], ["Reportes", FileBarChart], ["Estadísticas", PieChart], ["Configuración", Wrench]].map(([t, Icono]) => (
            <button key={t} onClick={onVolverAVenta} className="flex flex-col items-center justify-center gap-1 px-5 py-2 hover:bg-blue-600">
              <Icono size={20} /><span className="text-[11px] font-medium">{t}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 pr-4 text-[11px]">
          <div className="flex flex-col items-end leading-tight">
            <span className="flex items-center gap-1"><Package size={13} /> Caja 1</span>
            <span className="flex items-center gap-1"><Scissors size={13} /> Corte de Caja (F1)</span>
          </div>
          <span className="flex flex-col items-center gap-0.5"><Cloud size={18} /><span>Nube</span></span>
          <span className="flex flex-col items-center gap-0.5"><Info size={18} /><span>Info</span></span>
          <span className="flex flex-col items-center gap-0.5"><UserCircle2 size={18} /><span>{usuario.usuario || "—"}</span></span>
          {onVolverInicio && (
            <button onClick={onVolverInicio} className="ml-2 flex items-center gap-1 bg-blue-800 hover:bg-blue-900 px-3 py-1.5 rounded text-[11px] font-medium">← Inicio</button>
          )}
        </div>
      </div>

      {/* Barra de herramientas */}
      <div className="bg-slate-100 border-b border-slate-300 flex overflow-x-auto shrink-0">
        {puede("realizar_corte_caja") && (
          <button onClick={abrirCorte} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-300 hover:bg-slate-200">
            <Scissors size={20} className="text-emerald-600" />
            <span className="text-[11px] font-medium text-slate-700">Corte (F3)</span>
          </button>
        )}
        {puede("registrar_propina") && (
          <button className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-300 hover:bg-slate-200">
            <CircleDollarSign size={20} className="text-amber-500" />
            <span className="text-[11px] font-medium text-slate-700">Propina (F4)</span>
          </button>
        )}
        {puede("ver_historial_cortes") && (
          <button onClick={() => setModal("historial")} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-300 hover:bg-slate-200">
            <History size={20} className="text-slate-600" />
            <span className="text-[11px] font-medium text-slate-700">Historial</span>
          </button>
        )}
      </div>

      {/* Información del corte */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-center border-b border-slate-200 py-2 font-semibold text-slate-600">Información del Corte de Caja</div>
        <div className="p-6 flex flex-col gap-4 max-w-md">
          {[
            ["Caja:", infoCorte ? `Caja 1 — Sucursal ${infoCorte.sucursal_id}` : "–"],
            ["Usuario:", infoCorte ? infoCorte.usuario_nombre : "–"],
            ["Fecha:", infoCorte ? infoCorte.fecha : "–"],
            ["Hora:", infoCorte ? new Date(infoCorte.fecha_hora).toLocaleTimeString("es-MX") : "–"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-4">
              <span className="font-semibold w-20">{k}</span>
              <span className="text-slate-600">{v}</span>
            </div>
          ))}

          {/* Estado del turno en curso */}
          {enCurso && (
            <div className="mt-4 bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Turno en curso</div>
              <div className="text-sm text-slate-600 mb-1">{enCurso.ventas_incluidas} venta(s) desde {enCurso.desde ? new Date(enCurso.desde).toLocaleString("es-MX") : "el inicio"}</div>
              <div className="text-2xl font-bold text-slate-800">{$fmt(enCurso.total_calculado)}</div>
              <div className="text-xs text-slate-400 mt-1">calculado en caja (sin transferencias ni crédito)</div>
            </div>
          )}
        </div>
      </div>

      {aviso && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>}

      {/* ===== MODAL: CORTE DE CAJA (calcado de SICAR) ===== */}
      {modal === "corte" && enCurso && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Corte de Caja</h3>
              <button onClick={() => setModal(null)} className="hover:bg-slate-100 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6">
              {/* Tabla Contado / Calculado / Diferencia */}
              <div>
                <div className="text-center text-sm font-medium text-slate-600 border-b border-slate-200 pb-2 mb-3">Caja: Caja 1</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left font-medium py-1"></th>
                      <th className="text-center font-medium py-1">Contado</th>
                      <th className="text-center font-medium py-1">Calculado</th>
                      <th className="text-center font-medium py-1">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FORMAS.map((f) => {
                      const d = dif(f);
                      return (
                        <tr key={f}>
                          <td className="py-1.5 pr-2 font-medium">{ETIQUETAS[f]}</td>
                          <td className="py-1.5 px-1">
                            <input
                              type="number" step="0.01" autoFocus={f === "EFECTIVO"}
                              value={contado[f]}
                              onChange={(e) => setContado({ ...contado, [f]: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1.5 text-right focus:outline-none focus:border-blue-500"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="py-1.5 px-1">
                            <div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-right text-slate-600">{$fmt(enCurso.calculado[f])}</div>
                          </td>
                          <td className="py-1.5 px-1">
                            <div className={`border rounded px-2 py-1.5 text-right font-semibold ${d < 0 ? "border-red-200 text-red-600" : "border-blue-200 text-blue-700"}`}>
                              {d < 0 ? `-$ ${Math.abs(d).toFixed(2)}` : $fmt(d)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-slate-300">
                      <td className="py-2 pr-2 font-bold">Total</td>
                      <td className="py-2 px-1"><div className="border border-slate-300 rounded px-2 py-1.5 text-right font-bold">{$fmt(totalContado)}</div></td>
                      <td className="py-2 px-1"><div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-right font-bold">{$fmt(totalCalculado)}</div></td>
                      <td className="py-2 px-1">
                        <div className={`border rounded px-2 py-1.5 text-right font-bold ${totalDif < 0 ? "border-red-200 text-red-600" : "border-blue-200 text-blue-700"}`}>
                          {totalDif < 0 ? `-$ ${Math.abs(totalDif).toFixed(2)}` : $fmt(totalDif)}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Información adicional */}
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <div className="text-center text-xs font-semibold text-blue-700 mb-2">Información Adicional</div>
                  <div className="flex justify-between text-xs text-slate-600 flex-wrap gap-2">
                    <span>Total Transferencias: <b>{$fmt(enCurso.transferencias)}</b></span>
                    <span>Total a Crédito: <b>{$fmt(enCurso.credito)}</b></span>
                    <span>Ventas del turno: <b>{enCurso.ventas_incluidas}</b></span>
                  </div>
                  <p className="text-center text-[11px] text-blue-600 mt-2">Las transferencias y ventas a crédito no entran al conteo físico de la caja</p>
                </div>
              </div>

              {/* Retiro por Corte */}
              <div className="border-l border-slate-200 pl-5">
                <div className="text-center text-sm font-medium text-slate-600 border-b border-slate-200 pb-2 mb-3">Retiro por Corte</div>
                {FORMAS.map((f) => (
                  <div key={f} className="mb-2.5">
                    <label className="text-xs text-slate-500 block mb-0.5">{ETIQUETAS[f].replace("* ", "")}:</label>
                    <input
                      type="number" step="0.01"
                      value={retiro[f]}
                      onChange={(e) => setRetiro({ ...retiro, [f]: e.target.value })}
                      className="w-full border border-slate-300 rounded px-2 py-1.5 text-right focus:outline-none focus:border-blue-500"
                      placeholder="0.00"
                    />
                  </div>
                ))}
                <div className="mt-3 pt-2 border-t border-slate-200">
                  <label className="text-xs text-slate-500 block mb-0.5">Total:</label>
                  <div className="border border-slate-300 bg-slate-50 rounded px-2 py-1.5 text-right font-bold">{$fmt(totalRetiro)}</div>
                </div>
                <button onClick={() => setRetiro(Object.fromEntries(FORMAS.map((f) => [f, contado[f] || ""])))} className="mt-2 w-full text-xs text-blue-700 hover:underline">
                  Retirar todo lo contado
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 p-3 flex justify-center">
              <button onClick={guardarCorte} className="bg-blue-700 hover:bg-blue-800 text-white px-8 py-2 rounded font-semibold flex items-center gap-2">
                💾 Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: HISTORIAL DE CORTES ===== */}
      {modal === "historial" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between sticky top-0">
              <h3 className="font-semibold text-sm">Historial de Cortes</h3>
              <button onClick={() => setModal(null)} className="hover:bg-blue-800 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4">
              {cortes.length === 0 ? <p className="text-center text-slate-400 py-8">Sin cortes registrados todavía</p> : (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2 font-medium">#</th>
                      <th className="text-left py-2 font-medium">Fecha / Hora</th>
                      <th className="text-left py-2 font-medium">Usuario</th>
                      <th className="text-right py-2 font-medium">Calculado</th>
                      <th className="text-right py-2 font-medium">Contado</th>
                      <th className="text-right py-2 font-medium">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cortes.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100">
                        <td className="py-2">{c.id}</td>
                        <td className="py-2">{new Date(c.fecha_hora).toLocaleString("es-MX")}</td>
                        <td className="py-2">{c.usuario_nombre}</td>
                        <td className="py-2 text-right">{$fmt(c.total_calculado)}</td>
                        <td className="py-2 text-right">{$fmt(c.total_contado)}</td>
                        <td className={`py-2 text-right font-semibold ${c.total_diferencia < 0 ? "text-red-600" : "text-blue-700"}`}>
                          {c.total_diferencia < 0 ? `-$ ${Math.abs(c.total_diferencia).toFixed(2)}` : $fmt(c.total_diferencia)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
