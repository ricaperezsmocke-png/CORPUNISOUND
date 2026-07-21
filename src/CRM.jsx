import React, { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "./api";

const ESTADOS = [
  { id: "contactado",    label: "Contactado",  color: "#94a3b8" },
  { id: "interesado",    label: "Interesado",  color: "#3b82f6" },
  { id: "visito_tienda", label: "En tienda",   color: "#1d4ed8" },
  { id: "compro",        label: "Compró",      color: "#1e40af" },
  { id: "perdido",       label: "Perdido",     color: "#cbd5e1" },
];
const EST = Object.fromEntries(ESTADOS.map((e) => [e.id, { l: e.label, c: e.color }]));
const SEG = {
  activo:    { l: "Activo",    c: "#2563eb" },
  en_riesgo: { l: "En riesgo", c: "#f59e0b" },
  inactivo:  { l: "Inactivo",  c: "#94a3b8" },
};

const T = {
  bg: "#f8fafc", surface: "#ffffff", card: "#ffffff", border: "#e2e8f0",
  blue: "#2563eb", blueDark: "#1d4ed8", blueLight: "#eff6ff",
  text: "#0f172a", sub: "#64748b", muted: "#94a3b8", red: "#ef4444",
};

const hoy = () => new Date().toISOString().split("T")[0];
const dDe = (f) => (f ? Math.floor((new Date() - new Date(f)) / 864e5) : 999);
const $ = (n) => "$" + Number(n || 0).toLocaleString("es-MX");
const ini = (n) => n.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();
const ACOLS = ["#1d4ed8", "#2563eb", "#1e40af", "#3b82f6", "#1e3a8a", "#2563eb"];
const acol = (n) => { let h = 0; for (const c of n) h += c.charCodeAt(0); return ACOLS[h % ACOLS.length]; };

// ---------- Sugerencias de campaña por palabra clave (no requiere IA externa) ----------
const REGLAS = [
  { w: ["guitarra", "cuerdas", "bajo", "fender", "gibson", "capo"],
    sg: (n, p, s) => `${n} es guitarrista. Ofrécele cuerdas Elixir, afinador o funda. Contactar esta semana en ${s}.`,
    wa: (n, p, s) => `🎸 Hola ${n}!\n\nSolo HOY 10% en accesorios para guitarristas en Unisound Imusa ${s}.\n\nTienes ${p} y queremos premiarte.\n\n⏰ Solo hoy · 📍 ${s}\n\n— Unisound Imusa`,
    ml: (n, p, s) => `Asunto: Oferta exclusiva para ti, ${n} 🎸\n\nHola ${n},\n\nComo guitarrista (${p}), hoy en ${s}:\n· 10% en cuerdas y accesorios\n· Asesoría gratis\n· Solo hoy\n\nEquipo Unisound Imusa` },
  { w: ["teclado", "piano", "yamaha", "casio", "korg", "roland"],
    sg: (n, p, s) => `${n} invierte en teclados. Recomiéndale soporte, pedal sustain o funda en ${s}.`,
    wa: (n, p, s) => `🎹 Hola ${n}!\n\nAccesorios con 10% OFF esta semana en Unisound ${s}.\nTu ${p} merece lo mejor.\n\n⏰ Esta semana · 📍 ${s}\n\n— Unisound Imusa`,
    ml: (n, p, s) => `Asunto: Accesorios para tu teclado, ${n}\n\nHola ${n},\n\nEsta semana en ${s}:\n· 10% en soportes y pedales\n\nEquipo Unisound Imusa` },
  { w: ["batería", "baquetas", "bombo", "platillo", "parche"],
    sg: (n, p, s) => `${n} es baterista. Ofrécele baquetas Vic Firth o parches Remo en ${s}.`,
    wa: (n, p, s) => `🥁 Hola ${n}!\n\nParches y baquetas con descuento HOY en Unisound ${s}.\n\n⏰ Solo hoy · 📍 ${s}\n\n— Unisound Imusa`,
    ml: (n, p, s) => `Asunto: Ofertas para bateristas, ${n}\n\nHola ${n},\n\nDescuentos en parches y baquetas en ${s}.\n\nEquipo Unisound Imusa` },
  { w: ["micrófono", "mic", "bocina", "amplificador", "mixer", "audio", "sonido"],
    sg: (n, p, s) => `${n} invierte en audio. Ofrécele cables XLR o interfaz USB. Venta cruzada ideal en ${s}.`,
    wa: (n, p, s) => `🎤 Hola ${n}!\n\nEquipo de audio 10% OFF hoy en Unisound ${s}.\n\n⏰ Solo hoy · 📍 ${s}\n\n— Unisound Imusa`,
    ml: (n, p, s) => `Asunto: Equipo de audio para ti, ${n}\n\nHola ${n},\n\n10% en equipo de audio esta semana en ${s}.\n\nEquipo Unisound Imusa` },
];
const RDEF = {
  sg: (n, p, s) => `${n} es cliente de Unisound. Invítalo a ${s} con una promo personalizada esta semana.`,
  wa: (n, p, s) => `🎵 Hola ${n}!\n\nNovedades esta semana en Unisound Imusa ${s}.\n${p ? `Recordamos tu compra de ${p}.` : ""}\n\n⏰ Esta semana · 📍 ${s}\n\n— Unisound Imusa`,
  ml: (n, p, s) => `Asunto: Oferta especial para ti, ${n}\n\nHola ${n},\n\nEn ${s} tenemos promociones exclusivas para ti.\n· 10% en tu próxima compra\n\nEquipo Unisound Imusa`,
};
function getIA(c, nombreSucursal) {
  const str = (c.compras || []).map((x) => x.producto).join(", ");
  const r = REGLAS.find((x) => x.w.some((p) => str.toLowerCase().includes(p))) || RDEF;
  const s = nombreSucursal || "tu sucursal";
  return { sg: r.sg(c.nombre, str || "varios", s), wa: r.wa(c.nombre, str || "productos", s), ml: r.ml(c.nombre, str || "productos", s) };
}

// ---------- Piezas de UI ----------
const inp = { width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "9px 11px", color: "#0f172a", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

function Tag({ color, children }) {
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: color + "18", color, fontWeight: 600, letterSpacing: ".3px", border: `1px solid ${color}30` }}>{children}</span>;
}
function Bar({ score }) {
  const c = score >= 70 ? T.blue : score >= 40 ? "#60a5fa" : T.muted;
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ flex: 1, height: 3, background: T.border, borderRadius: 2 }}>
      <div style={{ height: "100%", width: score + "%", background: c, borderRadius: 2, transition: "width .4s" }} />
    </div>
    <span style={{ fontSize: 10, color: c, fontWeight: 600, minWidth: 20 }}>{score}</span>
  </div>;
}
function Avatar({ nombre, size = 32 }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", background: acol(nombre), display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color: "#fff", flexShrink: 0, letterSpacing: "-.5px" }}>{ini(nombre)}</div>;
}
function Pill({ active, color, onClick, children }) {
  return <button onClick={onClick} style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${active ? color : T.border}`, background: active ? color + "12" : "transparent", color: active ? color : T.sub, fontSize: 10, cursor: "pointer", fontWeight: 600, transition: "all .15s" }}>{children}</button>;
}
function Btn({ onClick, v = "blue", sm, full, children }) {
  const vs = {
    blue: { background: T.blue, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: T.sub, border: `1px solid ${T.border}` },
    light: { background: T.blueLight, color: T.blue, border: "none" },
  };
  return <button onClick={onClick} style={{ ...vs[v], borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: sm ? 11 : 13, padding: sm ? "5px 11px" : "9px 16px", display: "inline-flex", alignItems: "center", gap: 5, width: full ? "100%" : undefined, justifyContent: full ? "center" : undefined }}>{children}</button>;
}
function Modal({ onClose, children, wide }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16, backdropFilter: "blur(2px)" }} onClick={onClose}>
    <div style={{ background: T.surface, borderRadius: 12, padding: 24, width: "100%", maxWidth: wide ? 560 : 440, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.15)", border: `1px solid ${T.border}` }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>;
}
function Sec({ title, action, children }) {
  return <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
    <div style={{ padding: "11px 15px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: T.sub, textTransform: "uppercase", letterSpacing: ".8px" }}>{title}</span>
      {action}
    </div>
    {children}
  </div>;
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function CRM({ onVolver, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  const [clientes, setClientes] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [selId, setSelId] = useState(null);
  const [tab, setTab] = useState("hoy");
  const [campType, setCampType] = useState(null);
  const [search, setSearch] = useState("");
  const [fSuc, setFSuc] = useState("Todas");
  const [fEst, setFEst] = useState("Todos");
  const [modal, setModal] = useState(null);
  const [fmC, setFmC] = useState({ nombre: "", telefono: "", email: "", ubicacion: "", sucursal_id: "", vendedor_asignado_id: "" });
  const [mFiltro, setMFiltro] = useState({ sucursal: "Todas", estado: "Todos" });
  const [mType, setMType] = useState("whatsapp");
  const [resumenSuc, setResumenSuc] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [postventaPendientes, setPostventaPendientes] = useState([]);
  const [apartadosPorVencer, setApartadosPorVencer] = useState([]);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };
  const [aviso, setAviso] = useState(null);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rCli, rSuc, rVen, rPost, rApart] = await Promise.all([
        apiFetch("/crm/clientes"), apiFetch("/sucursales"), apiFetch("/vendedores"), apiFetch("/crm/postventa-pendientes"), apiFetch("/crm/apartados-por-vencer"),
      ]);
      if (!rCli.ok) throw new Error("No se pudo cargar el CRM");
      setClientes(await rCli.json());
      setSucursales(rSuc.ok ? await rSuc.json() : []);
      setVendedores(rVen.ok ? await rVen.json() : []);
      setPostventaPendientes(rPost.ok ? await rPost.json() : []);
      setApartadosPorVencer(rApart.ok ? await rApart.json() : []);
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene acceso al CRM.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  useEffect(() => {
    if (tab !== "dashboard") return;
    apiFetch("/crm/resumen-sucursales").then((r) => r.ok && r.json()).then((d) => d && setResumenSuc(d));
    apiFetch("/crm/ranking-vendedores").then((r) => r.ok && r.json()).then((d) => d && setRanking(d));
  }, [tab]);

  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || "—";
  const nombreVendedor = (id) => vendedores.find((v) => v.id === id)?.nombre || "—";

  const rich = useMemo(() => clientes.map((c) => ({ ...c, sc: c.score, sg: c.segmento, al: c.alertas || [] })), [clientes]);
  const sel = rich.find((c) => c.id === selId) || null;
  const filtered = useMemo(() => rich.filter((c) => {
    const q = search.toLowerCase();
    return (fSuc === "Todas" || nombreSucursal(c.sucursal_id) === fSuc) &&
      (fEst === "Todos" || c.estado === fEst) &&
      (c.nombre.toLowerCase().includes(q) || (c.email || "").includes(q));
  }), [rich, search, fSuc, fEst, sucursales]);

  const alerts = useMemo(() => rich.filter((c) => c.al.length > 0), [rich]);
  const urgentes = useMemo(() => [...alerts].sort((a, b) => b.sc - a.sc), [alerts]);
  const totalV = rich.reduce((a, c) => a + (c.compras || []).reduce((b, p) => b + p.monto, 0), 0);
  const compraron = rich.filter((c) => c.estado === "compro").length;
  const tasa = rich.length ? Math.round((compraron / rich.length) * 100) : 0;

  const cambiarEstado = async (id, estado) => {
    setClientes((cs) => cs.map((c) => (c.id === id ? { ...c, estado, ultimo_contacto: hoy() } : c)));
    try {
      const r = await apiFetch(`/crm/clientes/${id}/estado`, { method: "PUT", body: JSON.stringify({ estado }) });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (e) { mostrarAviso("❌ " + e.message); cargarTodo(); }
  };

  const registrarContacto = async (id, tipo, resultado) => {
    setClientes((cs) => cs.map((c) => (c.id === id ? { ...c, ultimo_contacto: hoy() } : c)));
    try {
      const r = await apiFetch(`/crm/clientes/${id}/contactos`, { method: "POST", body: JSON.stringify({ tipo, resultado }) });
      if (!r.ok) throw new Error((await r.json()).error);
      mostrarAviso("Contacto registrado");
    } catch (e) { mostrarAviso("❌ " + e.message); cargarTodo(); }
  };

  const registrarPostventa = async (item, resultado) => {
    try {
      const r = await apiFetch(`/crm/clientes/${item.cliente_id}/contactos`, {
        method: "POST",
        body: JSON.stringify({ tipo: "postventa", resultado, venta_id: item.venta_id }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setPostventaPendientes((prev) => prev.filter((p) => p.venta_id !== item.venta_id));
      mostrarAviso(resultado === "positivo" ? "Registrado como positivo 👍" : resultado === "negativo" ? "Registrado como negativo — dale seguimiento" : "Registrado como sin respuesta");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const mensajePostventa = (item) => {
    const productos = item.productos.length ? item.productos.join(", ") : "tu compra";
    return `Hola ${item.cliente_nombre}! 👋\n\nHace unos días compraste ${productos} en Unisound Imusa.\n\n¿Cómo te ha ido con tu producto? Nos encantaría saber tu opinión.\n\n— Unisound Imusa`;
  };

  const registrarApartadoPorVencer = async (item) => {
    try {
      const r = await apiFetch(`/crm/clientes/${item.cliente_id}/contactos`, {
        method: "POST",
        body: JSON.stringify({ tipo: "apartado_por_vencer", venta_id: item.venta_id }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setApartadosPorVencer((prev) => prev.filter((p) => p.venta_id !== item.venta_id));
      mostrarAviso("Contacto registrado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const mensajeApartado = (item) => {
    return `Hola ${item.cliente_nombre}! 👋\n\nTu apartado #${item.venta_id} en Unisound Imusa está por vencer en ${item.dias_restantes} día(s) — te queda un saldo pendiente de $${item.saldo_pendiente.toFixed(2)}.\n\n¡Te esperamos para completarlo y llevarte tu producto!\n\n— Unisound Imusa`;
  };

  const guardarCliente = async () => {
    if (!fmC.nombre.trim() || !fmC.telefono.trim()) return mostrarAviso("Nombre y teléfono son obligatorios");
    try {
      const r = await apiFetch("/clientes", { method: "POST", body: JSON.stringify(fmC) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setModal(null);
      setFmC({ nombre: "", telefono: "", email: "", ubicacion: "", sucursal_id: "", vendedor_asignado_id: "" });
      await cargarTodo();
      setSelId(nuevo.id);
      mostrarAviso("Cliente agregado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const mClientes = useMemo(() => rich.filter((c) =>
    (mFiltro.sucursal === "Todas" || nombreSucursal(c.sucursal_id) === mFiltro.sucursal) &&
    (mFiltro.estado === "Todos" || c.estado === mFiltro.estado) && c.estado !== "perdido"
  ), [rich, mFiltro, sucursales]);

  const maxV = Math.max(...resumenSuc.map((x) => x.ventas), 1);

  const ia = sel && (sel.compras || []).length > 0 ? getIA(sel, nombreSucursal(sel.sucursal_id)) : sel ? getIA(sel, nombreSucursal(sel.sucursal_id)) : null;
  const campMsg = ia && campType ? (campType === "whatsapp" ? ia.wa : ia.ml) : "";
  const waL = sel ? `https://wa.me/52${(sel.telefono || "").replace(/\D/g, "")}?text=${encodeURIComponent(campMsg)}` : "#";
  const mlL = sel ? `mailto:${sel.email}?body=${encodeURIComponent(campMsg)}` : "#";

  if (cargando) return <div style={{ padding: 40, textAlign: "center", color: T.muted }}>Cargando CRM...</div>;

  return (
    <div style={{ minHeight: "100%", background: T.bg, color: T.text, fontFamily: "'Inter',-apple-system,sans-serif", fontSize: 13 }}>
      {/* HEADER */}
      <div style={{ background: T.blue, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🎸</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "-.3px" }}>Unisound Imusa</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,.65)", textTransform: "uppercase", letterSpacing: "1px" }}>CRM Comercial</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {[["hoy", "Hoy"], ["clientes", "Clientes"], ["dashboard", "Dashboard"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: tab === id ? "rgba(255,255,255,.2)" : "transparent", color: "#fff" }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {apartadosPorVencer.length > 0 && <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: "rgba(255,255,255,.2)", color: "#fff", fontWeight: 600 }}>⏰ {apartadosPorVencer.length} apartados</span>}
          {postventaPendientes.length > 0 && <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: "rgba(255,255,255,.2)", color: "#fff", fontWeight: 600 }}>📦 {postventaPendientes.length} postventa</span>}
          {alerts.length > 0 && <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: "rgba(255,255,255,.2)", color: "#fff", fontWeight: 600 }}>{alerts.length} alertas</span>}
          {puede("enviar_campana_masiva") && (
            <button onClick={() => setModal("masiva")} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Campaña masiva</button>
          )}
          {onVolver && (
            <button onClick={onVolver} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "rgba(0,0,0,.2)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>← Inicio</button>
          )}
        </div>
      </div>

      {error && <div style={{ background: "#fef2f2", color: "#b91c1c", fontSize: 12, padding: "8px 24px", borderBottom: "1px solid #fecaca" }}>{error}</div>}

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px", boxSizing: "border-box" }}>
        {/* STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 18 }}>
          {[{ l: "Clientes", v: rich.length }, { l: "Ventas", v: $(totalV) }, { l: "Conversión", v: tasa + "%" }, { l: "Alertas", v: alerts.length }, { l: "Compras", v: rich.reduce((a, c) => a + (c.compras || []).length, 0) }].map((x, i) => (
            <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
              <div style={{ fontSize: 10, color: T.sub, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4, fontWeight: 600 }}>{x.l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: i === 3 && alerts.length > 0 ? T.red : T.blue }}>{x.v}</div>
            </div>
          ))}
        </div>

        {/* TAB HOY */}
        {tab === "hoy" && <div>
          {apartadosPorVencer.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#b45309", fontWeight: 600, marginBottom: 8 }}>⏰ Apartados por vencer · {apartadosPorVencer.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {apartadosPorVencer.map((item) => {
                  const mensaje = mensajeApartado(item);
                  const link = `https://wa.me/52${(item.telefono || "").replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`;
                  return (
                    <div key={item.venta_id} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Avatar nombre={item.cliente_nombre} size={28} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.cliente_nombre}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>Apartado #{item.venta_id} · saldo ${item.saldo_pendiente.toFixed(2)} · vence en {item.dias_restantes} día(s)</div>
                      </div>
                      <a href={link} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", borderRadius: 6, background: T.blue, color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Enviar</a>
                      <button onClick={() => registrarApartadoPorVencer(item)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", color: "#15803d", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓ Ya contacté</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {postventaPendientes.length > 0 && puede("registrar_contacto_cliente") && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#b45309", fontWeight: 600, marginBottom: 8 }}>📦 Seguimiento postventa pendiente · {postventaPendientes.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {postventaPendientes.map((item) => {
                  const mensaje = mensajePostventa(item);
                  const link = `https://wa.me/52${(item.telefono || "").replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`;
                  return (
                    <div key={item.venta_id} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Avatar nombre={item.cliente_nombre} size={28} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.cliente_nombre}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>{item.productos.join(", ") || "Compra"} · hace {item.dias_transcurridos} días</div>
                      </div>
                      <a href={link} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", borderRadius: 6, background: T.blue, color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Enviar</a>
                      <button onClick={() => registrarPostventa(item, "positivo")} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", color: "#15803d", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>👍 Positivo</button>
                      <button onClick={() => registrarPostventa(item, "negativo")} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>👎 Negativo</button>
                      <button onClick={() => registrarPostventa(item, "sin_respuesta")} style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, fontSize: 11, cursor: "pointer" }}>Sin respuesta</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {alerts.length > 0 && <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.blue, fontWeight: 600, marginBottom: 8 }}>⚡ Requieren atención hoy</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {alerts.slice(0, 6).map((c) => <button key={c.id} onClick={() => { setSelId(c.id); setTab("clientes"); }} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", color: T.text, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>{c.nombre}</button>)}
            </div>
          </div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start" }}>
            <Sec title={`Contactar hoy · ${urgentes.length}`}>
              {urgentes.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: T.muted, fontSize: 13 }}>¡Todo al día! Sin pendientes.</div> :
                urgentes.slice(0, 8).map((c) => {
                  const e = EST[c.estado] || EST.contactado;
                  return <div key={c.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: selId === c.id ? T.blueLight : "transparent", display: "flex", alignItems: "center", gap: 12 }} onClick={() => { setSelId(c.id); setTab("clientes"); }}>
                    <Avatar nombre={c.nombre} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{c.nombre}</div>
                      <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>{nombreSucursal(c.sucursal_id)} · {nombreVendedor(c.vendedor_asignado_id)}</div>
                      <Bar score={c.sc} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <Tag color={e.c}>{e.l}</Tag>
                      <span style={{ fontSize: 10, color: T.sub }}>{dDe(c.ultimo_contacto)}d sin contacto</span>
                    </div>
                  </div>;
                })}
            </Sec>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 180 }}>
              {ESTADOS.map((e) => {
                const cnt = rich.filter((c) => c.estado === e.id).length;
                return <div key={e.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", cursor: "pointer" }} onClick={() => { setFEst(e.id); setTab("clientes"); }}>
                  <div style={{ fontSize: 10, color: e.color, fontWeight: 600, marginBottom: 2, textTransform: "uppercase", letterSpacing: ".5px" }}>{e.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: T.text }}>{cnt}</div>
                </div>;
              })}
            </div>
          </div>
        </div>}

        {/* TAB CLIENTES */}
        {tab === "clientes" && <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14, alignItems: "start" }}>
          <Sec title={`Clientes · ${filtered.length}`} action={<div style={{ display: "flex", gap: 7 }}>
            <input placeholder="Buscar..." style={{ ...inp, width: 160, padding: "5px 10px", fontSize: 12 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            {puede("crear_cliente") && <Btn sm v="blue" onClick={() => setModal("cliente")}>+ Nuevo</Btn>}
          </div>}>
            <div style={{ display: "flex", gap: 5, padding: "8px 16px", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
              {["Todas", ...sucursales.map((s) => s.nombre)].map((s) => <Pill key={s} active={fSuc === s} color={T.blue} onClick={() => setFSuc(s)}>{s}</Pill>)}
            </div>
            <div style={{ display: "flex", gap: 5, padding: "7px 16px", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
              {[{ id: "Todos", label: "Todos", color: T.sub }, ...ESTADOS].map((e) => <Pill key={e.id} active={fEst === e.id} color={e.color} onClick={() => setFEst(e.id)}>{e.label}</Pill>)}
            </div>
            <div style={{ maxHeight: 520, overflowY: "auto" }}>
              {filtered.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: T.muted }}>Sin resultados</div> :
                filtered.map((c) => {
                  const e = EST[c.estado] || EST.contactado;
                  const sg = SEG[c.sg] || SEG.inactivo;
                  const isSel = selId === c.id;
                  return <div key={c.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: isSel ? T.blueLight : "transparent", borderLeft: isSel ? `3px solid ${T.blue}` : "3px solid transparent", display: "flex", alignItems: "center", gap: 12 }} onClick={() => { setSelId(c.id); setCampType(null); }}>
                    <div style={{ position: "relative" }}>
                      <Avatar nombre={c.nombre} />
                      {c.al.length > 0 && <div style={{ position: "absolute", top: -1, right: -1, width: 8, height: 8, borderRadius: "50%", background: T.red, border: "2px solid #fff" }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, marginBottom: 1 }}>{c.nombre}</div>
                      <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>{nombreSucursal(c.sucursal_id)} · {nombreVendedor(c.vendedor_asignado_id)}</div>
                      <Bar score={c.sc} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <Tag color={e.c}>{e.l}</Tag>
                      <Tag color={sg.c}>{sg.l}</Tag>
                    </div>
                  </div>;
                })}
            </div>
          </Sec>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!sel ? <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "48px 16px", textAlign: "center" }}><div style={{ fontSize: 20, marginBottom: 8 }}>←</div><div style={{ color: T.muted, fontSize: 13 }}>Selecciona un cliente</div></div> :
              <DetalleCli sel={sel} ia={ia} campType={campType} setCampType={setCampType} campMsg={campMsg} waL={waL} mlL={mlL}
                onEst={cambiarEstado} onInter={registrarContacto} nombreSucursal={nombreSucursal} nombreVendedor={nombreVendedor}
                puede={puede} T={T} />}
          </div>
        </div>}

        {/* TAB DASHBOARD */}
        {tab === "dashboard" && <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[{ l: "Tasa de Conversión", v: tasa + "%" }, { l: "Ticket Promedio", v: $(compraron ? Math.round(totalV / compraron) : 0) }, { l: "En Pipeline", v: rich.filter((c) => c.estado !== "perdido").length }, { l: "En Riesgo", v: rich.filter((c) => c.sg === "en_riesgo").length }].map((x, i) => (
              <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16, borderTop: `3px solid ${T.blue}` }}>
                <div style={{ fontSize: 10, color: T.sub, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4, fontWeight: 600 }}>{x.l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: T.blue }}>{x.v}</div>
              </div>
            ))}
          </div>
          <Sec title="Rendimiento por sucursal">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 16px", borderBottom: `1px solid ${T.border}` }}>
              {["Sucursal", "Clientes", "Ventas", "Conv."].map((h) => <span key={h} style={{ fontSize: 10, color: T.sub, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".8px" }}>{h}</span>)}
            </div>
            {resumenSuc.map((x) => <div key={x.sucursal_id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "12px 16px", borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{x.nombre}</div>
                <div style={{ height: 3, background: T.border, borderRadius: 2 }}><div style={{ height: "100%", width: Math.round((x.ventas / maxV) * 100) + "%", background: T.blue, borderRadius: 2 }} /></div>
              </div>
              <span style={{ color: T.blue, fontWeight: 600 }}>{x.clientes}</span>
              <span style={{ fontWeight: 600 }}>{$(x.ventas)}</span>
              <span style={{ color: T.blue, fontWeight: 600 }}>{x.convertidos}</span>
            </div>)}
          </Sec>
          <Sec title="Ranking de vendedores">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 16px", borderBottom: `1px solid ${T.border}` }}>
              {["Vendedor", "Clientes", "Ventas", "Conv."].map((h) => <span key={h} style={{ fontSize: 10, color: T.sub, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".8px" }}>{h}</span>)}
            </div>
            {ranking.map((x, i) => <div key={x.vendedor_id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "12px 16px", borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>{["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i] || "•"}</span><span style={{ fontWeight: 600 }}>{x.nombre}</span></div>
              <span style={{ color: T.sub }}>{x.clientes}</span>
              <span style={{ fontWeight: 600 }}>{$(x.ventas)}</span>
              <span style={{ color: T.blue, fontWeight: 600 }}>{x.convertidos}</span>
            </div>)}
          </Sec>
        </div>}
      </div>

      {aviso && <div className="animate-toast-in" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#0f172a", color: "#fff", fontSize: 13, padding: "10px 18px", borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,.2)", zIndex: 300 }}>{aviso}</div>}

      {modal === "cliente" && <Modal onClose={() => setModal(null)}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Nuevo cliente</div>
        {[{ l: "Nombre *", k: "nombre", t: "text" }, { l: "Teléfono *", k: "telefono", t: "tel" }, { l: "Correo", k: "email", t: "email" }, { l: "Ubicación", k: "ubicacion", t: "text" }].map((f) => (
          <div key={f.k} style={{ marginBottom: 11 }}><label style={{ fontSize: 11, color: T.sub, fontWeight: 600, marginBottom: 4, display: "block" }}>{f.l}</label><input type={f.t} style={inp} value={fmC[f.k]} onChange={(e) => setFmC({ ...fmC, [f.k]: e.target.value })} /></div>
        ))}
        <div style={{ marginBottom: 11 }}>
          <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, marginBottom: 4, display: "block" }}>Sucursal</label>
          <select style={inp} value={fmC.sucursal_id} onChange={(e) => setFmC({ ...fmC, sucursal_id: e.target.value })}>
            <option value="">Selecciona...</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 11 }}>
          <label style={{ fontSize: 11, color: T.sub, fontWeight: 600, marginBottom: 4, display: "block" }}>Vendedor asignado</label>
          <select style={inp} value={fmC.vendedor_asignado_id} onChange={(e) => setFmC({ ...fmC, vendedor_asignado_id: e.target.value })}>
            <option value="">Selecciona...</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}><Btn full v="blue" onClick={guardarCliente}>Guardar cliente</Btn><Btn full v="ghost" onClick={() => setModal(null)}>Cancelar</Btn></div>
      </Modal>}

      {modal === "masiva" && <Modal onClose={() => setModal(null)} wide>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Campaña masiva</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div><label style={{ fontSize: 11, color: T.sub, fontWeight: 600, marginBottom: 4, display: "block" }}>Sucursal</label>
            <select style={inp} value={mFiltro.sucursal} onChange={(e) => setMFiltro({ ...mFiltro, sucursal: e.target.value })}>
              {["Todas", ...sucursales.map((s) => s.nombre)].map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div><label style={{ fontSize: 11, color: T.sub, fontWeight: 600, marginBottom: 4, display: "block" }}>Estado</label>
            <select style={inp} value={mFiltro.estado} onChange={(e) => setMFiltro({ ...mFiltro, estado: e.target.value })}>
              {["Todos", ...ESTADOS.map((e) => e.id)].map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[["whatsapp", "WhatsApp"], ["correo", "Correo"]].map(([t, l]) => (
            <button key={t} onClick={() => setMType(t)} style={{ flex: 1, padding: 8, borderRadius: 6, border: `1px solid ${mType === t ? T.blue : T.border}`, background: mType === t ? T.blueLight : "transparent", color: mType === t ? T.blue : T.sub, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 10 }}>{mClientes.length} clientes seleccionados</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
          {mClientes.map((c) => {
            const ia2 = getIA(c, nombreSucursal(c.sucursal_id));
            const msg = mType === "whatsapp" ? ia2.wa : ia2.ml;
            const lnk = mType === "whatsapp" ? `https://wa.me/52${(c.telefono || "").replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` : `mailto:${c.email}?body=${encodeURIComponent(msg)}`;
            return <div key={c.id} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar nombre={c.nombre} size={28} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{c.nombre}</div><div style={{ fontSize: 11, color: T.sub }}>{nombreSucursal(c.sucursal_id)} · {c.telefono}</div></div>
              <a href={lnk} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", borderRadius: 6, background: T.blue, color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>Enviar</a>
            </div>;
          })}
        </div>
        <div style={{ marginTop: 14 }}><Btn full v="ghost" onClick={() => setModal(null)}>Cerrar</Btn></div>
      </Modal>}
    </div>
  );
}

function DetalleCli({ sel, ia, campType, setCampType, campMsg, waL, mlL, onEst, onInter, nombreSucursal, nombreVendedor, puede, T }) {
  const e = EST[sel.estado] || EST.contactado;
  const sg = SEG[sel.sg] || SEG.inactivo;
  const total = (sel.compras || []).reduce((a, p) => a + p.monto, 0);
  const ALERTA_CFG = { sin_contacto: { l: "Sin contacto en 30+ días", c: "#f59e0b" }, pendiente: { l: "Interesado sin seguimiento", c: "#3b82f6" }, riesgo: { l: "En riesgo de perderse", c: "#ef4444" } };

  function Row({ label, value }) {
    return <div><div style={{ fontSize: 10, color: T.sub, fontWeight: 600, marginBottom: 1 }}>{label}</div><div style={{ fontSize: 12, fontWeight: 500, wordBreak: "break-all" }}>{value || "—"}</div></div>;
  }

  return <>
    {(sel.al || []).map((a) => {
      const cfg = ALERTA_CFG[a]; if (!cfg) return null;
      return <div key={a} style={{ fontSize: 11, padding: "8px 12px", borderRadius: 7, background: cfg.c + "12", border: `1px solid ${cfg.c}25`, color: cfg.c, fontWeight: 600, marginBottom: 6 }}>⚠ {cfg.l}</div>;
    })}

    <Sec title="Cliente">
      <div style={{ padding: "14px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Avatar nombre={sel.nombre} size={40} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{sel.nombre}</div>
            <div style={{ fontSize: 11, color: T.sub }}>{nombreSucursal(sel.sucursal_id)}</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.blue }}>{$(total)}</div>
            <div style={{ fontSize: 10, color: T.sub }}>total comprado (ventas reales)</div>
          </div>
        </div>
        <Bar score={sel.sc} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Row label="Teléfono" value={sel.telefono} />
          <Row label="Correo" value={sel.email} />
          <Row label="Ubicación" value={sel.ubicacion} />
          <Row label="Vendedor" value={nombreVendedor(sel.vendedor_asignado_id)} />
        </div>
      </div>
    </Sec>

    <Sec title="Pipeline · Estado">
      <div style={{ padding: "10px 15px", display: "flex", gap: 5, flexWrap: "wrap" }}>
        {ESTADOS.map((est) => (
          <button key={est.id} disabled={!puede("cambiar_estado_cliente")} onClick={() => onEst(sel.id, est.id)}
            style={{ padding: "5px 11px", borderRadius: 20, border: `1px solid ${sel.estado === est.id ? est.color : T.border}`, background: sel.estado === est.id ? est.color + "15" : "transparent", color: sel.estado === est.id ? est.color : T.sub, fontSize: 11, cursor: puede("cambiar_estado_cliente") ? "pointer" : "not-allowed", fontWeight: 600, opacity: puede("cambiar_estado_cliente") ? 1 : 0.5 }}>
            {est.label}
          </button>
        ))}
      </div>
      <div style={{ padding: "0 15px 10px", fontSize: 11, color: T.sub }}>
        Último contacto: <strong style={{ color: T.text }}>{sel.ultimo_contacto || "—"}</strong>
        {sel.ultimo_contacto && <span style={{ color: T.sub, marginLeft: 6 }}>· {dDe(sel.ultimo_contacto)} días atrás</span>}
      </div>
    </Sec>

    {puede("registrar_contacto_cliente") && (
      <Sec title="Registrar contacto">
        <div style={{ padding: "10px 15px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {[{ t: "whatsapp", l: "WhatsApp" }, { t: "llamada", l: "Llamada" }, { t: "correo", l: "Correo" }, { t: "visita", l: "Visita" }].map((x) => (
            <div key={x.t} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 10, color: T.sub, fontWeight: 600, textAlign: "center" }}>{x.l}</div>
              <button onClick={() => onInter(sel.id, x.t, "respondio")} style={{ padding: 4, borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.blue, fontSize: 10, cursor: "pointer", fontWeight: 600 }}>✓ Resp.</button>
              <button onClick={() => onInter(sel.id, x.t, "sin_respuesta")} style={{ padding: 4, borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, fontSize: 10, cursor: "pointer", fontWeight: 500 }}>✗ No resp.</button>
            </div>
          ))}
        </div>
      </Sec>
    )}

    <Sec title={`Compras (automático desde el POS) · ${(sel.compras || []).length}`}>
      {(sel.compras || []).length === 0 ? <div style={{ padding: 18, textAlign: "center", color: T.muted, fontSize: 12 }}>Sin compras registradas todavía en el Punto de Venta</div> :
        (sel.compras || []).map((p, i) => <div key={i} style={{ padding: "10px 15px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontWeight: 600, fontSize: 12 }}>{p.producto}</div><div style={{ fontSize: 10, color: T.sub }}>{p.fecha} · folio {p.venta_id}</div></div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.blue }}>{$(p.monto)}</div>
        </div>)}
    </Sec>

    {ia && <Sec title="Sugerencia de campaña">
      <div style={{ padding: 12, background: T.blueLight, margin: 15, borderRadius: 8, fontSize: 12, color: "#1e40af", lineHeight: 1.6 }}>{ia.sg}</div>
      {!campType ? <div style={{ display: "flex", gap: 8, padding: "0 15px 14px" }}>
        <button onClick={() => setCampType("whatsapp")} style={{ flex: 1, padding: 8, borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>💬 WhatsApp</button>
        <button onClick={() => setCampType("correo")} style={{ flex: 1, padding: 8, borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📧 Correo</button>
      </div> : <>
        <div style={{ margin: "0 15px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: 12, fontSize: 11, color: "#0369a1", lineHeight: 1.7, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 10 }}>{campMsg}</div>
        <div style={{ display: "flex", gap: 7, padding: "0 15px 12px", flexWrap: "wrap" }}>
          <a href={campType === "whatsapp" ? waL : mlL} target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: 8, borderRadius: 6, background: T.blue, color: "#fff", fontSize: 12, fontWeight: 600, textDecoration: "none", textAlign: "center" }}>{campType === "whatsapp" ? "Abrir en WhatsApp" : "Abrir en Correo"}</a>
          <button onClick={() => navigator.clipboard.writeText(campMsg)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, fontSize: 12, cursor: "pointer" }}>Copiar</button>
          <button onClick={() => setCampType(null)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, fontSize: 12, cursor: "pointer" }}>✕</button>
        </div>
      </>}
    </Sec>}
  </>;
}
