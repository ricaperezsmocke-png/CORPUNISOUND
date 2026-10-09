import { useEffect, useState } from "react";
import { BarChart3, CheckSquare, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { apiFetch } from "./api";
import Pestanas from "./objetivos/Pestanas";
import { hoyLocal, leer } from "./objetivos/datos";
import { TEXTO_PERIODO, etiquetaPeriodo, inicioDePeriodo, moverPeriodo } from "./metas/metas";
import MisMetas from "./metas/MisMetas";
import TableroMetas from "./metas/TableroMetas";
import AdministrarMetas from "./metas/AdministrarMetas";

const SEGMENTO = "px-3 py-1.5 text-sm rounded-lg border";
const SEGMENTO_ACTIVO = `${SEGMENTO} bg-blue-600 border-blue-600 text-white`;
const SEGMENTO_INACTIVO = `${SEGMENTO} border-slate-300 text-slate-700 bg-white`;
const FLECHA = "p-1.5 rounded-lg border border-slate-300 bg-white text-slate-700";

// Pantalla de Metas y OKRs (decisión de Victor 2026-10-09: "algo intuitivo sin ser muy rebuscado"):
// un selector de periodo y tres pestañas. Cada pestaña pide sus datos; el servidor decide qué ve cada quien.
export default function MetasOkrs({ permisos = [] }) {
  const hoy = hoyLocal();
  const usa = permisos.includes("usar_gerente_ventas");
  const esAdmin = permisos.includes("administrar_metas_personalizadas");
  const esJefatura = esAdmin || permisos.includes("anular_capturas_metas");
  const [periodo, setPeriodo] = useState("mensual");
  const [inicio, setInicio] = useState(() => inicioDePeriodo("mensual", hoy));
  const [miVendedorId, setMiVendedorId] = useState(null);
  const [identificado, setIdentificado] = useState(!usa);
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useState(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([
      usa ? apiFetch("/gerente-ventas/mi/vendedor").then((r) => leer(r, "No se pudo identificar tu vendedor")) : { vendedor_id: null },
      apiFetch("/sucursales").then((r) => leer(r, "No se pudieron cargar las tiendas")),
      esJefatura ? apiFetch("/vendedores").then((r) => leer(r, "No se pudo cargar el personal")) : [],
    ]).then(([mio, tiendas, personal]) => {
      if (!vigente) return;
      setMiVendedorId(mio.vendedor_id ?? null);
      setSucursales(tiendas);
      setVendedores(personal);
      setIdentificado(true);
    }).catch((e) => { if (vigente) { setError(e.message); setIdentificado(true); } });
    return () => { vigente = false; };
  }, [usa, esJefatura]);

  const cambiarTipo = (nuevo) => { setPeriodo(nuevo); setInicio(inicioDePeriodo(nuevo, inicio)); };
  const pestanas = [
    ...(miVendedorId != null ? [{ clave: "mis-metas", etiqueta: "Mis metas", Icono: CheckSquare }] : []),
    { clave: "tablero", etiqueta: "Tablero", Icono: BarChart3 },
    ...(esAdmin ? [{ clave: "administrar", etiqueta: "Administrar", Icono: Settings2 }] : []),
  ];
  const activa = pestanas.some((p) => p.clave === pestana) ? pestana : pestanas[0].clave;
  const llave = `${periodo}/${inicio}`;
  const comun = { periodo, inicio, hoy, permisos, sucursales, vendedores, miVendedorId };

  return (
    <div className="p-4 space-y-4 overflow-y-auto min-w-0 max-w-full">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1" role="group" aria-label="Tipo de periodo">
          {Object.entries(TEXTO_PERIODO).map(([clave, texto]) => (
            <button key={clave} type="button" aria-pressed={periodo === clave} onClick={() => cambiarTipo(clave)}
              className={periodo === clave ? SEGMENTO_ACTIVO : SEGMENTO_INACTIVO}>{texto}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Periodo anterior" className={FLECHA} onClick={() => setInicio(moverPeriodo(periodo, inicio, -1))}>
            <ChevronLeft size={18} />
          </button>
          <strong className="text-slate-800 min-w-[16rem] text-center">{etiquetaPeriodo(periodo, inicio)}</strong>
          <button type="button" aria-label="Periodo siguiente" className={FLECHA} onClick={() => setInicio(moverPeriodo(periodo, inicio, 1))}>
            <ChevronRight size={18} />
          </button>
          <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setInicio(inicioDePeriodo(periodo, hoy))}>
            Hoy
          </button>
        </div>
      </div>
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>}
      {identificado && usa && !esJefatura && miVendedorId == null && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm">
          Tu cuenta no tiene un vendedor ligado. Pídele a quien administra el personal que la ligue desde Roles y Personal.
        </div>
      )}
      <Pestanas pestanas={pestanas} activa={activa} elegir={setPestana} />
      {identificado && activa === "mis-metas" && <MisMetas key={llave} {...comun} />}
      {identificado && activa === "tablero" && <TableroMetas key={llave} {...comun} />}
      {identificado && activa === "administrar" && <AdministrarMetas key={llave} {...comun} />}
    </div>
  );
}
