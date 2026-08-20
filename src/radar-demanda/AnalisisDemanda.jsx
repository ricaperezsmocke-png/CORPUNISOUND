import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BarChart3, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { haceDiasLocal, hoyLocal } from "../fechas";
import { sucursalActiva } from "../api";
import { cargarSucursalesRadar, consultarAnalisisDemanda, mensajeErrorRadar, MOTIVOS } from "./radarDemandaApi";

const ETIQUETAS_MOTIVO = Object.fromEntries(MOTIVOS);
const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const numero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function rangoPreset(preset) {
  const fin = hoyLocal();
  if (preset === "hoy") return { fecha_inicio: fin, fecha_fin: fin };
  const dias = Number(preset);
  return { fecha_inicio: haceDiasLocal(dias - 1), fecha_fin: fin };
}

function Tarjeta({ etiqueta, valor, detalle }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</p><p className="mt-2 break-words text-2xl font-extrabold text-slate-900">{valor}</p>{detalle && <p className="mt-1 text-xs text-slate-500">{detalle}</p>}</div>;
}

function Tabla({ titulo, columnas, filas, vacio }) {
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm"><h2 className="border-b border-slate-100 px-4 py-3 font-bold text-slate-800">{titulo}</h2><div className="overflow-x-auto">{filas.length ? <table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{columnas.map((c) => <th key={c.clave} className="px-4 py-3">{c.titulo}</th>)}</tr></thead><tbody>{filas.map((fila, i) => <tr key={fila.producto + fila.sucursal + i} className="border-t border-slate-100">{columnas.map((c) => <td key={c.clave} className="px-4 py-3 text-slate-700">{c.render ? c.render(fila[c.clave], fila) : fila[c.clave]}</td>)}</tr>)}</tbody></table> : <p className="px-4 py-10 text-center text-sm text-slate-500">{vacio}</p>}</div></section>;
}

export default function AnalisisDemanda() {
  const [preset, setPreset] = useState("30");
  const [fechas, setFechas] = useState(rangoPreset("30"));
  const [sucursal, setSucursal] = useState(sucursalActiva());
  const [sucursales, setSucursales] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setDatos(await consultarAnalisisDemanda({ ...fechas, sucursal_id: sucursal })); }
    catch (e) { setError(mensajeErrorRadar(e, "ver")); }
    finally { setCargando(false); }
  }, [fechas, sucursal]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarSucursalesRadar().then(setSucursales).catch(() => setSucursales([])); }, []);

  function elegirPreset(valor) {
    setPreset(valor);
    if (valor !== "personalizado") setFechas(rangoPreset(valor));
  }

  const r = datos?.resumen;
  const columnasProductos = [
    { clave: "producto", titulo: "Producto" }, { clave: "sku", titulo: "SKU" },
    { clave: "solicitudes", titulo: "Solicitudes" }, { clave: "cantidad_solicitada", titulo: "Cantidad" },
    { clave: "contactos_identificados", titulo: "Contactos" }, { clave: "sucursales", titulo: "Sucursales" }, { clave: "convertidas", titulo: "Convertidas" }, { clave: "no_convertidas", titulo: "No convertidas" },
  ];
  const columnasNo = [
    { clave: "producto", titulo: "Producto" }, { clave: "marca", titulo: "Marca" }, { clave: "modelo", titulo: "Modelo" },
    { clave: "solicitudes", titulo: "Solicitudes" }, { clave: "cantidad_solicitada", titulo: "Cantidad" }, { clave: "sucursales", titulo: "Sucursales" }, { clave: "contactos_interesados", titulo: "Interesados" }, { clave: "ultima_solicitud", titulo: "Última solicitud" },
  ];
  const columnasSucursal = [
    { clave: "sucursal_nombre", titulo: "Sucursal" }, { clave: "demandas", titulo: "Demandas" }, { clave: "cantidad_solicitada", titulo: "Cantidad" },
    { clave: "pendientes", titulo: "Pendientes" }, { clave: "convertidas", titulo: "Convertidas" }, { clave: "no_convertidas", titulo: "No convertidas" },
    { clave: "tasa_recuperacion", titulo: "Recuperación", render: (v) => `${numero.format(v)}%` },
  ];

  return <div className="min-w-0 space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex-1"><p className="mb-2 text-xs font-bold uppercase text-slate-500">Periodo</p><div className="flex flex-wrap gap-2">{[["hoy","Hoy"],["7","7 días"],["30","30 días"],["90","90 días"],["personalizado","Personalizado"]].map(([id,label]) => <button key={id} onClick={() => elegirPreset(id)} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold ${preset === id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600"}`}>{label}</button>)}</div></div>
        {preset === "personalizado" && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">Desde<input type="date" value={fechas.fecha_inicio} onChange={(e) => setFechas({ ...fechas, fecha_inicio: e.target.value })} className="mt-1 block min-h-10 rounded-lg border px-2 text-sm" /></label><label className="text-xs text-slate-500">Hasta<input type="date" value={fechas.fecha_fin} onChange={(e) => setFechas({ ...fechas, fecha_fin: e.target.value })} className="mt-1 block min-h-10 rounded-lg border px-2 text-sm" /></label></div>}
        {sucursales.length > 1 && <label className="text-xs text-slate-500">Sucursal<select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="mt-1 block min-h-10 rounded-lg border px-3 text-sm"><option value="todas">Todas</option>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}
        <button onClick={cargar} disabled={cargando} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold text-blue-700"><RefreshCw size={16} className={cargando ? "animate-spin" : ""} />Actualizar</button>
      </div>
    </section>

    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle size={18} />{error}</div>}
    {cargando && !datos ? <div className="py-16 text-center text-sm text-slate-500">Calculando análisis…</div> : datos && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8"><Tarjeta etiqueta="Solicitudes" valor={numero.format(r.total)} /><Tarjeta etiqueta="Pendientes" valor={numero.format(r.pendientes)} /><Tarjeta etiqueta="Convertidas" valor={numero.format(r.convertidas)} /><Tarjeta etiqueta="No convertidas" valor={numero.format(r.no_convertidas)} /><Tarjeta etiqueta="Seguimientos vencidos" valor={numero.format(r.seguimientos_vencidos)} /><Tarjeta etiqueta="Conversión" valor={`${numero.format(r.tasa_conversion)}%`} /><Tarjeta etiqueta="Recuperación" valor={`${numero.format(r.tasa_recuperacion)}%`} /><Tarjeta etiqueta="Valor recuperado" valor={dinero.format(datos.recuperacion.valor_recuperado)} /></div>
      {r.total === 0 ? <div className="rounded-2xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">No hay demandas registradas en este periodo.</div> : <div className="grid min-w-0 gap-5 xl:grid-cols-2"><section className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm"><h2 className="mb-4 flex items-center gap-2 font-bold text-slate-800"><BarChart3 size={18} />Motivos de demanda</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={datos.motivos}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="motivo" tickFormatter={(v) => ETIQUETAS_MOTIVO[v] || v} fontSize={10} interval={0} angle={-20} textAnchor="end" height={70} /><YAxis allowDecimals={false} /><Tooltip labelFormatter={(v) => ETIQUETAS_MOTIVO[v] || v} /><Bar dataKey="cantidad" fill="#2563eb" radius={[6,6,0,0]} /></BarChart></ResponsiveContainer></div></section><section className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm"><h2 className="mb-4 font-bold text-slate-800">Evolución diaria</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={datos.evolucion}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="fecha" fontSize={11} /><YAxis allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="demandas" stroke="#0f766e" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div></section></div>}
      <div className="grid gap-3 md:grid-cols-2">{Object.values(datos.comparaciones).map((c) => <div key={c.dias} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2">{c.clasificacion === "crecimiento" ? <TrendingUp className="text-emerald-600" /> : <TrendingDown className="text-slate-500" />}<p className="font-bold text-slate-800">Últimos {c.dias} días</p></div><p className="mt-2 text-sm text-slate-600">{c.muestra_suficiente ? `${c.actual} solicitudes vs. ${c.anterior} anteriores · ${c.variacion_porcentual == null ? "sin base comparable" : `${c.variacion_porcentual}%`}` : "Muestra insuficiente"}</p></div>)}</div>
      <Tabla titulo="Productos más solicitados" columnas={columnasProductos} filas={datos.productos} vacio="No hay productos solicitados en este periodo." />
      <Tabla titulo="Productos que no manejamos" columnas={columnasNo} filas={datos.productos_no_manejados} vacio="No hay solicitudes clasificadas como productos no manejados." />
      <Tabla titulo="Demanda por sucursal" columnas={columnasSucursal} filas={datos.sucursales} vacio="No hay demanda por sucursal en este periodo." />
    </>}
  </div>;
}
