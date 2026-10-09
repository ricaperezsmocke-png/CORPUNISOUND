import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { hoyLocal, leer } from "../objetivos/datos";
import { inicioDePeriodo } from "./metas";
import SelectorPeriodo from "./SelectorPeriodo";
import MisMetas from "./MisMetas";
import TableroMetas from "./TableroMetas";
import AdministrarMetas from "./AdministrarMetas";

// Este contenedor no cambia de identidad al elegir otra pestaña de metas:
// el periodo se comparte; solo se reinicia el contenido al cambiar periodo/inicio.
export default function PestanaMetas({ activa, permisos = [], miVendedorId }) {
  const hoy = hoyLocal();
  const esJefatura = permisos.includes("administrar_metas_personalizadas") || permisos.includes("anular_capturas_metas");
  const [periodo, setPeriodo] = useState("mensual");
  const [inicio, setInicio] = useState(() => inicioDePeriodo("mensual", hoy));
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    Promise.all([
      apiFetch("/sucursales").then((r) => leer(r, "No se pudieron cargar las tiendas")),
      esJefatura ? apiFetch("/vendedores").then((r) => leer(r, "No se pudo cargar el personal")) : [],
    ]).then(([tiendas, personal]) => {
      if (!vigente) return;
      setSucursales(tiendas);
      setVendedores(personal);
    }).catch((e) => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [esJefatura]);

  const llave = `${periodo}/${inicio}`;
  const comun = { periodo, inicio, hoy, permisos, sucursales, vendedores, miVendedorId };

  return (
    <div className="space-y-4">
      <SelectorPeriodo periodo={periodo} inicio={inicio} hoy={hoy} setPeriodo={setPeriodo} setInicio={setInicio} />
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>}
      {activa === "mis-metas" && <MisMetas key={llave} {...comun} />}
      {activa === "metas-tienda" && <TableroMetas key={llave} {...comun} />}
      {activa === "administrar-metas" && <AdministrarMetas key={llave} {...comun} />}
    </div>
  );
}
