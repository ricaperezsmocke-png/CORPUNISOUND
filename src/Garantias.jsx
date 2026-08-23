import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ShieldAlert, Search, X, ChevronLeft, ChevronRight, Send, MapPin, ClipboardCheck, PackageCheck, UserCheck, History, DollarSign, Upload, Trash2, FileText } from "lucide-react";
import { apiFetch } from "./api";
import { pedirLista } from "./cargaSegura";
import ModalConfirmar from "./ModalConfirmar";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const RESULTADOS_POR_PAGINA = 8;

const ESTADOS = {
  registrada: "Registrada",
  enviada: "Enviada",
  resuelta: "Resuelta",
  en_tienda_pendiente_entrega: "En tienda (pend. entrega)",
  cerrada: "Cerrada",
};

const TIPOS_RESOLUCION = [
  { valor: "reparado", etiqueta: "Reparado", conProducto: true },
  { valor: "reemplazo", etiqueta: "Reemplazo", conProducto: true },
  { valor: "cambio_componente", etiqueta: "Cambio de componente", conProducto: true },
  { valor: "rechazada", etiqueta: "Rechazada (no procede)", conProducto: false },
  { valor: "nota_credito", etiqueta: "Nota de crédito / reembolso", conProducto: false },
];

const TIPOS_GASTO = [
  { valor: "traslado", etiqueta: "Traslado" },
  { valor: "reparacion", etiqueta: "Reparación" },
  { valor: "otro", etiqueta: "Otro" },
];
const ETIQUETA_TIPO_GASTO = { traslado: "Traslado", reparacion: "Reparación", otro: "Otro" };
const MIME_GASTO_OK = ["application/pdf", "image/jpeg", "image/png"];
const TAM_MAX_GASTO = 10 * 1024 * 1024;

function leerArchivoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}
const FORM_GASTO = { tipo: "traslado", monto: "", descripcion: "" };

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto animate-panel-in`}>
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

const FORM_NUEVA = { producto_id: "", cliente_id: "", venta_id: "", notas_defecto: "", sucursal_origen_id: "" };
const FORM_ENVIAR = { destino_tipo: "proveedor", destino_nombre: "", proveedor_id: "" };
const FORM_UBICACION = { ubicacion_actual: "", notas: "" };
const FORM_RESOLUCION = { tipo_resolucion: "reparado", notas: "" };

export default function Garantias({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  const [garantias, setGarantias] = useState([]);
  const [errorGarantias, setErrorGarantias] = useState(null);
  const [errorCatalogos, setErrorCatalogos] = useState(null);
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);

  const [filtroEstado, setFiltroEstado] = useState("");
  const [soloAtrasadas, setSoloAtrasadas] = useState(false);

  const [modalNueva, setModalNueva] = useState(false);
  const [formNueva, setFormNueva] = useState(FORM_NUEVA);

  const [modalEnviar, setModalEnviar] = useState(null); // garantía o null
  const [formEnviar, setFormEnviar] = useState(FORM_ENVIAR);
  const [modalUbicacion, setModalUbicacion] = useState(null);
  const [formUbicacion, setFormUbicacion] = useState(FORM_UBICACION);
  const [modalResolucion, setModalResolucion] = useState(null);
  const [formResolucion, setFormResolucion] = useState(FORM_RESOLUCION);
  const [modalHistorial, setModalHistorial] = useState(null);
  const [modalGastos, setModalGastos] = useState(null); // garantía o null
  const [gastos, setGastos] = useState([]);
  const [errorGastos, setErrorGastos] = useState(null);
  const [formGasto, setFormGasto] = useState(FORM_GASTO);
  const [archivoGasto, setArchivoGasto] = useState(null); // File | null

  // Buscador de producto (mismo patrón visual que Traspasos/POS)
  const [modalBuscarProd, setModalBuscarProd] = useState(false);
  // Confirmación dentro de la app: { titulo, mensaje, textoConfirmar, peligro, alConfirmar }
  const [confirmacion, setConfirmacion] = useState(null);
  const [busquedaProd, setBusquedaProd] = useState("");
  const [paginaProd, setPaginaProd] = useState(1);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2800); };

  const cargarGarantias = useCallback(async () => {
    try {
      // Antes se hacía `setGarantias(await r.json())` sin mirar `r.ok`: el
      // `{error}` de un 403 entraba al estado y el `.filter` de la lista
      // tumbaba la pantalla. Y el aviso se iba solo, dejando una lista vacía
      // que se lee como "no hay garantías" — con equipos de clientes adentro.
      const { datos, error } = await pedirLista(() => apiFetch("/garantias"), "las garantías");
      setGarantias(datos);
      setErrorGarantias(error);
    } catch { mostrarAviso("❌ No se pudieron cargar las garantías"); }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [prod, cli, prov, suc] = await Promise.all([
        pedirLista(() => apiFetch("/productos?sucursal_id=todas"), "el catálogo de productos"),
        pedirLista(() => apiFetch("/clientes"), "los clientes"),
        pedirLista(() => apiFetch("/proveedores"), "los proveedores"),
        pedirLista(() => apiFetch("/sucursales"), "las sucursales"),
      ]);
      setProductos(prod.datos);
      setClientes(cli.datos);
      setProveedores(prov.datos);
      setSucursales(suc.datos);
      setErrorCatalogos(prod.error || cli.error || prov.error || suc.error);
      await cargarGarantias();
    } catch {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, [cargarGarantias]);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;
  const productoSeleccionado = productos.find((p) => p.id === Number(formNueva.producto_id)) || null;

  // ---------- Crear ----------
  const abrirNueva = () => { setFormNueva(FORM_NUEVA); setModalNueva(true); };

  const crearGarantia = async () => {
    if (!formNueva.producto_id) return mostrarAviso("Selecciona un producto");
    // Igual que en Traspasos: el select de sucursal solo lo ve quien ve todas.
    // El backend ya lo rechaza, pero avisar aquí evita llenar todo para nada.
    if (usuario?.ver_todas && !formNueva.sucursal_origen_id) return mostrarAviso("Selecciona la sucursal de origen — es la tienda de donde sale el producto");
    try {
      const r = await apiFetch("/garantias?sucursal_id=todas", { method: "POST", body: JSON.stringify(formNueva) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Garantía registrada");
      setModalNueva(false);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  // ---------- Acciones por estado ----------
  const abrirEnviar = (g) => { setFormEnviar(FORM_ENVIAR); setModalEnviar(g); };
  const enviar = async () => {
    if (!formEnviar.destino_nombre.trim()) return mostrarAviso("Indica el destino del envío");
    try {
      const r = await apiFetch(`/garantias/${modalEnviar.id}/enviar?sucursal_id=todas`, { method: "PUT", body: JSON.stringify(formEnviar) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(data.stock_ajustado
        ? "Garantía enviada — 1 pieza descontada de existencia"
        : "Garantía enviada (sin ajuste: el producto no tenía stock en esta sucursal)");
      setModalEnviar(null);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirUbicacion = (g) => { setFormUbicacion(FORM_UBICACION); setModalUbicacion(g); };
  const actualizarUbicacion = async () => {
    if (!formUbicacion.ubicacion_actual.trim()) return mostrarAviso("Indica la nueva ubicación");
    try {
      const r = await apiFetch(`/garantias/${modalUbicacion.id}/ubicacion?sucursal_id=todas`, { method: "PUT", body: JSON.stringify(formUbicacion) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Ubicación actualizada");
      setModalUbicacion(null);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirResolucion = (g) => { setFormResolucion(FORM_RESOLUCION); setModalResolucion(g); };
  const tipoResSeleccionado = TIPOS_RESOLUCION.find((t) => t.valor === formResolucion.tipo_resolucion);
  const registrarResolucion = async () => {
    try {
      const payload = { ...formResolucion };
      const r = await apiFetch(`/garantias/${modalResolucion.id}/resolucion?sucursal_id=todas`, { method: "PUT", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Resolución registrada");
      setModalResolucion(null);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  // ---------- Gastos de garantía ----------
  const abrirGastos = async (g) => {
    setModalGastos(g);
    setFormGasto(FORM_GASTO);
    setArchivoGasto(null);
    await cargarGastosDe(g.id);
  };

  /**
   * Carga los gastos de una garantía. ÚNICO camino: antes había tres copias de
   * este `fetch` y ninguna comprobaba `r.ok`.
   *
   * Por qué importa tanto: cuando la garantía ya no existe —restauraste un
   * respaldo, o alguien más la cerró mientras tenías la lista abierta— la ruta
   * responde `{error: "..."}`. Ese objeto entraba en `gastos`, y el
   * `gastos.reduce(...)` del cuerpo del componente reventaba AL DIBUJAR,
   * dejando la pantalla en blanco y perdiendo lo capturado.
   *
   * El `catch` de antes no podía atraparlo: el error no ocurría al pedir los
   * datos, ocurría después, al pintar. Por eso aquí se valida que lo recibido
   * sea de verdad una lista antes de dejarlo entrar al estado.
   */
  const cargarGastosDe = async (garantiaId) => {
    try {
      const r = await apiFetch(`/garantias/${garantiaId}/gastos?sucursal_id=todas`);
      const data = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(data)) {
        throw new Error(data?.error || "No se pudieron cargar los gastos");
      }
      setGastos(data);
      setErrorGastos(null);
    } catch (e) {
      setGastos([]);
      // Se distingue "no hay gastos" de "no se pudieron cargar": una lista
      // vacía por fallo se ve idéntica a una lista vacía de verdad.
      setErrorGastos(e.message || "No se pudieron cargar los gastos");
    }
  };

  // `Array.isArray` no sobra aunque el cargador ya lo valide: este cálculo
  // corre en CADA render, y si algún día vuelve a entrar algo que no sea lista,
  // el precio es la pantalla completa en blanco.
  const totalGastosModal = Array.isArray(gastos)
    ? gastos.reduce((s, x) => s + Number(x.monto || 0), 0)
    : 0;

  const agregarGastoUI = async () => {
    const monto = Number(formGasto.monto);
    if (!Number.isFinite(monto) || monto <= 0) return mostrarAviso("El monto debe ser mayor que cero");
    let archivoPayload = {};
    if (archivoGasto) {
      if (!MIME_GASTO_OK.includes(archivoGasto.type)) return mostrarAviso("❌ Solo PDF, JPG o PNG");
      if (archivoGasto.size > TAM_MAX_GASTO) return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
      const contenido_base64 = await leerArchivoBase64(archivoGasto);
      archivoPayload = { nombre_archivo: archivoGasto.name, tipo_mime: archivoGasto.type, contenido_base64 };
    }
    try {
      const r = await apiFetch(`/garantias/${modalGastos.id}/gastos?sucursal_id=todas`, {
        method: "POST",
        body: JSON.stringify({ tipo: formGasto.tipo, monto, descripcion: formGasto.descripcion, ...archivoPayload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Gasto agregado");
      setFormGasto(FORM_GASTO);
      setArchivoGasto(null);
      await cargarGastosDe(modalGastos.id);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const eliminarGastoUI = (gastoId) => setConfirmacion({
    titulo: "Eliminar gasto",
    mensaje: `¿Eliminar este gasto de ${modalGastos.folio}? Si tiene comprobante, también se borrará de Google Drive.\n\nEsto no se puede deshacer.`,
    textoConfirmar: "Sí, eliminar",
    peligro: true,
    alConfirmar: () => eliminarGastoConfirmado(gastoId),
  });

  const eliminarGastoConfirmado = async (gastoId) => {
    try {
      const r = await apiFetch(`/garantias/${modalGastos.id}/gastos/${gastoId}?sucursal_id=todas`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Gasto eliminado");
      await cargarGastosDe(modalGastos.id);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const recibir = (g) => setConfirmacion({
    titulo: `Recibir en tienda — ${g.folio}`,
    mensaje: `El producto se reintegra a la existencia de ${g.sucursal_origen_nombre}.`,
    textoConfirmar: "Sí, recibir",
    alConfirmar: () => recibirConfirmado(g),
  });

  const recibirConfirmado = async (g) => {
    try {
      const r = await apiFetch(`/garantias/${g.id}/recibir?sucursal_id=todas`, { method: "PUT", body: JSON.stringify({}) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(data.stock_ajustado
        ? "Garantía recibida — 1 pieza reintegrada a inventario"
        : "Garantía recibida (sin ajuste: el producto no tenía stock en esta sucursal)");
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const entregar = (g) => setConfirmacion({
    titulo: `Entregar al cliente — ${g.folio}`,
    mensaje: "Se entrega el producto al cliente y la garantía queda cerrada.",
    textoConfirmar: "Sí, entregar",
    alConfirmar: () => entregarConfirmado(g),
  });

  const entregarConfirmado = async (g) => {
    try {
      const r = await apiFetch(`/garantias/${g.id}/entregar-cliente?sucursal_id=todas`, { method: "PUT", body: JSON.stringify({}) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Garantía entregada y cerrada");
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  // ---------- Filtros ----------
  const garantiasFiltradas = useMemo(() => {
    let lista = garantias;
    if (filtroEstado) lista = lista.filter((g) => g.estado === filtroEstado);
    if (soloAtrasadas) lista = lista.filter((g) => g.atrasada);
    return lista;
  }, [garantias, filtroEstado, soloAtrasadas]);

  // ---------- Buscador de producto ----------
  const productosFiltrados = useMemo(() => {
    const q = busquedaProd.toLowerCase();
    return productos.filter((p) => p.nombre.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q));
  }, [productos, busquedaProd]);
  const totalPaginasProd = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaProd - 1) * RESULTADOS_POR_PAGINA, paginaProd * RESULTADOS_POR_PAGINA);
  const abrirBuscarProd = () => { setBusquedaProd(""); setPaginaProd(1); setModalBuscarProd(true); };
  const elegirProducto = (p) => { setFormNueva((f) => ({ ...f, producto_id: p.id })); setModalBuscarProd(false); };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      {/* Barra de filtros + acción */}
      <div className="bg-white border-b border-slate-100 px-5 py-3 flex flex-wrap items-center gap-3 shrink-0">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={soloAtrasadas} onChange={(e) => setSoloAtrasadas(e.target.checked)} />
          Solo atrasadas
        </label>
        <div className="flex-1" />
        {puede("gestionar_garantias") && (
          <button onClick={abrirNueva} className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5">
            <ShieldAlert size={14} /> Nueva garantía
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Cargando...</p>
        ) : (
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal origen</th>
                <th className="py-2 px-3 text-left font-medium">Cliente</th>
                <th className="py-2 px-3 text-left font-medium">Estado</th>
                <th className="py-2 px-3 text-left font-medium">Ubicación</th>
                <th className="py-2 px-3 text-center font-medium">Días s/mov.</th>
                <th className="py-2 px-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {garantiasFiltradas.length === 0 && (
                <tr><td colSpan={8} className={`text-center py-10 ${errorGarantias ? "text-red-700" : "text-slate-400"}`}>
                  {errorGarantias
                    ? <>⚠ {errorGarantias} <b>No le digas a un cliente que su equipo no está registrado sin volver a intentar.</b></>
                    : "Sin garantías"}
                </td></tr>
              )}
              {garantiasFiltradas.map((g) => (
                <tr key={g.id} className="border-b border-slate-100">
                  <td className="py-2 px-3 font-medium">{g.folio}</td>
                  <td className="py-2 px-3">{g.producto_nombre}</td>
                  <td className="py-2 px-3">{g.sucursal_origen_nombre}</td>
                  <td className="py-2 px-3 text-slate-500">{g.cliente_nombre || "—"}</td>
                  <td className="py-2 px-3">{ESTADOS[g.estado] || g.estado}</td>
                  <td className="py-2 px-3 text-slate-500">{g.ubicacion_actual}</td>
                  <td className="py-2 px-3 text-center">
                    {g.atrasada
                      ? <span className="inline-block bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full text-xs">{g.dias_sin_movimiento}</span>
                      : <span className="text-slate-500">{g.dias_sin_movimiento}</span>}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {g.estado === "registrada" && puede("gestionar_garantias") && (
                        <button onClick={() => abrirEnviar(g)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><Send size={12} /> Marcar enviada</button>
                      )}
                      {g.estado === "enviada" && puede("gestionar_garantias") && (
                        <>
                          <button onClick={() => abrirUbicacion(g)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><MapPin size={12} /> Ubicación</button>
                          <button onClick={() => abrirResolucion(g)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><ClipboardCheck size={12} /> Resolución</button>
                        </>
                      )}
                      {g.estado === "resuelta" && puede("gestionar_garantias") && (
                        <button onClick={() => recibir(g)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><PackageCheck size={12} /> Recibir en tienda</button>
                      )}
                      {g.estado === "en_tienda_pendiente_entrega" && puede("gestionar_garantias") && (
                        <button onClick={() => entregar(g)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><UserCheck size={12} /> Entregar a cliente</button>
                      )}
                      {puede("gestionar_garantias") && (
                        <button onClick={() => abrirGastos(g)} className="text-emerald-700 hover:text-emerald-900 text-xs px-2 py-1 rounded flex items-center gap-1"><DollarSign size={12} /> Gastos{g.total_gastos > 0 ? ` ($${Number(g.total_gastos).toFixed(2)})` : ""}</button>
                      )}
                      <button onClick={() => setModalHistorial(g)} className="text-slate-500 hover:text-slate-700 text-xs px-2 py-1 rounded flex items-center gap-1"><History size={12} /> Historial</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
      )}

      {/* Modal Nueva garantía */}
      {modalNueva && (
        <Modal titulo="Nueva garantía" onCerrar={() => setModalNueva(false)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Producto">
              <button type="button" onClick={abrirBuscarProd} className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-left hover:bg-slate-50 flex items-center justify-between">
                <span className={productoSeleccionado ? "text-slate-800" : "text-slate-400"}>
                  {productoSeleccionado ? productoSeleccionado.nombre : "Buscar producto..."}
                </span>
                <Search size={14} className="text-slate-400 shrink-0" />
              </button>
            </Campo>
            {usuario?.ver_todas && (
              <Campo label="Sucursal de origen">
                <select className={inputCls} value={formNueva.sucursal_origen_id} onChange={(e) => setFormNueva({ ...formNueva, sucursal_origen_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Cliente (opcional — dejar en blanco si es stock propio)">
              <select className={inputCls} value={formNueva.cliente_id} onChange={(e) => setFormNueva({ ...formNueva, cliente_id: e.target.value })}>
                <option value="">Sin cliente (stock propio)</option>
                {clientes.filter((c) => c.id !== 0).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Folio de venta (opcional)">
              <input className={inputCls} value={formNueva.venta_id} onChange={(e) => setFormNueva({ ...formNueva, venta_id: e.target.value })} placeholder="ej: 1024" />
            </Campo>
            <Campo label="Notas del defecto">
              <textarea className={inputCls} rows={2} value={formNueva.notas_defecto} onChange={(e) => setFormNueva({ ...formNueva, notas_defecto: e.target.value })} placeholder="ej: no enciende, viene con golpe..." />
            </Campo>
            <button onClick={crearGarantia} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-1">Registrar garantía</button>
          </div>
        </Modal>
      )}

      {/* Modal Marcar enviada */}
      {modalEnviar && (
        <Modal titulo={`Marcar enviada — ${modalEnviar.folio}`} onCerrar={() => setModalEnviar(null)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Destino">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="destino_tipo" checked={formEnviar.destino_tipo === "proveedor"} onChange={() => setFormEnviar({ ...formEnviar, destino_tipo: "proveedor" })} /> Proveedor directo
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="destino_tipo" checked={formEnviar.destino_tipo === "cedis"} onChange={() => setFormEnviar({ ...formEnviar, destino_tipo: "cedis" })} /> Vía CEDIS
                </label>
              </div>
            </Campo>
            <Campo label="Nombre del destino (a dónde se envía físicamente)">
              <input className={inputCls} value={formEnviar.destino_nombre} onChange={(e) => setFormEnviar({ ...formEnviar, destino_nombre: e.target.value })} placeholder={formEnviar.destino_tipo === "cedis" ? "ej: CEDIS" : "ej: Proveedor XYZ"} />
            </Campo>
            <Campo label="Proveedor (opcional)">
              <select className={inputCls} value={formEnviar.proveedor_id} onChange={(e) => setFormEnviar({ ...formEnviar, proveedor_id: e.target.value })}>
                <option value="">Sin definir aún</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <p className="text-xs text-slate-500">Al enviar se descuenta 1 pieza de la existencia de {modalEnviar.sucursal_origen_nombre}.</p>
            <button onClick={enviar} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-1">Marcar enviada</button>
          </div>
        </Modal>
      )}

      {/* Modal Actualizar ubicación */}
      {modalUbicacion && (
        <Modal titulo={`Actualizar ubicación — ${modalUbicacion.folio}`} onCerrar={() => setModalUbicacion(null)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Nueva ubicación">
              <input className={inputCls} value={formUbicacion.ubicacion_actual} onChange={(e) => setFormUbicacion({ ...formUbicacion, ubicacion_actual: e.target.value })} placeholder="ej: Proveedor XYZ (CEDIS reenvía)" />
            </Campo>
            <Campo label="Notas (opcional)">
              <input className={inputCls} value={formUbicacion.notas} onChange={(e) => setFormUbicacion({ ...formUbicacion, notas: e.target.value })} />
            </Campo>
            <button onClick={actualizarUbicacion} className="bg-slate-700 hover:bg-slate-800 text-white py-2 rounded font-semibold mt-1">Guardar ubicación</button>
          </div>
        </Modal>
      )}

      {/* Modal Registrar resolución */}
      {modalResolucion && (
        <Modal titulo={`Registrar resolución — ${modalResolucion.folio}`} onCerrar={() => setModalResolucion(null)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Tipo de resolución">
              <select className={inputCls} value={formResolucion.tipo_resolucion} onChange={(e) => setFormResolucion({ ...formResolucion, tipo_resolucion: e.target.value })}>
                {TIPOS_RESOLUCION.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
              </select>
            </Campo>
            <Campo label="Notas">
              <textarea className={inputCls} rows={2} value={formResolucion.notas} onChange={(e) => setFormResolucion({ ...formResolucion, notas: e.target.value })} placeholder={tipoResSeleccionado?.conProducto ? "detalle de la reparación/reemplazo" : "monto del crédito, motivo del rechazo, etc."} />
            </Campo>
            {!tipoResSeleccionado?.conProducto && (
              <p className="text-xs text-slate-500">Rechazada y nota de crédito cierran la garantía de inmediato (no hay producto físico de regreso).</p>
            )}
            <button onClick={registrarResolucion} className="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-semibold mt-1">Registrar resolución</button>
          </div>
        </Modal>
      )}

      {/* Modal Historial */}
      {modalHistorial && (
        <Modal titulo={`Historial — ${modalHistorial.folio}`} onCerrar={() => setModalHistorial(null)} ancho="max-w-lg">
          <div className="flex flex-col gap-2">
            {(modalHistorial.movimientos || []).length === 0 && <p className="text-slate-400 text-sm">Sin movimientos.</p>}
            {(modalHistorial.movimientos || []).map((m) => (
              <div key={m.id} className="border-b border-slate-100 pb-2">
                <div className="text-xs text-slate-400">{new Date(m.fecha).toLocaleString()} — {m.usuario}</div>
                <div className="text-sm">{m.descripcion}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Modal Gastos */}
      {modalGastos && (
        <Modal titulo={`Gastos — ${modalGastos.folio}`} onCerrar={() => setModalGastos(null)} ancho="max-w-2xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
              <span className="text-sm text-slate-500">Total de gastos</span>
              <span className="text-lg font-semibold text-slate-800">${totalGastosModal.toFixed(2)}</span>
            </div>

            <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {errorGastos && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 my-2">
                  {errorGastos} — cierra y vuelve a abrir esta garantía, o recarga la página.
                </p>
              )}
              {!errorGastos && gastos.length === 0 && <p className="text-slate-400 text-sm text-center py-6">Sin gastos registrados</p>}
              {gastos.map((x) => (
                <div key={x.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{ETIQUETA_TIPO_GASTO[x.tipo] || x.tipo}</span>
                    <span className="text-slate-500"> — ${Number(x.monto).toFixed(2)}</span>
                    {x.descripcion ? <span className="text-slate-400"> · {x.descripcion}</span> : null}
                    {x.drive_link ? <a href={x.drive_link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline ml-2 inline-flex items-center gap-1"><FileText size={11} /> Ver</a> : null}
                  </div>
                  <button onClick={() => eliminarGastoUI(x.id)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Campo label="Tipo">
                  <select className={inputCls} value={formGasto.tipo} onChange={(e) => setFormGasto({ ...formGasto, tipo: e.target.value })}>
                    {TIPOS_GASTO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
                  </select>
                </Campo>
                <Campo label="Monto">
                  <input type="number" min="0" step="0.01" className={inputCls} value={formGasto.monto} onChange={(e) => setFormGasto({ ...formGasto, monto: e.target.value })} placeholder="0.00" />
                </Campo>
              </div>
              <Campo label="Descripción (opcional)">
                <input className={inputCls} value={formGasto.descripcion} onChange={(e) => setFormGasto({ ...formGasto, descripcion: e.target.value })} placeholder="ej: flete de ida a Sensey" />
              </Campo>
              <Campo label="Comprobante (opcional — PDF/JPG/PNG, máx 10MB)">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer border border-slate-300 rounded px-2.5 py-1.5 hover:bg-slate-50">
                  <Upload size={14} /> {archivoGasto ? archivoGasto.name : "Elegir archivo..."}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setArchivoGasto(e.target.files?.[0] || null)} />
                </label>
              </Campo>
              <button onClick={agregarGastoUI} className="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-semibold mt-1">Agregar gasto</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Buscar producto */}
      {modalBuscarProd && (
        <Modal titulo="Buscar producto" onCerrar={() => setModalBuscarProd(false)} ancho="max-w-3xl">
          <input
            autoFocus
            value={busquedaProd}
            onChange={(e) => { setBusquedaProd(e.target.value); setPaginaProd(1); }}
            placeholder="Clave o descripción..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Precio</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={2} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => elegirProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.precio_venta).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-3 mt-3">
            <button disabled={paginaProd <= 1} onClick={() => setPaginaProd((p) => p - 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-500">Página {paginaProd} de {totalPaginasProd}</span>
            <button disabled={paginaProd >= totalPaginasProd} onClick={() => setPaginaProd((p) => p + 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </Modal>
      )}

      {confirmacion && (
        <ModalConfirmar
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoConfirmar={confirmacion.textoConfirmar}
          peligro={confirmacion.peligro}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => {
            // Se cierra ANTES de ejecutar: si la acción tarda o falla, la caja
            // no se queda colgada encima ni se puede confirmar dos veces.
            const accion = confirmacion.alConfirmar;
            setConfirmacion(null);
            accion();
          }}
        />
      )}
    </div>
  );
}
