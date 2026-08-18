import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, X, HelpCircle, History, Ban, FileText, Upload } from "lucide-react";
import { apiFetch, sucursalActiva } from "./api";
import { pedirLista } from "./cargaSegura";
import { hoyLocal, haceDiasLocal } from "./fechas";
import { comprimirImagen } from "./comprimirImagen";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const FORMAS_PAGO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA"];
const MIME_OK = ["application/pdf", "image/jpeg", "image/png"];
const TAM_MAX = 10 * 1024 * 1024;

/**
 * Sufijo "?sucursal_id=" con la sucursal del PROPIO registro. Si el registro
 * no trae el campo devuelve "" y queda el comportamiento por omisión de
 * apiFetch (la sucursal del encabezado): nunca se manda "undefined" en la URL,
 * que alcanceSucursal leería como NaN y degradaría a "todas", ensanchando el
 * alcance en silencio para quien tiene ver_todas_las_sucursales.
 * Mismo patrón que qSucursalCliente en src/CRM.jsx.
 */
const qSucursal = (registro) => (registro && registro.sucursal_id != null ? `?sucursal_id=${registro.sucursal_id}` : "");

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

/** Chuleta de categorías: muestra cada grupo con sus subcategorías, leyendo
 *  del catálogo en vivo (nunca de un texto escrito a mano), para que quien
 *  captura entienda dónde va cada gasto. Al hacer clic en una subcategoría
 *  queda elegida — además de explicar, acelera la captura. */
function AyudaCategorias({ arbol, onElegir, onCerrar }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-slate-700">¿En qué categoría va cada gasto?</h3>
          <button type="button" onClick={onCerrar} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 grid sm:grid-cols-2 gap-4">
          {arbol.map((grupo) => (
            <div key={grupo.id}>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">{grupo.nombre}</p>
              <div className="flex flex-wrap gap-1.5">
                {grupo.hijas.map((h) => (
                  <button
                    key={h.id} type="button" onClick={() => onElegir(h.id)}
                    className="text-sm px-2 py-1 rounded border border-slate-200 hover:border-[#1a7fe8] hover:bg-blue-50 text-slate-700"
                  >
                    {h.nombre}
                  </button>
                ))}
                {grupo.hijas.length === 0 && <span className="text-xs text-slate-400">Sin subcategorías</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 shrink-0 text-xs text-slate-500">
          Haz clic en una subcategoría para elegirla.
        </div>
      </div>
    </div>
  );
}

export default function Gastos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  // El backend registra el gasto SIEMPRE en la sucursal del token, nunca en la
  // que dice el encabezado (defensa a propósito: nadie puede cargarle un gasto
  // a otra tienda). Para el administrador eso choca con el selector global: si
  // está viendo Yajalón y captura, el gasto nace en su propia tienda, se le
  // resta a ESA caja en el corte, y encima desaparece de la lista que está
  // mirando — parece que no se guardó e invita a capturarlo otra vez. Así que
  // aquí solo se puede capturar cuando lo que se ve es la tienda propia.
  const suPropiaSucursal = String(usuario?.sucursal_id ?? "");
  const viendo = sucursalActiva();
  const fueraDeSuSucursal = viendo !== suPropiaSucursal;
  const MOTIVO_FUERA = viendo === "todas"
    ? "Elige tu sucursal en el encabezado para registrar un gasto — el gasto sale de la caja de una tienda."
    : "Estás viendo otra sucursal. Los gastos se registran en la tuya, así que cambia el encabezado a tu tienda para capturar.";

  const [tab, setTab] = useState("gastos");
  const [categorias, setCategorias] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [errorGastos, setErrorGastos] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [fechaInicial, setFechaInicial] = useState(haceDiasLocal(30));
  const [fechaFinal, setFechaFinal] = useState(hoyLocal());
  const [filtroEstatus, setFiltroEstatus] = useState("activo");
  const [modal, setModal] = useState(null);      // null | "nuevo" | "cancelar" | "historial"
  const [seleccionado, setSeleccionado] = useState(null);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const [form, setForm] = useState({
    categoria_id: "", concepto: "", descripcion: "", monto: "",
    forma_pago: "EFECTIVO", proveedor_id: "", numero_factura: "",
  });
  const [archivo, setArchivo] = useState(null);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [pesoOriginal, setPesoOriginal] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [historial, setHistorial] = useState([]);
  // Identifica la selección de comprobante "vigente": cada elección de archivo
  // incrementa el contador, y abrir un modal nuevo también lo invalida. Así,
  // si una compresión termina tarde (foto anterior, o modal ya cerrado y
  // vuelto a abrir), su resultado se descarta en vez de pisar el estado actual.
  const seleccionArchivo = useRef(0);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 4000); };

  const cargarCategorias = useCallback(async () => {
    const { datos } = await pedirLista(() => apiFetch("/gastos/categorias?solo_activas=1"), "las categorías de gasto");
    setCategorias(datos);
  }, []);

  // El listado de gastos es DINERO: si la consulta falla y la pantalla se
  // queda con `[]`, dice "No hay gastos" con la misma cara que cuando de
  // verdad no hubo ninguno, y así se cierra un mes creyendo que no se gastó.
  const cargarGastos = useCallback(async () => {
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (filtroEstatus) params.set("estatus", filtroEstatus);
    const { datos, error } = await pedirLista(() => apiFetch(`/gastos?${params.toString()}`), "los gastos");
    setGastos(datos);
    setErrorGastos(error);
  }, [fechaInicial, fechaFinal, filtroEstatus]);

  useEffect(() => { cargarCategorias(); }, [cargarCategorias]);
  useEffect(() => { cargarGastos(); }, [cargarGastos]);
  useEffect(() => {
    pedirLista(() => apiFetch("/proveedores"), "los proveedores").then(({ datos }) => setProveedores(datos));
  }, []);

  /** Grupos con sus subcategorías — lo consume el select y la chuleta "?". */
  const arbol = useMemo(() => {
    const grupos = categorias.filter((c) => c.categoria_padre_id === null);
    return grupos.map((g) => ({ ...g, hijas: categorias.filter((c) => c.categoria_padre_id === g.id) }));
  }, [categorias]);

  const totalPeriodo = useMemo(
    () => gastos.filter((g) => g.estatus === "activo").reduce((a, g) => a + g.monto, 0),
    [gastos]
  );

  const abrirNuevo = () => {
    if (fueraDeSuSucursal) return mostrarAviso("❌ " + MOTIVO_FUERA);
    seleccionArchivo.current++; // invalida cualquier compresión en curso de una selección anterior
    setForm({ categoria_id: "", concepto: "", descripcion: "", monto: "", forma_pago: "EFECTIVO", proveedor_id: "", numero_factura: "" });
    setArchivo(null);
    setPesoOriginal(null);
    setComprimiendo(false);
    setModal("nuevo");
  };

  const elegirArchivo = async (e) => {
    const original = e.target.files?.[0];
    if (!original) return;
    if (!MIME_OK.includes(original.type)) return mostrarAviso("❌ Solo se acepta PDF, JPG o PNG");

    const idSeleccion = ++seleccionArchivo.current;
    setComprimiendo(true);
    try {
      const listo = await comprimirImagen(original);
      // Si mientras comprimía se eligió otra foto o se reabrió el modal,
      // esta selección quedó obsoleta: se descarta en silencio.
      if (idSeleccion !== seleccionArchivo.current) return;
      if (listo.size > TAM_MAX) return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
      setArchivo(listo);
      setPesoOriginal(listo.size < original.size ? original.size : null);
    } catch (err) {
      if (idSeleccion === seleccionArchivo.current) mostrarAviso("❌ No se pudo preparar la imagen: " + err.message);
    } finally {
      // Solo la selección vigente puede apagar "comprimiendo": si ya quedó
      // obsoleta, hacerlo habilitaría el botón de guardar antes de tiempo
      // (o pisaría el "comprimiendo" de la selección que sí sigue en curso).
      if (idSeleccion === seleccionArchivo.current) setComprimiendo(false);
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!archivo) return mostrarAviso("❌ El comprobante es obligatorio");
    setGuardando(true);
    try {
      const contenido_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch("/gastos", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          archivo: { nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Gasto ${data.folio} registrado`);
      setModal(null);
      cargarGastos();
    } catch (err) {
      mostrarAviso("❌ " + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = async (e) => {
    e.preventDefault();
    try {
      // sucursal_id explícito (el del propio gasto): si se omite, apiFetch
      // inyecta la sucursal_activa del encabezado global (ver src/api.js) y el
      // guard de alcance del backend responde "Gasto no encontrado" en cuanto
      // la lista de esta pantalla deje de coincidir con ese selector global.
      // No amplía el alcance de nadie: sin ver_todas_las_sucursales el backend
      // ignora el parámetro y usa la sucursal del token.
      const r = await apiFetch(`/gastos/${seleccionado.id}/cancelar${qSucursal(seleccionado)}`, {
        method: "PUT", body: JSON.stringify({ motivo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Gasto ${seleccionado.folio} cancelado`);
      setModal(null); setMotivo("");
      cargarGastos();
    } catch (err) { mostrarAviso("❌ " + err.message); }
  };

  const abrirHistorial = async (g) => {
    setSeleccionado(g);
    const r = await apiFetch(`/gastos/${g.id}/movimientos`);
    setHistorial(r.ok ? await r.json() : []);
    setModal("historial");
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      {aviso && <div className="bg-slate-800 text-white text-xs px-4 py-2 shrink-0">{aviso}</div>}
      {/* Explica el botón apagado: sin esto, "Registrar gasto" en gris parece
          una falla del sistema y no una condición que el usuario puede cambiar. */}
      {fueraDeSuSucursal && puede("registrar_gastos") && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2 shrink-0">{MOTIVO_FUERA}</div>
      )}

      <div className="bg-white border-b border-slate-200 flex shrink-0">
        <button type="button" onClick={() => setTab("gastos")}
          className={`px-4 py-2 border-b-2 ${tab === "gastos" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Gastos
        </button>
        {puede("administrar_categorias_gastos") && (
          <button type="button" onClick={() => setTab("categorias")}
            className={`px-4 py-2 border-b-2 ${tab === "categorias" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
            Categorías
          </button>
        )}
      </div>

      {tab === "gastos" ? (
        <>
          <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end shrink-0">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Del</label>
              <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Al</label>
              <input type="date" value={fechaFinal} onChange={(e) => setFechaFinal(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Estatus</label>
              <select value={filtroEstatus} onChange={(e) => setFiltroEstatus(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="activo">Activos</option>
                <option value="cancelado">Cancelados</option>
                <option value="">Todos</option>
              </select>
            </div>
            {puede("registrar_gastos") && (
              <button type="button" onClick={abrirNuevo} disabled={fueraDeSuSucursal} title={fueraDeSuSucursal ? MOTIVO_FUERA : "Registrar gasto"}
                className="ml-auto flex items-center gap-1.5 bg-[#1a7fe8] text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <Plus size={16} /> Registrar gasto
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Folio</th>
                  <th className="py-2 px-3 text-left font-medium">Fecha</th>
                  <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                  <th className="py-2 px-3 text-left font-medium">Grupo</th>
                  <th className="py-2 px-3 text-left font-medium">Categoría</th>
                  <th className="py-2 px-3 text-left font-medium">Concepto</th>
                  <th className="py-2 px-3 text-left font-medium">Forma de pago</th>
                  <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                  <th className="py-2 px-3 text-right font-medium">Monto</th>
                  <th className="py-2 px-3 text-center font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {gastos.length === 0 && (
                  <tr><td colSpan={10} className={`text-center py-16 ${errorGastos ? "text-red-700" : "text-slate-400"}`}>
                    {errorGastos ? `⚠ ${errorGastos}` : "Sin gastos en el periodo"}
                  </td></tr>
                )}
                {gastos.map((g) => (
                  <tr key={g.id} className="border-b border-slate-100">
                    <td className="py-2 px-3 font-medium">
                      {g.folio}
                      {g.estatus === "cancelado" && (
                        <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-600 rounded px-1.5 py-0.5">Cancelado</span>
                      )}
                    </td>
                    <td className="py-2 px-3">{g.fecha}</td>
                    <td className="py-2 px-3">{g.sucursal_nombre}</td>
                    <td className="py-2 px-3 text-slate-500">{g.grupo_nombre}</td>
                    <td className="py-2 px-3">{g.categoria_nombre}</td>
                    <td className="py-2 px-3">{g.concepto}</td>
                    <td className="py-2 px-3">{g.forma_pago}</td>
                    <td className="py-2 px-3 text-center">
                      <a href={g.drive_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1a7fe8] hover:underline" title={g.nombre_archivo}>
                        <FileText size={14} /> Ver
                      </a>
                    </td>
                    <td className={`py-2 px-3 text-right font-medium ${g.estatus === "cancelado" ? "text-slate-400 line-through" : ""}`}>
                      ${g.monto.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <button type="button" onClick={() => abrirHistorial(g)} className="text-slate-500 hover:text-[#1a7fe8] px-1" title="Historial"><History size={15} /></button>
                      {g.estatus === "activo" && puede("cancelar_gastos") && (
                        <button type="button" onClick={() => { setSeleccionado(g); setMotivo(""); setModal("cancelar"); }}
                          className="text-slate-500 hover:text-red-600 px-1" title="Cancelar"><Ban size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
            <span>{gastos.length} gasto(s) en el periodo</span>
            <span>Total activo: <b>${totalPeriodo.toFixed(2)}</b></span>
          </div>
        </>
      ) : (
        <CategoriasGastos arbol={arbol} onCambio={cargarCategorias} mostrarAviso={mostrarAviso} />
      )}

      {modal === "nuevo" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Registrar gasto</h3>
              <button type="button" onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <form id="form-gasto" onSubmit={guardar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
                  Categoría *
                  <button type="button" onClick={() => setAyudaAbierta(true)}
                    className="text-[#1a7fe8] hover:text-blue-700" title="¿En qué categoría va cada gasto?">
                    <HelpCircle size={14} />
                  </button>
                </label>
                <select required value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })} className={inputCls}>
                  <option value="">Elige una categoría</option>
                  {arbol.map((g) => (
                    <optgroup key={g.id} label={g.nombre}>
                      {g.hijas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Concepto *</label>
                <input required value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className={inputCls} placeholder="Garrafón de agua" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Monto *</label>
                  <input required type="number" step="0.01" min="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Forma de pago *</label>
                  <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className={inputCls}>
                    {FORMAS_PAGO.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              {form.forma_pago === "EFECTIVO" && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  Este gasto se descontará del efectivo esperado en el corte de caja de tu turno.
                </p>
              )}

              <div>
                <label className="text-xs text-slate-500 block mb-1">Descripción</label>
                <textarea rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Proveedor</label>
                  <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })} className={inputCls}>
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">No. de factura</label>
                  <input value={form.numero_factura} onChange={(e) => setForm({ ...form, numero_factura: e.target.value })} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Comprobante * (PDF, JPG o PNG, máx. 10 MB)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={elegirArchivo} className="text-sm" />
                {comprimiendo && <p className="text-xs text-slate-500 mt-1">Preparando la imagen...</p>}
                {archivo && !comprimiendo && (
                  <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
                    <Upload size={12} /> {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB
                    {pesoOriginal ? ` — comprimida desde ${(pesoOriginal / 1024 / 1024).toFixed(1)} MB` : ""})
                  </p>
                )}
              </div>
            </form>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              {!archivo && <span className="text-xs text-slate-500 mr-auto">Adjunta el comprobante para poder guardar</span>}
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
              <button type="submit" form="form-gasto" disabled={!archivo || guardando || comprimiendo}
                className="px-4 py-1.5 text-sm bg-[#1a7fe8] text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {guardando ? "Guardando..." : "Guardar gasto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "cancelar" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-700">Cancelar gasto {seleccionado.folio}</h3>
            </div>
            <form id="form-cancelar-gasto" onSubmit={cancelar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-slate-500">
                El gasto no se borra: queda marcado como cancelado, deja de contar en los totales y en el corte del turno en curso, y su comprobante se conserva.
              </p>
              <label className="text-xs text-slate-500 block">Motivo *</label>
              <textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls} />
            </form>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Volver</button>
              <button type="submit" form="form-cancelar-gasto" className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Cancelar gasto</button>
            </div>
          </div>
        </div>
      )}

      {modal === "historial" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Historial de {seleccionado.folio}</h3>
              <button type="button" onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              {historial.map((m) => (
                <div key={m.id} className="border-b border-slate-100 pb-2">
                  <p className="text-sm">{m.descripcion}</p>
                  <p className="text-xs text-slate-400">{m.fecha.slice(0, 16).replace("T", " ")} — {m.usuario}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {ayudaAbierta && (
        <AyudaCategorias
          arbol={arbol}
          onElegir={(id) => { setForm((f) => ({ ...f, categoria_id: String(id) })); setAyudaAbierta(false); }}
          onCerrar={() => setAyudaAbierta(false)}
        />
      )}
    </div>
  );
}

/** Pestaña de administración del catálogo. Se define aquí, junto a su único
 *  consumidor, en vez de en un archivo aparte. */
function CategoriasGastos({ arbol, onCambio, mostrarAviso }) {
  const [nuevoGrupo, setNuevoGrupo] = useState("");
  const [nuevaHija, setNuevaHija] = useState({});

  const crear = async (nombre, padreId) => {
    const r = await apiFetch("/gastos/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre, categoria_padre_id: padreId }),
    });
    const data = await r.json();
    if (!r.ok) return mostrarAviso("❌ " + data.error);
    mostrarAviso("✅ Categoría agregada");
    onCambio();
  };

  const desactivar = async (id, nombre) => {
    if (!window.confirm(`¿Desactivar "${nombre}"? Los gastos que ya la usan la conservan.`)) return;
    const r = await apiFetch(`/gastos/categorias/${id}`, { method: "PUT", body: JSON.stringify({ activa: false }) });
    const data = await r.json();
    if (!r.ok) return mostrarAviso("❌ " + data.error);
    mostrarAviso("✅ Categoría desactivada");
    onCambio();
  };

  const renombrar = async (id, actual) => {
    const nombre = window.prompt("Nuevo nombre:", actual);
    if (!nombre || nombre === actual) return;
    const r = await apiFetch(`/gastos/categorias/${id}`, { method: "PUT", body: JSON.stringify({ nombre }) });
    const data = await r.json();
    if (!r.ok) return mostrarAviso("❌ " + data.error);
    onCambio();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex gap-2 mb-4 max-w-md">
        <input value={nuevoGrupo} onChange={(e) => setNuevoGrupo(e.target.value)} placeholder="Nuevo grupo" className={inputCls} />
        <button type="button" onClick={() => { if (nuevoGrupo.trim()) { crear(nuevoGrupo.trim(), null); setNuevoGrupo(""); } }}
          className="bg-[#1a7fe8] text-white rounded px-3 py-1.5 text-sm whitespace-nowrap">Agregar grupo</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {arbol.map((g) => (
          <div key={g.id} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium text-slate-700">{g.nombre}</p>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => renombrar(g.id, g.nombre)} className="text-[#1a7fe8] hover:underline">Renombrar</button>
                <button type="button" onClick={() => desactivar(g.id, g.nombre)} className="text-red-600 hover:underline">Desactivar</button>
              </div>
            </div>
            <ul className="space-y-1 mb-2">
              {g.hijas.map((h) => (
                <li key={h.id} className="flex items-center justify-between text-sm">
                  <span>{h.nombre}</span>
                  <div className="flex gap-2 text-xs">
                    <button type="button" onClick={() => renombrar(h.id, h.nombre)} className="text-[#1a7fe8] hover:underline">Renombrar</button>
                    <button type="button" onClick={() => desactivar(h.id, h.nombre)} className="text-red-600 hover:underline">Desactivar</button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <input
                value={nuevaHija[g.id] || ""}
                onChange={(e) => setNuevaHija({ ...nuevaHija, [g.id]: e.target.value })}
                placeholder="Nueva subcategoría" className={inputCls}
              />
              <button
                type="button"
                onClick={() => {
                  const nombre = (nuevaHija[g.id] || "").trim();
                  if (nombre) { crear(nombre, g.id); setNuevaHija({ ...nuevaHija, [g.id]: "" }); }
                }}
                className="bg-slate-100 text-slate-700 rounded px-2 text-sm whitespace-nowrap"
              >
                Agregar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
