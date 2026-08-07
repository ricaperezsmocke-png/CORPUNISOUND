import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, Ban, FileText, Upload, Download, Paperclip } from "lucide-react";
import { apiFetch } from "./api";
import { hoyLocal, haceDiasLocal } from "./fechas";
import { comprimirImagen } from "./comprimirImagen";
import { descargarCSV } from "./reportes/exportarCSV.js";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const FORMAS_PAGO_DEPOSITO = ["EFECTIVO", "TRANSFERENCIA"];
const MIME_OK = ["application/pdf", "image/jpeg", "image/png"];
const TAM_MAX = 10 * 1024 * 1024;

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

export default function EstadoCuenta({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const veTodas = !!usuario?.ver_todas;

  const [tab, setTab] = useState("resumen");
  const [fechaInicial, setFechaInicial] = useState(haceDiasLocal(30));
  const [fechaFinal, setFechaFinal] = useState(hoyLocal());
  const [sucursales, setSucursales] = useState([]);
  // Quien está amarrado a una sucursal siempre ve el detalle de la suya;
  // quien ve todas arranca en el resumen general y elige una para el detalle.
  const [sucursalId, setSucursalId] = useState(veTodas ? "" : String(usuario?.sucursal_id || ""));
  const [filtroEstatus, setFiltroEstatus] = useState("activo");

  const [resumen, setResumen] = useState({ resumen: [], movimientos: null, totales: { depositado: 0, recibido: 0, saldo: 0 } });
  const [depositos, setDepositos] = useState([]);

  const [modal, setModal] = useState(null); // null | "nuevo" | "cancelar"
  const [seleccionado, setSeleccionado] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const [form, setForm] = useState({ monto: "", forma_pago: "EFECTIVO", referencia: "", nota: "" });
  const [archivo, setArchivo] = useState(null);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [pesoOriginal, setPesoOriginal] = useState(null);
  const [motivo, setMotivo] = useState("");
  // Igual que en Gastos: invalida compresiones de una selección de archivo
  // anterior cuando se elige otra foto o se reabre el modal.
  const seleccionArchivo = useRef(0);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 4000); };

  useEffect(() => {
    if (!veTodas) return;
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
  }, [veTodas]);

  const cargarResumen = useCallback(async () => {
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    // Siempre explícito (nunca se omite): si se omitiera, apiFetch le
    // inyectaría por su cuenta la sucursal_activa del encabezado global (ver
    // src/api.js), pisando en silencio el selector de esta pantalla.
    params.set("sucursal_id", sucursalId || "todas");
    const r = await apiFetch(`/estado-cuenta?${params.toString()}`);
    if (r.ok) setResumen(await r.json());
  }, [fechaInicial, fechaFinal, sucursalId]);

  const cargarDepositos = useCallback(async () => {
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (filtroEstatus) params.set("estatus", filtroEstatus);
    // Mismo motivo que en cargarResumen: sucursal_id explícito para que
    // apiFetch no la sustituya por la del selector global del encabezado.
    params.set("sucursal_id", sucursalId || "todas");
    const r = await apiFetch(`/depositos?${params.toString()}`);
    if (r.ok) setDepositos(await r.json());
  }, [fechaInicial, fechaFinal, filtroEstatus, sucursalId]);

  useEffect(() => { cargarResumen(); }, [cargarResumen]);
  useEffect(() => { cargarDepositos(); }, [cargarDepositos]);

  const abrirNuevo = () => {
    seleccionArchivo.current++;
    setForm({ monto: "", forma_pago: "EFECTIVO", referencia: "", nota: "" });
    setArchivo(null);
    setPesoOriginal(null);
    setComprimiendo(false);
    setModal("nuevo");
  };

  const abrirComprobante = (d) => {
    seleccionArchivo.current++;
    setSeleccionado(d);
    setArchivo(null);
    setPesoOriginal(null);
    setComprimiendo(false);
    setModal("comprobante");
  };

  const elegirArchivo = async (e) => {
    const campo = e.target;
    const original = campo.files?.[0];
    if (!original) return;
    if (!MIME_OK.includes(original.type)) { campo.value = ""; return mostrarAviso("❌ Solo se acepta PDF, JPG o PNG"); }

    const idSeleccion = ++seleccionArchivo.current;
    setComprimiendo(true);
    try {
      const listo = await comprimirImagen(original);
      if (idSeleccion !== seleccionArchivo.current) return;
      if (listo.size > TAM_MAX) return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
      setArchivo(listo);
      setPesoOriginal(listo.size < original.size ? original.size : null);
    } catch (err) {
      if (idSeleccion === seleccionArchivo.current) mostrarAviso("❌ No se pudo preparar la imagen: " + err.message);
    } finally {
      if (idSeleccion === seleccionArchivo.current) setComprimiendo(false);
      campo.value = ""; // permite volver a elegir el mismo archivo si se corrige algo
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const body = { monto: form.monto, forma_pago: form.forma_pago, referencia: form.referencia, nota: form.nota };
      if (archivo) {
        const contenido_base64 = await leerArchivoComoBase64(archivo);
        body.archivo = { nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 };
      }
      const r = await apiFetch("/depositos", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Depósito ${data.folio} registrado`);
      setModal(null);
      cargarDepositos();
      cargarResumen();
    } catch (err) {
      mostrarAviso("❌ " + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const adjuntar = async (e) => {
    e.preventDefault();
    if (!archivo) return mostrarAviso("❌ Elige la ficha del depósito");
    setGuardando(true);
    try {
      const contenido_base64 = await leerArchivoComoBase64(archivo);
      // sucursal_id explícito (el del propio depósito), por el mismo motivo que
      // en cancelar(): si se omite, apiFetch le inyecta la sucursal_activa del
      // encabezado global (ver src/api.js) y el guard de alcance del backend
      // responde "Depósito no encontrado" sobre un depósito que esta pantalla
      // sí está mostrando, porque su lista usa el selector propio, no el
      // global. No amplía el alcance de nadie: a quien no tiene
      // ver_todas_las_sucursales el backend le ignora el parámetro y usa la
      // sucursal del token.
      const r = await apiFetch(`/depositos/${seleccionado.id}/comprobante?sucursal_id=${seleccionado.sucursal_id}`, {
        method: "POST",
        body: JSON.stringify({ archivo: { nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 } }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Comprobante adjuntado a ${seleccionado.folio}`);
      setModal(null);
      // Solo la lista: el monto no cambió, así que el resumen sigue igual.
      cargarDepositos();
    } catch (err) {
      mostrarAviso("❌ " + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = async (e) => {
    e.preventDefault();
    try {
      // sucursal_id explícito (el del propio depósito), por el mismo motivo que
      // en cargarResumen: si se omite, apiFetch le inyecta la sucursal_activa
      // del encabezado global, y entonces el guard de alcance del backend no
      // encuentra un depósito de OTRA sucursal — aunque esta pantalla lo esté
      // mostrando, porque su lista usa el filtro propio, no el global.
      // No amplía el alcance de nadie: para quien no tiene
      // ver_todas_las_sucursales, el backend ignora este parámetro y usa la
      // sucursal del token (ver alcanceSucursal en backend/auth.js).
      const r = await apiFetch(`/depositos/${seleccionado.id}/cancelar?sucursal_id=${seleccionado.sucursal_id}`, {
        method: "PUT", body: JSON.stringify({ motivo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Depósito ${seleccionado.folio} cancelado`);
      setModal(null); setMotivo("");
      cargarDepositos();
      cargarResumen();
    } catch (err) { mostrarAviso("❌ " + err.message); }
  };

  const exportarResumen = () => {
    const encabezados = ["Sucursal", "Depositado", "Recibido", "Saldo"];
    const filas = resumen.resumen.map((r) => [r.sucursal_nombre, r.depositado.toFixed(2), r.recibido.toFixed(2), r.saldo.toFixed(2)]);
    filas.push(["TOTAL", resumen.totales.depositado.toFixed(2), resumen.totales.recibido.toFixed(2), resumen.totales.saldo.toFixed(2)]);
    // El detalle solo existe cuando hay UNA sucursal elegida. Va como segundo
    // bloque del mismo archivo, separado por un renglón en blanco, igual que en
    // pantalla va como segunda tabla: sin folios ni conceptos, el resumen de 4
    // columnas no le sirve de nada a la contadora para amarrar los saldos.
    if (resumen.movimientos) {
      filas.push([]);
      filas.push(["Detalle de movimientos"]);
      filas.push(["Fecha", "Folio", "Concepto", "Cargo", "Abono"]);
      for (const m of resumen.movimientos) {
        filas.push([
          m.fecha, m.folio,
          m.concepto + (m.aproximado ? " (costo aproximado)" : ""),
          m.cargo ? m.cargo.toFixed(2) : "",
          m.abono ? m.abono.toFixed(2) : "",
        ]);
      }
    }
    descargarCSV(`estado-cuenta_${fechaInicial}_a_${fechaFinal}.csv`, encabezados, filas);
  };

  const exportarDepositos = () => {
    const encabezados = ["Folio", "Fecha", "Sucursal", "Forma de pago", "Referencia", "Nota", "Monto", "Estatus", "Comprobante", "Motivo de cancelación", "Registró"];
    const filas = depositos.map((d) => [
      d.folio, d.fecha, d.sucursal_nombre, d.forma_pago,
      d.referencia || "", d.nota || "", d.monto.toFixed(2), d.estatus,
      d.drive_link || "", d.motivo_cancelacion || "", d.usuario_nombre || "",
    ]);
    // Los cancelados salen en el archivo (son respaldo de lo que pasó) pero no
    // suman, igual que en el resumen: solo los activos cuentan al bote común.
    const totalActivos = depositos.filter((d) => d.estatus === "activo").reduce((s, d) => s + d.monto, 0);
    filas.push([]);
    filas.push(["TOTAL ACTIVOS", "", "", "", "", "", totalActivos.toFixed(2)]);
    descargarCSV(`depositos_${fechaInicial}_a_${fechaFinal}.csv`, encabezados, filas);
  };

  // Un solo botón que exporta LO QUE LA PESTAÑA ACTIVA ESTÁ MOSTRANDO. Se
  // prefirió esto a dos botones fijos porque el resto de la barra ya es por
  // pestaña (el filtro de estatus solo aparece en Depósitos), y así el archivo
  // es siempre "lo que tengo en la pantalla", sin que la cajera tenga que
  // adivinar cuál de dos botones le toca.
  const exportarCSV = () => (tab === "resumen" ? exportarResumen() : exportarDepositos());

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      {aviso && <div className="bg-slate-800 text-white text-xs px-4 py-2 shrink-0">{aviso}</div>}

      <div className="bg-white border-b border-slate-200 flex shrink-0">
        <button onClick={() => setTab("resumen")}
          className={`px-4 py-2 border-b-2 ${tab === "resumen" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Resumen
        </button>
        <button onClick={() => setTab("depositos")}
          className={`px-4 py-2 border-b-2 ${tab === "depositos" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Depósitos
        </button>
      </div>

      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end shrink-0">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Del</label>
          <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Al</label>
          <input type="date" value={fechaFinal} onChange={(e) => setFechaFinal(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>

        {tab === "resumen" && veTodas && (
          <div>
            <label className="text-xs text-slate-500 block mb-1">Sucursal</label>
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todas (resumen general)</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}

        {tab === "depositos" && (
          <div>
            <label className="text-xs text-slate-500 block mb-1">Estatus</label>
            <select value={filtroEstatus} onChange={(e) => setFiltroEstatus(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="activo">Activos</option>
              <option value="cancelado">Cancelados</option>
              <option value="">Todos</option>
            </select>
          </div>
        )}

        <button onClick={exportarCSV} className="flex items-center gap-1.5 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          <Download size={15} /> {tab === "resumen" ? "Exportar resumen" : "Exportar depósitos"}
        </button>

        {puede("registrar_depositos") && (
          <button onClick={abrirNuevo} className="ml-auto flex items-center gap-1.5 bg-[#1a7fe8] text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700">
            <Plus size={16} /> Registrar depósito
          </button>
        )}
      </div>

      {tab === "resumen" ? (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                  <th className="py-2 px-3 text-right font-medium">Depositado</th>
                  <th className="py-2 px-3 text-right font-medium">Recibido</th>
                  <th className="py-2 px-3 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {resumen.resumen.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-slate-400 py-10">Sin movimientos en el periodo</td></tr>
                )}
                {resumen.resumen.map((r) => (
                  <tr key={r.sucursal_id} className="border-b border-slate-100">
                    <td className="py-2 px-3">{r.sucursal_nombre}</td>
                    <td className="py-2 px-3 text-right">${r.depositado.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right">${r.recibido.toFixed(2)}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${r.saldo >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      ${r.saldo.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {resumen.resumen.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-semibold">
                    <td className="py-2 px-3">Total</td>
                    <td className="py-2 px-3 text-right">${resumen.totales.depositado.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right">${resumen.totales.recibido.toFixed(2)}</td>
                    <td className={`py-2 px-3 text-right ${resumen.totales.saldo >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      ${resumen.totales.saldo.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {resumen.movimientos && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 font-medium text-slate-700">Detalle de movimientos</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium text-slate-500">Fecha</th>
                    <th className="py-2 px-3 text-left font-medium text-slate-500">Folio</th>
                    <th className="py-2 px-3 text-left font-medium text-slate-500">Concepto</th>
                    <th className="py-2 px-3 text-right font-medium text-slate-500">Cargo</th>
                    <th className="py-2 px-3 text-right font-medium text-slate-500">Abono</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.movimientos.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-slate-400 py-8">Sin movimientos en el periodo</td></tr>
                  )}
                  {resumen.movimientos.map((m, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2 px-3">{m.fecha}</td>
                      <td className="py-2 px-3">{m.folio}</td>
                      <td className="py-2 px-3">
                        {m.concepto}
                        {m.aproximado && (
                          <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">costo aproximado</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">{m.cargo ? `$${m.cargo.toFixed(2)}` : ""}</td>
                      <td className="py-2 px-3 text-right">{m.abono ? `$${m.abono.toFixed(2)}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Forma de pago</th>
                <th className="py-2 px-3 text-left font-medium">Referencia</th>
                <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                <th className="py-2 px-3 text-right font-medium">Monto</th>
                <th className="py-2 px-3 text-center font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {depositos.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin depósitos en el periodo</td></tr>}
              {depositos.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="py-2 px-3 font-medium">
                    {d.folio}
                    {d.estatus === "cancelado" && (
                      <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-600 rounded px-1.5 py-0.5">Cancelado</span>
                    )}
                  </td>
                  <td className="py-2 px-3">{d.fecha}</td>
                  <td className="py-2 px-3">{d.sucursal_nombre}</td>
                  <td className="py-2 px-3">{d.forma_pago}</td>
                  {/* La nota va como segundo renglón de la misma celda (mismo
                      recurso que el SKU bajo el nombre del producto en
                      Inventario): se ve sin agregar una columna, y el
                      max-w + truncate impide que una nota larga estire la
                      tabla. El texto completo queda en el title. */}
                  <td className="py-2 px-3">
                    {d.referencia || "—"}
                    {d.nota && (
                      <div className="text-[11px] text-slate-400 truncate max-w-[220px]" title={d.nota}>{d.nota}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {d.drive_link ? (
                      <a href={d.drive_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1a7fe8] hover:underline" title={d.nombre_archivo}>
                        <FileText size={14} /> Ver
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${d.estatus === "cancelado" ? "text-slate-400 line-through" : ""}`}>
                    ${d.monto.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    {/* Solo si está activo y NO tiene ficha: el comprobante no
                        se reemplaza (sería borrar evidencia) y a un cancelado
                        ya no se le adjunta nada. */}
                    {d.estatus === "activo" && !d.drive_link && puede("registrar_depositos") && (
                      <button onClick={() => abrirComprobante(d)}
                        className="text-slate-500 hover:text-[#1a7fe8] px-1" title="Adjuntar comprobante"><Paperclip size={15} /></button>
                    )}
                    {d.estatus === "activo" && puede("cancelar_depositos") && (
                      <button onClick={() => { setSeleccionado(d); setMotivo(""); setModal("cancelar"); }}
                        className="text-slate-500 hover:text-red-600 px-1" title="Cancelar"><Ban size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === "nuevo" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Registrar depósito</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <form id="form-deposito" onSubmit={guardar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Monto *</label>
                  <input required type="number" step="0.01" min="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Forma de pago *</label>
                  <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className={inputCls}>
                    {FORMAS_PAGO_DEPOSITO.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Referencia</label>
                <input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} className={inputCls} placeholder="No. de transferencia, etc." />
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Nota</label>
                <textarea rows={2} value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} className={inputCls} />
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Comprobante (opcional — PDF, JPG o PNG, máx. 10 MB)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={elegirArchivo} className="text-sm" />
                {comprimiendo && <p className="text-xs text-slate-500 mt-1">Preparando la imagen...</p>}
                {archivo && !comprimiendo && (
                  <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
                    <Upload size={12} /> {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB
                    {pesoOriginal ? ` — comprimida desde ${(pesoOriginal / 1024 / 1024).toFixed(1)} MB` : ""})
                  </p>
                )}
                <p className="text-xs text-slate-400 mt-1">Si no adjuntas ficha, el depósito se registra igual y puedes agregarla después desde la lista, con el botón del clip. No hace falta cancelar nada.</p>
              </div>
            </form>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
              <button type="submit" form="form-deposito" disabled={guardando || comprimiendo}
                className="px-4 py-1.5 text-sm bg-[#1a7fe8] text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {guardando ? "Guardando..." : "Guardar depósito"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "comprobante" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Adjuntar comprobante a {seleccionado.folio}</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <form id="form-comprobante" onSubmit={adjuntar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              <p className="text-xs text-slate-500">
                Depósito del {seleccionado.fecha} por <b>${seleccionado.monto.toFixed(2)}</b> ({seleccionado.forma_pago}).
              </p>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Ficha del depósito (PDF, JPG o PNG, máx. 10 MB)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={elegirArchivo} className="text-sm" />
                {comprimiendo && <p className="text-xs text-slate-500 mt-1">Preparando la imagen...</p>}
                {archivo && !comprimiendo && (
                  <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
                    <Upload size={12} /> {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB
                    {pesoOriginal ? ` — comprimida desde ${(pesoOriginal / 1024 / 1024).toFixed(1)} MB` : ""})
                  </p>
                )}
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Una vez adjuntada, la ficha ya no se puede reemplazar: es la evidencia del depósito. Revísala antes de guardar.
              </p>
            </form>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Volver</button>
              <button type="submit" form="form-comprobante" disabled={guardando || comprimiendo || !archivo}
                className="px-4 py-1.5 text-sm bg-[#1a7fe8] text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {guardando ? "Subiendo..." : "Adjuntar comprobante"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "cancelar" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-700">Cancelar depósito {seleccionado.folio}</h3>
            </div>
            <form id="form-cancelar-deposito" onSubmit={cancelar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-slate-500">
                El depósito no se borra: queda marcado como cancelado, deja de contar en el resumen y su comprobante (si tiene) se conserva.
              </p>
              <label className="text-xs text-slate-500 block">Motivo *</label>
              <textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls} />
            </form>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Volver</button>
              <button type="submit" form="form-cancelar-deposito" className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Cancelar depósito</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
