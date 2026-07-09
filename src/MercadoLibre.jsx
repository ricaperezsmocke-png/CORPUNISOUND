import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Link, Link2Off, ShoppingBag, Package, PlusCircle,
  Settings, ExternalLink, CheckCircle, XCircle, Clock, AlertTriangle,
  ArrowUpDown, Banknote
} from "lucide-react";
import { apiFetch, API } from "./api";

function Tab({ activo, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        activo ? "border-[#1a7fe8] text-[#1a7fe8]" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function BotonBarra({ icono: Icono, etiqueta, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 border-r border-slate-100 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icono size={18} className="text-[#1a7fe8]" />
      <span className="text-[10px] font-medium text-slate-500">{etiqueta}</span>
    </button>
  );
}

const BADGE_ESTADO = {
  active:    { bg: "bg-green-50",  text: "text-green-700",  label: "Activa" },
  paused:    { bg: "bg-amber-50",  text: "text-amber-700",  label: "Pausada" },
  closed:    { bg: "bg-slate-100", text: "text-slate-500",  label: "Cerrada" },
  paid:      { bg: "bg-green-50",  text: "text-green-700",  label: "Pagada" },
  pending:   { bg: "bg-amber-50",  text: "text-amber-700",  label: "Pendiente" },
  cancelled: { bg: "bg-red-50",    text: "text-red-600",    label: "Cancelada" },
};

function BadgeEstado({ estado }) {
  const s = BADGE_ESTADO[estado] || { bg: "bg-slate-100", text: "text-slate-500", label: estado };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
  );
}

// ── Modal Publicar ──────────────────────────────────────────────────────────────

function ModalPublicar({ productos, onPublicar, onCerrar }) {
  const [form, setForm] = useState({
    producto_id: "", titulo: "", categoria_ml: "", precio: "",
    cantidad: "1", tipo_publicacion: "gold_special",
    descripcion: "", foto_url: "",
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const prod = productos.find((p) => p.id === Number(form.producto_id));
  const set  = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleChange = (e) => set(e.target.name, e.target.value);

  const handleProducto = (e) => {
    const p = productos.find((x) => x.id === Number(e.target.value));
    setForm((f) => ({
      ...f,
      producto_id: e.target.value,
      titulo:      p ? p.nombre : "",
      precio:      p ? String(p.precio_venta) : "",
    }));
  };

  const enviar = async (e) => {
    e.preventDefault();
    if (!form.categoria_ml) return setError("Ingresa el ID de categoría de ML (ej: MLM1055)");
    setError(null); setEnviando(true);
    try {
      await onPublicar(form);
      onCerrar();
    } catch (err) { setError(err.message); }
    finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Publicar en MercadoLibre</h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>
        <form onSubmit={enviar} className="p-5 flex flex-col gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Producto del catálogo *</label>
            <select
              required name="producto_id" value={form.producto_id}
              onChange={handleProducto}
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
            >
              <option value="">— Seleccionar —</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} (SKU: {p.sku})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Título de la publicación *</label>
            <input
              required name="titulo" value={form.titulo} onChange={handleChange}
              placeholder="Ej: Guitarra Acústica Folk Natural con Funda"
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">ID Categoría ML *</label>
              <input
                required name="categoria_ml" value={form.categoria_ml} onChange={handleChange}
                placeholder="Ej: MLM1055"
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
              <p className="text-[10px] text-slate-400 mt-0.5">Busca en ml.com tu categoría</p>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Tipo publicación</label>
              <select
                name="tipo_publicacion" value={form.tipo_publicacion} onChange={handleChange}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              >
                <option value="gold_special">Clásica (gratis)</option>
                <option value="gold_pro">Premium</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Precio (MXN) *</label>
              <input
                required type="number" step="0.01" min="0" name="precio"
                value={form.precio} onChange={handleChange}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Cantidad disponible *</label>
              <input
                required type="number" min="1" name="cantidad"
                value={form.cantidad} onChange={handleChange}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">URL de foto principal</label>
            <input
              name="foto_url" value={form.foto_url} onChange={handleChange}
              placeholder="https://..."
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Descripción</label>
            <textarea
              name="descripcion" value={form.descripcion} onChange={handleChange}
              rows={2} placeholder="Descripción del producto para los compradores..."
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onCerrar}
              className="flex-1 border border-slate-300 text-slate-600 rounded-lg py-2 text-sm hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={enviando}
              className="flex-1 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: "linear-gradient(90deg,#1a7fe8,#1262b8)" }}>
              {enviando ? "Publicando..." : "Publicar en ML"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function MercadoLibre({ onVolver, permisos }) {
  const [tab, setTab]                   = useState("publicaciones");
  const [estado, setEstado]             = useState(null);
  const [publicaciones, setPublicaciones] = useState([]);
  const [ordenes, setOrdenes]           = useState([]);
  const [productos, setProductos]       = useState([]);
  const [cargando, setCargando]         = useState(false);
  const [aviso, setAviso]               = useState(null);
  const [modalPublicar, setModalPublicar] = useState(false);
  const [importando, setImportando]     = useState(null);

  const mostrarAviso = (msg) => { setAviso(msg); setTimeout(() => setAviso(null), 3000); };

  // Detectar ?ml=conectado en la URL (vuelta del OAuth)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ml") === "conectado") {
      mostrarAviso("✅ Cuenta de MercadoLibre conectada correctamente");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("ml") === "error") {
      mostrarAviso("❌ Error al conectar: " + (params.get("msg") || "desconocido"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const cargarEstado = useCallback(async () => {
    const r = await apiFetch("/ml/estado");
    if (r.ok) setEstado(await r.json());
  }, []);

  const cargarPublicaciones = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/ml/publicaciones");
      if (r.ok) setPublicaciones(await r.json());
      else { const d = await r.json(); mostrarAviso("❌ " + d.error); }
    } finally { setCargando(false); }
  }, []);

  const cargarOrdenes = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/ml/ordenes");
      if (r.ok) setOrdenes(await r.json());
      else { const d = await r.json(); mostrarAviso("❌ " + d.error); }
    } finally { setCargando(false); }
  }, []);

  const cargarProductos = useCallback(async () => {
    const r = await apiFetch("/productos");
    if (r.ok) setProductos(await r.json());
  }, []);

  useEffect(() => { cargarEstado(); cargarProductos(); }, [cargarEstado, cargarProductos]);

  useEffect(() => {
    if (!estado?.conectado) return;
    if (tab === "publicaciones") cargarPublicaciones();
    if (tab === "ordenes") cargarOrdenes();
  }, [tab, estado]);

  const conectarML = async () => {
    const r = await apiFetch("/ml/auth-url");
    if (!r.ok) { const d = await r.json(); return mostrarAviso("❌ " + d.error); }
    const { url } = await r.json();
    window.location.href = url;
  };

  const desconectar = async () => {
    if (!confirm("¿Desconectar la cuenta de MercadoLibre?")) return;
    await apiFetch("/ml/desconectar", { method: "DELETE" });
    setEstado((e) => ({ ...e, conectado: false }));
    setPublicaciones([]); setOrdenes([]);
    mostrarAviso("Cuenta desconectada");
  };

  const publicar = async (datos) => {
    const r = await apiFetch("/ml/publicar", {
      method: "POST", body: JSON.stringify(datos),
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    mostrarAviso("✅ Producto publicado en MercadoLibre");
    cargarPublicaciones();
  };

  const importarOrden = async (ordenId) => {
    setImportando(ordenId);
    try {
      const r = await apiFetch(`/ml/ordenes/${ordenId}/importar`, { method: "POST" });
      if (r.ok) mostrarAviso("✅ Orden importada como venta en el sistema");
      else { const d = await r.json(); mostrarAviso("❌ " + d.error); }
    } finally { setImportando(null); }
  };

  const actualizarStock = async (itemId, cantidadActual) => {
    const val = prompt(`Nueva cantidad disponible (actual: ${cantidadActual}):`);
    if (val === null || isNaN(Number(val))) return;
    const r = await apiFetch(`/ml/publicaciones/${itemId}/stock`, {
      method: "PUT", body: JSON.stringify({ cantidad: Number(val) }),
    });
    if (r.ok) { mostrarAviso("✅ Stock actualizado en ML"); cargarPublicaciones(); }
    else { const d = await r.json(); mostrarAviso("❌ " + d.error); }
  };

  const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0);
  const fmtFecha = (s) => s ? new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm select-none">

      {/* Toolbar */}
      <div className="bg-white border-b border-slate-100 flex items-center shrink-0">
        <BotonBarra icono={RefreshCw} etiqueta="Recargar"
          onClick={() => tab === "publicaciones" ? cargarPublicaciones() : cargarOrdenes()} />
        {!estado?.conectado ? (
          <BotonBarra icono={Link} etiqueta="Conectar ML" onClick={conectarML}
            disabled={!estado?.configurado} />
        ) : (
          <BotonBarra icono={Link2Off} etiqueta="Desconectar" onClick={desconectar} />
        )}
        {estado?.conectado && (
          <BotonBarra icono={PlusCircle} etiqueta="Publicar" onClick={() => setModalPublicar(true)} />
        )}
        {estado && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded ml-2 ${
            estado.conectado
              ? "bg-green-50 text-green-700"
              : "bg-slate-100 text-slate-500"
          }`}>
            {estado.conectado
              ? <><CheckCircle size={12} /> Conectado {estado.conectado_en ? `· ${fmtFecha(estado.conectado_en)}` : ""}</>
              : !estado.configurado
              ? <><AlertTriangle size={12} /> ML_CLIENT_ID no configurado — ve a Configuración</>
              : <><XCircle size={12} /> Sin cuenta conectada</>
            }
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 flex shrink-0">
        <Tab activo={tab === "publicaciones"} onClick={() => setTab("publicaciones")}>
          <span className="flex items-center gap-1.5"><Package size={14} /> Publicaciones</span>
        </Tab>
        <Tab activo={tab === "ordenes"} onClick={() => setTab("ordenes")}>
          <span className="flex items-center gap-1.5"><ShoppingBag size={14} /> Órdenes</span>
        </Tab>
        <Tab activo={tab === "configuracion"} onClick={() => setTab("configuracion")}>
          <span className="flex items-center gap-1.5"><Settings size={14} /> Configuración</span>
        </Tab>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-auto p-6">

        {/* ── Publicaciones ── */}
        {tab === "publicaciones" && (
          <div>
            {!estado?.conectado ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-md mx-auto">
                <Package size={40} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-700 mb-1">Conecta tu cuenta de ML</h3>
                <p className="text-xs text-slate-500 mb-4">
                  Para ver y gestionar tus publicaciones, primero conecta tu cuenta de MercadoLibre desde la pestaña Configuración.
                </p>
                <button onClick={() => setTab("configuracion")}
                  className="text-[#1a7fe8] text-sm font-medium hover:underline">
                  Ir a Configuración →
                </button>
              </div>
            ) : cargando ? (
              <p className="text-slate-400 text-center py-12">Cargando publicaciones...</p>
            ) : publicaciones.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Package size={36} className="mx-auto mb-3 opacity-40" />
                <p>No hay publicaciones activas o pausadas</p>
                <button onClick={() => setModalPublicar(true)}
                  className="mt-3 text-[#1a7fe8] text-sm font-medium hover:underline">
                  + Crear primera publicación
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "linear-gradient(90deg,#1a7fe8,#1262b8)" }} className="text-white text-xs">
                      <th className="px-3 py-2.5 text-left font-medium">Foto</th>
                      <th className="px-3 py-2.5 text-left font-medium">Publicación</th>
                      <th className="px-3 py-2.5 text-right font-medium">Precio</th>
                      <th className="px-3 py-2.5 text-center font-medium">Stock</th>
                      <th className="px-3 py-2.5 text-center font-medium">Estado</th>
                      <th className="px-3 py-2.5 text-center font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {publicaciones.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          {item.thumbnail
                            ? <img src={item.thumbnail} alt="" className="w-10 h-10 object-cover rounded" />
                            : <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center text-slate-300"><Package size={18} /></div>
                          }
                        </td>
                        <td className="px-3 py-2 max-w-xs">
                          <div className="font-medium text-slate-800 truncate">{item.title}</div>
                          <div className="text-xs text-slate-400">{item.id}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{fmt(item.price)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`font-semibold ${item.available_quantity <= 5 ? "text-red-600" : "text-slate-700"}`}>
                            {item.available_quantity}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center"><BadgeEstado estado={item.status} /></td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => actualizarStock(item.id, item.available_quantity)}
                              title="Ajustar stock"
                              className="p-1.5 rounded hover:bg-blue-50 text-[#1a7fe8]">
                              <ArrowUpDown size={14} />
                            </button>
                            <a href={item.permalink} target="_blank" rel="noopener noreferrer"
                              title="Ver en ML"
                              className="p-1.5 rounded hover:bg-blue-50 text-[#1a7fe8]">
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Órdenes ── */}
        {tab === "ordenes" && (
          <div>
            {!estado?.conectado ? (
              <div className="text-center py-12 text-slate-400">
                <ShoppingBag size={36} className="mx-auto mb-3 opacity-40" />
                <p>Conecta tu cuenta ML para ver las órdenes</p>
              </div>
            ) : cargando ? (
              <p className="text-slate-400 text-center py-12">Cargando órdenes...</p>
            ) : ordenes.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ShoppingBag size={36} className="mx-auto mb-3 opacity-40" />
                <p>No hay órdenes recientes</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "linear-gradient(90deg,#1a7fe8,#1262b8)" }} className="text-white text-xs">
                      <th className="px-3 py-2.5 text-left font-medium"># Orden</th>
                      <th className="px-3 py-2.5 text-left font-medium">Comprador</th>
                      <th className="px-3 py-2.5 text-left font-medium">Productos</th>
                      <th className="px-3 py-2.5 text-left font-medium">Fecha</th>
                      <th className="px-3 py-2.5 text-right font-medium">Total</th>
                      <th className="px-3 py-2.5 text-center font-medium">Estado</th>
                      <th className="px-3 py-2.5 text-center font-medium">Importar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenes.map((o) => (
                      <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{o.id}</td>
                        <td className="px-3 py-2 font-medium">{o.buyer?.nickname || "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 max-w-xs">
                          {(o.order_items || []).map((i) => (
                            <div key={i.item?.id} className="truncate">{i.quantity}× {i.item?.title}</div>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs">{fmtFecha(o.date_created)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmt(o.total_amount)}</td>
                        <td className="px-3 py-2 text-center"><BadgeEstado estado={o.status} /></td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => importarOrden(String(o.id))}
                            disabled={importando === String(o.id)}
                            className="flex items-center gap-1 mx-auto text-xs text-[#1a7fe8] hover:text-[#1262b8] font-medium disabled:opacity-40"
                          >
                            <Banknote size={13} />
                            {importando === String(o.id) ? "..." : "Importar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Configuración ── */}
        {tab === "configuracion" && (
          <div className="max-w-xl space-y-4">
            {/* Estado conexión */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-semibold text-slate-800 mb-3">Cuenta de MercadoLibre</h3>
              {!estado?.configurado ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5"><AlertTriangle size={14} /> Credenciales no configuradas</div>
                  <p>Para conectar MercadoLibre necesitas registrar una aplicación en el portal de desarrolladores y configurar las variables de entorno en Render:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-1">
                    <li>Ve a <strong>developers.mercadolibre.com.mx</strong> e inicia sesión</li>
                    <li>Crea una nueva aplicación</li>
                    <li>En "URI de Redirección" agrega: <code className="bg-amber-100 px-1 rounded">https://punto-de-venta-backend.onrender.com/api/ml/callback</code></li>
                    <li>Copia el <strong>App ID</strong> y el <strong>Secret Key</strong></li>
                    <li>En Render (backend) → Environment, agrega:
                      <ul className="ml-3 mt-1 space-y-0.5">
                        <li><code className="bg-amber-100 px-1 rounded">ML_CLIENT_ID</code> = tu App ID</li>
                        <li><code className="bg-amber-100 px-1 rounded">ML_CLIENT_SECRET</code> = tu Secret Key</li>
                        <li><code className="bg-amber-100 px-1 rounded">ML_REDIRECT_URI</code> = <code className="bg-amber-100 px-1 rounded">https://punto-de-venta-backend.onrender.com/api/ml/callback</code></li>
                      </ul>
                    </li>
                  </ol>
                </div>
              ) : estado?.conectado ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-4 py-3">
                    <CheckCircle size={16} />
                    <span className="text-sm font-medium">Cuenta conectada</span>
                    {estado.conectado_en && (
                      <span className="text-xs text-green-600 ml-auto">Desde {fmtFecha(estado.conectado_en)}</span>
                    )}
                  </div>
                  <button
                    onClick={desconectar}
                    className="flex items-center gap-2 text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    <Link2Off size={14} /> Desconectar cuenta
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Haz clic en "Conectar con MercadoLibre" para autorizar al sistema a acceder a tus publicaciones y órdenes.
                    Serás redirigido a ML y de vuelta automáticamente.
                  </p>
                  <button
                    onClick={conectarML}
                    className="flex items-center gap-2 text-white text-sm font-medium px-4 py-2.5 rounded-lg"
                    style={{ background: "linear-gradient(90deg,#FFE600,#F5D600)", color: "#333" }}
                  >
                    <img
                      src="https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/logo__large_plus.png"
                      alt="ML" className="h-4 object-contain"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                    Conectar con MercadoLibre
                  </button>
                </div>
              )}
            </div>

            {/* Cómo funciona */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-semibold text-slate-800 mb-3">¿Cómo funciona la integración?</h3>
              <ul className="space-y-2 text-xs text-slate-600">
                <li className="flex gap-2"><span className="text-[#1a7fe8] font-bold mt-0.5">→</span> <span><strong>MercadoLibre como sucursal:</strong> Las ventas de ML se registran como una sucursal virtual independiente (sucursal 5) con su propio inventario.</span></li>
                <li className="flex gap-2"><span className="text-[#1a7fe8] font-bold mt-0.5">→</span> <span><strong>Publicar productos:</strong> Sube cualquier producto del catálogo a ML directamente desde el sistema, con precio y cantidad específicos para ML.</span></li>
                <li className="flex gap-2"><span className="text-[#1a7fe8] font-bold mt-0.5">→</span> <span><strong>Importar órdenes:</strong> Convierte una venta de ML en una venta registrada en el POS para mantener el historial unificado.</span></li>
                <li className="flex gap-2"><span className="text-[#1a7fe8] font-bold mt-0.5">→</span> <span><strong>Sincronizar stock:</strong> Actualiza la cantidad disponible de cualquier publicación directamente desde la lista de publicaciones.</span></li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Modal publicar */}
      {modalPublicar && (
        <ModalPublicar
          productos={productos}
          onPublicar={publicar}
          onCerrar={() => setModalPublicar(false)}
        />
      )}

      {/* Toast */}
      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">
          {aviso}
        </div>
      )}
    </div>
  );
}
