import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutGrid, Search, Settings, FileBarChart, PieChart, Wrench,
  Scissors, CircleDollarSign, X, Package, Cloud, Info, UserCircle2,
  ShoppingCart, History
} from "lucide-react";
import { apiFetch, cajaActiva, sinSucursalElegida } from "./api";
import { pedirLista, pedirDato } from "./cargaSegura";

const FORMAS = ["EFECTIVO", "CHEQUE", "VALES", "TARJETA"];
const ETIQUETAS = { EFECTIVO: "Efectivo", CHEQUE: "* Cheque", VALES: "Vales", TARJETA: "* Tarjeta" };

const $fmt = (n) => `$ ${Number(n || 0).toFixed(2)}`;

/** Ticket de resultado de un corte ya guardado: cuánto marcó el POS por forma de
 * pago, cuánto contó el cajero, y la diferencia — para que el cajero se dé
 * cuenta de inmediato si algo no cuadra. Usa los datos que el backend ya
 * calculó y guardó en el corte (no se recalcula nada aquí).
 * El conteo en vivo es a ciegas (Calculado/Diferencia en $0.00, para que no
 * se ajuste el conteo a propósito), pero una vez guardado el corte, el
 * ticket siempre muestra el calculado real y la diferencia real a quien lo
 * guardó — el conteo ya quedó fijo, así que revelarlo aquí ya no compromete
 * el conteo a ciegas, y permite que la cajera vea de inmediato si faltó o
 * sobró dinero. */
function TicketCorte({ corte, onCerrar }) {
  const hayDiferencia = Math.abs(corte.total_diferencia || 0) >= 0.01;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className="neu-panel rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto animate-panel-in">
        <div className="border-b border-black/5 px-4 py-2.5 flex items-center justify-between sticky top-0 neu-panel">
          <h3 className="font-semibold text-sm">Ticket de Corte de Caja #{corte.id}</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded p-1"><X size={18} /></button>
        </div>
        <div className="p-4 font-mono text-xs">
          <div className="text-center mb-3">
            <div className="font-bold text-sm">Corte de Caja</div>
            <div>Sucursal {corte.sucursal_id} — {corte.caja_nombre || `Caja ${corte.caja_id || "—"}`}</div>
          </div>
          {[
            ["Cajero", corte.usuario_nombre],
            ["Fecha", corte.fecha],
            ["Hora", new Date(corte.fecha_hora).toLocaleTimeString("es-MX")],
            ["Ventas incluidas", corte.ventas_incluidas],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-0.5"><span>{k}:</span><span className="font-semibold">{v}</span></div>
          ))}

          <table className="w-full mt-3 border-t border-b border-dashed border-slate-300">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-medium py-1">Forma</th>
                <th className="text-right font-medium py-1">POS marcó</th>
                <th className="text-right font-medium py-1">Contado</th>
                <th className="text-right font-medium py-1">Dif.</th>
              </tr>
            </thead>
            <tbody>
              {FORMAS.map((f) => {
                const d = corte.diferencia?.[f] || 0;
                return (
                  <tr key={f}>
                    <td className="py-0.5">{ETIQUETAS[f]}</td>
                    <td className="text-right py-0.5">{$fmt(corte.calculado?.[f])}</td>
                    <td className="text-right py-0.5">{$fmt(corte.contado?.[f])}</td>
                    <td className={`text-right py-0.5 font-semibold ${d < 0 ? "text-red-600" : d > 0 ? "text-blue-700" : ""}`}>
                      {d < 0 ? `-${$fmt(Math.abs(d))}` : $fmt(d)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-300 font-bold">
                <td className="py-1">Total</td>
                <td className="text-right py-1">{$fmt(corte.total_calculado)}</td>
                <td className="text-right py-1">{$fmt(corte.total_contado)}</td>
                <td className={`text-right py-1 ${corte.total_diferencia < 0 ? "text-red-600" : corte.total_diferencia > 0 ? "text-blue-700" : ""}`}>
                  {corte.total_diferencia < 0 ? `-${$fmt(Math.abs(corte.total_diferencia))}` : $fmt(corte.total_diferencia)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-2 flex justify-between py-0.5"><span>Transferencias:</span><span className="font-semibold">{$fmt(corte.transferencias)}</span></div>
          <div className="flex justify-between py-0.5"><span>A crédito:</span><span className="font-semibold">{$fmt(corte.credito)}</span></div>

          {/* Explica por qué el Calculado bajó: sin esto, un corte abierto
              semanas después en el historial muestra una Diferencia que no
              se puede interpretar. Solo se muestra si el corte tiene
              gastos — los cortes viejos no traen el campo y no cambian. */}
          {corte.gastos_efectivo > 0 && (
            <div className="mt-2 flex justify-between py-0.5 bg-amber-50 border border-amber-200 rounded px-2">
              <span className="text-amber-800">Gastos del turno ({corte.gastos_incluidos}):</span>
              <span className="font-semibold text-amber-800">− {$fmt(corte.gastos_efectivo)}</span>
            </div>
          )}

          {corte.retiro && FORMAS.some((f) => corte.retiro[f]) && (
            <>
              <div className="mt-3 border-t border-dashed border-slate-300 pt-2 font-semibold">Retiro por corte</div>
              {FORMAS.map((f) => corte.retiro[f] ? (
                <div key={f} className="flex justify-between py-0.5"><span>{ETIQUETAS[f]}:</span><span>{$fmt(corte.retiro[f])}</span></div>
              ) : null)}
              <div className="flex justify-between py-0.5 font-semibold"><span>Total retiro:</span><span>{$fmt(corte.total_retiro)}</span></div>
            </>
          )}

          <div className={`mt-4 rounded-lg p-3 text-center font-semibold ${hayDiferencia ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
            {hayDiferencia
              ? (corte.total_diferencia < 0
                  ? `⚠️ Faltan ${$fmt(Math.abs(corte.total_diferencia))} en caja`
                  : `⚠️ Sobran ${$fmt(corte.total_diferencia)} en caja`)
              : "✅ Caja exacta — sin diferencias"}
          </div>
        </div>
        <div className="border-t border-black/5 p-3 flex justify-center gap-2">
          <button onClick={() => window.print()} className="bg-slate-200 hover:bg-slate-300 px-4 py-2 rounded font-semibold text-sm flex items-center gap-2">
            🖨️ Imprimir
          </button>
          <button onClick={onCerrar} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white px-6 py-2 rounded-lg font-semibold text-sm transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CorteCaja({ onVolverAVenta, onVolverInicio, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const usuario = (() => { try { return JSON.parse(localStorage.getItem("usuario")) || {}; } catch { return {}; } })();

  const [enCurso, setEnCurso] = useState(null);
  const [cortes, setCortes] = useState([]);
  const [errorCarga, setErrorCarga] = useState(null);
  const [errorCaja, setErrorCaja] = useState(null);
  const [cajaNombre, setCajaNombre] = useState("");
  const [cajasDisponibles, setCajasDisponibles] = useState([]);
  const [ultimoCorteGuardado, setUltimoCorteGuardado] = useState(null);
  const [guardandoCorte, setGuardandoCorte] = useState(false);
  const [modal, setModal] = useState(null); // "corte" | "historial"
  const [contado, setContado] = useState({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
  const [retiro, setRetiro] = useState({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
  const [aviso, setAviso] = useState(null);
  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  // Esta pantalla leía SIEMPRE con ?sucursal_id=1 fijo y guardaba con lo que
  // dijera el encabezado: se contaba el efectivo de una tienda contra el
  // calculado de Ocosingo (faltante inventado) y el turno se cerraba en la
  // tienda del encabezado, a nombre de quien no lo cortó. Ahora se lee y se
  // escribe la MISMA sucursal —la del encabezado, que apiFetch ya agrega sola—
  // y con "Todas" no se muestra ni se guarda nada.
  const sinSucursal = sinSucursalElegida();

  // El corte en curso es el dinero que debería haber en el cajón AHORITA. Si no
  // carga, la pantalla se quedaba en blanco o con el corte anterior y el aviso
  // se iba solo a los pocos segundos: se contaba el efectivo contra un número
  // que no era el de esta caja.
  const cargar = useCallback(async () => {
    if (sinSucursal) { setEnCurso(null); setCortes([]); setErrorCarga(null); return; }
    const cajaIdGuardada = cajaActiva();
    const cajasResp = await pedirLista(() => apiFetch("/cajas"), "las cajas");
    setCajasDisponibles(cajasResp.datos);
    const caja = cajasResp.datos.find((item) => String(item.id) === String(cajaIdGuardada))
      || cajasResp.datos.find((item) => item.predeterminada);
    const cajaId = caja?.id || "";
    if (cajaId) localStorage.setItem("caja_activa", String(cajaId));
    setCajaNombre(caja?.nombre || "");
    const falloCaja = cajasResp.error || (!caja ? "No hay una caja activa para este corte." : null);
    setErrorCaja(falloCaja);
    if (falloCaja) {
      setEnCurso(null);
      setCortes([]);
      setErrorCarga(falloCaja);
      return;
    }
    const enCursoResp = await pedirDato(
      () => apiFetch(`/cortes/en-curso?caja_id=${encodeURIComponent(cajaId || "")}`),
      "el corte en curso"
    );
    setEnCurso(enCursoResp.datos);
    let errorHistorial = null;
    if (puede("ver_historial_cortes")) {
      const historial = await pedirLista(() => apiFetch("/cortes"), "el historial de cortes");
      setCortes(historial.datos);
      errorHistorial = historial.error;
    }
    setErrorCarga(cajasResp.error || enCursoResp.error || errorHistorial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinSucursal]);

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
    if (sinSucursal) return mostrarAviso("Elige una sucursal en el encabezado para hacer el corte");
    if (errorCaja || !cajaNombre) return mostrarAviso("No se puede hacer el corte sin una caja activa");
    setContado({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
    setRetiro({ EFECTIVO: "", CHEQUE: "", VALES: "", TARJETA: "" });
    cargar();
    setModal("corte");
  };

  // El backend ya pone en 0 calculado/total_calculado/transferencias/credito/
  // ventas_incluidas en /cortes/en-curso para quien no tenga este permiso
  // (corte a ciegas para el cajero). Además forzamos aquí la Diferencia a 0:
  // como el calculado real ya llega en 0, "contado - calculado" daría el
  // propio contado, no un $0.00, si no se fuerza explícitamente.
  const puedeVerMontos = puede("ver_montos_corte");
  const dif = (f) => (puedeVerMontos ? (Number(contado[f]) || 0) - (enCurso?.calculado?.[f] || 0) : 0);
  const totalContado = FORMAS.reduce((a, f) => a + (Number(contado[f]) || 0), 0);
  const totalCalculado = enCurso?.total_calculado || 0;
  const totalDif = puedeVerMontos ? totalContado - totalCalculado : 0;
  const totalRetiro = FORMAS.reduce((a, f) => a + (Number(retiro[f]) || 0), 0);

  /**
   * Candado contra el doble clic. En `useRef` y no en `useState` porque React
   * agrupa las actualizaciones de estado: dos clics simultáneos leerían ambos
   * `false` y la operación saldría dos veces. El ref cambia de inmediato.
   * El estado de al lado solo apaga el botón y lo dice en pantalla.
   */
  const corteEnCurso = useRef(false);

  const guardarCorte = async () => {
    if (sinSucursal) return mostrarAviso("Elige una sucursal en el encabezado para guardar el corte");
    if (errorCaja || !cajaNombre) return mostrarAviso("No se puede guardar el corte sin una caja activa");
    if (errorCarga) return mostrarAviso("No se puede guardar el corte hasta que el turno cargue correctamente");
    // Un corte duplicado deja un turno fantasma cuyo "sobrante" es todo lo
    // contado, y ese faltante aparece a nombre de quien cerró la caja.
    if (corteEnCurso.current) return;
    corteEnCurso.current = true;
    setGuardandoCorte(true);
    try {
      // Sin sucursal_id en el cuerpo: manda la del encabezado, que es la misma
      // con la que se leyó el turno en curso de arriba. Antes iba un 1 fijo.
      const r = await apiFetch("/cortes", {
        method: "POST",
        body: JSON.stringify({
          caja_id: cajaActiva(),
          contado: Object.fromEntries(FORMAS.map((f) => [f, Number(contado[f]) || 0])),
          retiro: Object.fromEntries(FORMAS.map((f) => [f, Number(retiro[f]) || 0])),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      data.caja_nombre = cajaNombre;
      setUltimoCorteGuardado(data);
      setModal("ticket");
      cargar();
      mostrarAviso(`Corte #${data.id} guardado — el siguiente turno empieza de cero`);
    } catch (e) { mostrarAviso("❌ " + e.message); }
    finally { corteEnCurso.current = false; setGuardandoCorte(false); }
  };

  const verTicketDeCorte = (c) => {
    const caja = cajasDisponibles.find((item) => Number(item.id) === Number(c.caja_id));
    setUltimoCorteGuardado({ ...c, caja_nombre: caja?.nombre });
    setModal("ticket");
  };

  const infoCorte = ultimoCorteGuardado;

  return (
    <div className="w-full h-full flex flex-col bg-background text-slate-800 font-sans text-sm select-none">
      {/* Con "Todas" no se muestra ningún corte: un corte de la tienda
          equivocada le inventa un faltante a la cajera. */}
      {sinSucursal && (
        <div className="bg-amber-50 border-b border-amber-300 text-amber-900 text-sm px-4 py-2 shrink-0 flex items-center gap-2">
          <Info size={15} className="shrink-0" />
          <span>
            <b>Estás viendo todas las sucursales.</b> Elige una sucursal arriba, en el selector del
            encabezado, para ver y hacer el corte: el corte cierra el turno de una sola caja.
          </span>
        </div>
      )}

      {errorCarga && (
        // Persistente, no un aviso que se va solo: mientras esto se vea, los
        // montos de abajo no son los de esta caja y no se debe cerrar el turno.
        <div className="bg-red-50 border-b border-red-300 text-red-700 text-sm px-4 py-2 shrink-0 flex items-start gap-2">
          <Info size={15} className="shrink-0 mt-0.5" />
          <span>
            {errorCarga} <b>No cuentes el efectivo contra estos números ni cierres el turno hasta que cargue bien.</b>
          </span>
        </div>
      )}

      {/* Barra de herramientas */}
      <div className="neu rounded-none flex overflow-x-auto shrink-0">
        {puede("realizar_corte_caja") && (
          <button
            type="button"
            onClick={abrirCorte}
            disabled={sinSucursal || Boolean(errorCaja) || !cajaNombre}
            title={sinSucursal ? "Elige una sucursal en el encabezado para hacer el corte" : (errorCaja || !cajaNombre ? "No hay una caja activa" : "Corte de caja (F3)")}
            className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Scissors size={18} className="text-emerald-600" />
            <span className="text-[10px] font-medium text-slate-500">Corte</span>
          </button>
        )}
        {puede("registrar_propina") && (
          <button onClick={() => mostrarAviso("Registro de propina — próximamente")} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50">
            <CircleDollarSign size={18} className="text-amber-500" />
            <span className="text-[10px] font-medium text-slate-500">Propina</span>
          </button>
        )}
        {puede("ver_historial_cortes") && (
          <button
            type="button"
            onClick={() => setModal("historial")}
            disabled={sinSucursal}
            title={sinSucursal ? "Elige una sucursal en el encabezado para ver su historial de cortes" : "Historial de cortes"}
            className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-300 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <History size={20} className="text-slate-600" />
            <span className="text-[11px] font-medium text-slate-700">Historial</span>
          </button>
        )}
      </div>

      {/* Información del corte */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-center border-b border-black/5 py-2 font-semibold text-slate-600">Información del Corte de Caja</div>
        <div className="p-6 flex flex-col gap-4 max-w-md">
          {[
            ["Caja:", infoCorte ? `${infoCorte.caja_nombre || `Caja ${infoCorte.caja_id || "—"}`} — Sucursal ${infoCorte.sucursal_id}` : (cajaNombre || "–")],
            ["Usuario:", infoCorte ? infoCorte.usuario_nombre : "–"],
            ["Fecha:", infoCorte ? infoCorte.fecha : "–"],
            ["Hora:", infoCorte ? new Date(infoCorte.fecha_hora).toLocaleTimeString("es-MX") : "–"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-4">
              <span className="font-semibold w-20">{k}</span>
              <span className="text-slate-600">{v}</span>
            </div>
          ))}

          {/* Estado del turno en curso — sin ver_montos_corte, el backend ya
              entrega ventas_incluidas y total_calculado en 0 (corte a ciegas),
              así que esta sección siempre se renderiza igual para todos. */}
          {enCurso && (
            <div className="mt-4 neu rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Turno en curso</div>
              <div className="text-sm text-slate-600 mb-1">{enCurso.ventas_incluidas} venta(s) desde {enCurso.desde ? new Date(enCurso.desde).toLocaleString("es-MX") : "el inicio"}</div>
              <div className="text-2xl font-bold text-slate-800">{$fmt(enCurso.total_calculado)}</div>
              <div className="text-xs text-slate-400 mt-1">calculado en caja (sin transferencias ni crédito)</div>
              {enCurso?.gastos_efectivo > 0 && (
                <div className="flex items-center justify-between text-sm px-3 py-2 bg-amber-50 border border-amber-200 rounded mt-2">
                  <span className="text-amber-800">
                    Gastos del turno ({enCurso.gastos_incluidos})
                    <span className="block text-xs text-amber-700">Ya descontados del efectivo esperado</span>
                  </span>
                  <span className="font-medium text-amber-800">− {$fmt(enCurso.gastos_efectivo)}</span>
                </div>
              )}
              {!puedeVerMontos && (
                <div className="text-[11px] text-slate-400 mt-2">Los montos esperados solo son visibles para supervisión.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {aviso && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>}

      {/* ===== MODAL: CORTE DE CAJA (calcado de SICAR) ===== */}
      {modal === "corte" && enCurso && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
          <div className="neu-panel rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto animate-panel-in">
            <div className="border-b border-black/5 px-4 py-2.5 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Corte de Caja</h3>
              <button onClick={() => setModal(null)} className="hover:bg-slate-100 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6">
              {/* Conteo físico: sin ver_montos_corte el backend ya entrega
                  calculado/total_calculado/transferencias/credito/ventas_incluidas
                  en 0 (corte a ciegas) — el cajero cuenta el dinero real sin ver
                  la referencia del sistema y no puede ajustar su número para que
                  "cuadre" a propósito. Las columnas siempre se muestran (para
                  igualar la pantalla de SICAR); con el permiso traen el dato
                  real, sin él, ceros. */}
              <div>
                <div className="text-center text-sm font-medium text-slate-600 border-b border-black/5 pb-2 mb-3">Caja: {cajaNombre || "–"}</div>
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
                              className="w-full neu-campo rounded-lg px-2 py-1.5 text-right"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="py-1.5 px-1">
                            <div className="px-2 py-1.5 text-right text-slate-600">{$fmt(enCurso.calculado?.[f])}</div>
                          </td>
                          <td className="py-1.5 px-1">
                            <div className={`px-2 py-1.5 text-right font-semibold ${d < 0 ? "text-red-600" : d > 0 ? "text-blue-700" : "text-slate-600"}`}>
                              {d < 0 ? `-$ ${Math.abs(d).toFixed(2)}` : $fmt(d)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-black/15">
                      <td className="py-2 pr-2 font-bold">Total</td>
                      <td className="py-2 px-1"><div className="neu-campo rounded-lg px-2 py-1.5 text-right font-bold">{$fmt(totalContado)}</div></td>
                      <td className="py-2 px-1"><div className="px-2 py-1.5 text-right font-bold text-slate-700">{$fmt(totalCalculado)}</div></td>
                      <td className="py-2 px-1">
                        <div className={`px-2 py-1.5 text-right font-bold ${totalDif < 0 ? "text-red-600" : totalDif > 0 ? "text-blue-700" : "text-slate-600"}`}>
                          {totalDif < 0 ? `-$ ${Math.abs(totalDif).toFixed(2)}` : $fmt(totalDif)}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Información adicional — mismos ceros que arriba cuando no
                    hay permiso; siempre visible, como en SICAR. */}
                <div className="mt-4 border-t border-black/5 pt-3">
                  <div className="text-center text-xs font-semibold text-blue-700 mb-2">Información Adicional</div>
                  <div className="flex justify-between text-xs text-slate-600 flex-wrap gap-2">
                    <span>Total Transferencias: <b>{$fmt(enCurso.transferencias)}</b></span>
                    <span>Total a Crédito: <b>{$fmt(enCurso.credito)}</b></span>
                    <span>Ventas del turno: <b>{enCurso.ventas_incluidas}</b></span>
                  </div>
                  <p className="text-center text-[11px] text-blue-600 mt-2">Las transferencias y ventas a crédito no entran al conteo físico de la caja</p>
                  {!puedeVerMontos && (
                    <p className="text-center text-[11px] text-slate-400 mt-1">Los montos esperados solo son visibles para supervisión.</p>
                  )}
                </div>
              </div>

              {/* Retiro por Corte */}
              <div className="border-l border-black/15 pl-5">
                <div className="text-center text-sm font-medium text-slate-600 border-b border-black/5 pb-2 mb-3">Retiro por Corte</div>
                {FORMAS.map((f) => (
                  <div key={f} className="mb-2.5">
                    <label className="text-xs text-slate-500 block mb-0.5">{ETIQUETAS[f].replace("* ", "")}:</label>
                    <input
                      type="number" step="0.01"
                      value={retiro[f]}
                      onChange={(e) => setRetiro({ ...retiro, [f]: e.target.value })}
                      className="w-full neu-campo rounded-lg px-2 py-1.5 text-right"
                      placeholder="0.00"
                    />
                  </div>
                ))}
                <div className="mt-3 pt-2 border-t border-black/5">
                  <label className="text-xs text-slate-500 block mb-0.5">Total:</label>
                  <div className="px-2 py-1.5 text-right font-bold text-slate-700">{$fmt(totalRetiro)}</div>
                </div>
                <button onClick={() => setRetiro(Object.fromEntries(FORMAS.map((f) => [f, contado[f] || ""])))} className="mt-2 w-full text-xs text-blue-700 hover:underline">
                  Retirar todo lo contado
                </button>
              </div>
            </div>

            <div className="border-t border-black/5 p-3 flex flex-col items-center gap-2">
              <p className="text-[11px] text-slate-400 text-center max-w-md">
                Si sacaste dinero de la caja y todavía no lo capturas en Gastos, hazlo antes de guardar el corte.
              </p>
              <button
                type="button"
                onClick={guardarCorte}
                disabled={guardandoCorte || Boolean(errorCarga)}
                title={errorCarga ? "Recarga el turno correctamente antes de guardar el corte" : "Guardar corte"}
                className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white px-8 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                💾 {guardandoCorte ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: HISTORIAL DE CORTES ===== */}
      {modal === "historial" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
          <div className="neu-panel rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto animate-panel-in">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 neu-panel">
              <h3 className="font-semibold text-sm">Historial de Cortes</h3>
              <button onClick={() => setModal(null)} className="hover:bg-blue-800 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4">
              {cortes.length === 0 ? <p className="text-center text-slate-400 py-8">Sin cortes registrados todavía</p> : (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 border-b border-black/5">
                    <tr>
                      <th className="text-left py-2 font-medium">#</th>
                      <th className="text-left py-2 font-medium">Fecha / Hora</th>
                      <th className="text-left py-2 font-medium">Usuario</th>
                      <th className="text-left py-2 font-medium">Caja</th>
                      <th className="text-right py-2 font-medium">Calculado</th>
                      <th className="text-right py-2 font-medium">Contado</th>
                      <th className="text-right py-2 font-medium">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cortes.map((c) => (
                      <tr key={c.id} onClick={() => verTicketDeCorte(c)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" title="Ver ticket de este corte">
                        <td className="py-2">{c.id}</td>
                        <td className="py-2">{new Date(c.fecha_hora).toLocaleString("es-MX")}</td>
                        <td className="py-2">{c.usuario_nombre}</td>
                        <td className="py-2">{cajasDisponibles.find((caja) => Number(caja.id) === Number(c.caja_id))?.nombre || "Histórica"}</td>
                        <td className="py-2 text-right">{$fmt(c.total_calculado)}</td>
                        <td className="py-2 text-right">{$fmt(c.total_contado)}</td>
                        <td className={`py-2 text-right font-semibold ${c.total_diferencia < 0 ? "text-red-600" : "text-blue-700"}`}>
                          {c.total_diferencia < 0 ? `-$ ${Math.abs(c.total_diferencia).toFixed(2)}` : $fmt(c.total_diferencia)}
                          {/* Solo aparece si el corte tiene gastos — los cortes
                              viejos sin este campo se ven exactamente igual que siempre. */}
                          {c.gastos_efectivo > 0 && (
                            <div className="text-[10px] font-normal text-amber-700">incl. −{$fmt(c.gastos_efectivo)} gastos</div>
                          )}
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

      {/* ===== MODAL: TICKET DE RESULTADO DEL CORTE ===== */}
      {modal === "ticket" && ultimoCorteGuardado && (
        <TicketCorte corte={ultimoCorteGuardado} onCerrar={() => setModal(null)} />
      )}
    </div>
  );
}
