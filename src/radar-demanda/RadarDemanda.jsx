import React, { useCallback, useEffect, useState } from "react";
import { BarChart3, ClipboardList, Plus, RadioTower, RefreshCw, UserRoundCheck } from "lucide-react";
import { sinSucursalElegida } from "../api";
import RegistrarDemanda from "./RegistrarDemanda";
import MisDemandas from "./MisDemandas";
import SeguimientosDemanda from "./SeguimientosDemanda";
import DetalleDemanda from "./DetalleDemanda";
import AnalisisDemanda from "./AnalisisDemanda";
import { cargarCatalogosRadar, cargarMetaRadar, listarDemandas, mensajeErrorRadar } from "./radarDemandaApi";

const vistas = [
  ["registrar", "Registrar demanda", Plus], ["demandas", "Mis demandas", ClipboardList], ["seguimientos", "Seguimientos pendientes", UserRoundCheck],
  ["analisis", "Análisis", BarChart3],
];

export default function RadarDemanda({ permisos = [] }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const puedeVer = puede("ver_radar_demanda");
  const puedeRegistrar = puede("registrar_demanda");
  const puedeAnalizar = puede("ver_resumen_demanda");
  const [vista, setVista] = useState(puedeRegistrar ? "registrar" : puedeVer ? "demandas" : "analisis");
  const [demandas, setDemandas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [meta, setMeta] = useState(null);
  const [demandaAbierta, setDemandaAbierta] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    if (!puedeVer && !puedeRegistrar) { setCargando(false); return; }
    try {
      const [catalogos, metadata] = await Promise.all([cargarCatalogosRadar(), puedeVer ? cargarMetaRadar() : Promise.resolve(null)]);
      setProductos(catalogos.productos); setClientes(catalogos.clientes);
      setMeta(metadata);
      if (puedeVer) setDemandas(await listarDemandas());
    } catch (e) { setError(mensajeErrorRadar(e, "ver")); }
    finally { setCargando(false); }
  }, [puedeVer, puedeRegistrar]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!puedeVer && !puedeRegistrar && !puedeAnalizar) return <main className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><RadioTower className="mx-auto mb-3 text-slate-300" size={36} /><h1 className="text-xl font-bold text-slate-800">Acceso restringido</h1><p className="mt-2 text-sm text-slate-500">Tu rol no tiene permiso para usar Radar de Demanda.</p></div></main>;

  if (demandaAbierta) return <main className="min-h-full bg-slate-50 px-3 py-5 sm:px-6 sm:py-7"><div className="mx-auto max-w-6xl"><DetalleDemanda id={demandaAbierta} clientes={clientes} meta={meta} permisos={permisos || []} onVolver={() => setDemandaAbierta(null)} onActualizada={cargar} /></div></main>;

  return <main className="min-h-full bg-slate-50 px-3 py-5 sm:px-6 sm:py-7">
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-1 flex items-center gap-2 text-blue-700"><RadioTower size={26} /><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Radar de Demanda</h1></div><p className="max-w-xl text-sm text-slate-600">Registra lo que tus clientes están buscando y hoy no pudimos venderles.</p></div>{puedeRegistrar && vista !== "registrar" && <button onClick={() => setVista("registrar")} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-bold text-white hover:bg-blue-700"><Plus size={18} /> Registrar demanda</button>}</div>
      <nav className="mb-5 flex flex-wrap gap-2 pb-1" aria-label="Secciones de Radar">{vistas.filter(([id]) => id === "registrar" ? puedeRegistrar : id === "analisis" ? puedeAnalizar : puedeVer).map(([id, etiqueta, Icono]) => <button key={id} onClick={() => setVista(id)} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${vista === id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}><Icono size={17} />{etiqueta}</button>)}{vista !== "analisis" && <button onClick={cargar} disabled={cargando} title="Actualizar" className="ml-auto flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-blue-700"><RefreshCw size={17} className={cargando ? "animate-spin" : ""} /></button>}</nav>
      {vista === "registrar" && <RegistrarDemanda productos={productos} clientes={clientes} puedeRegistrar={puedeRegistrar} sinSucursal={sinSucursalElegida()} onRegistrada={cargar} />}
      {vista === "demandas" && <MisDemandas demandas={demandas} clientes={clientes} meta={meta} cargando={cargando} error={error} onVer={setDemandaAbierta} />}
      {vista === "seguimientos" && <SeguimientosDemanda demandas={demandas} clientes={clientes} cargando={cargando} error={error} onVer={setDemandaAbierta} />}
      {vista === "analisis" && <AnalisisDemanda />}
    </div>
  </main>;
}
