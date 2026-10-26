import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, RefreshCw } from "lucide-react";
import { apiFetch } from "../api";
import { contadorDePeticiones, tiendasDelSelector } from "../sicar/cortesSicar";
import { diaDeLaTienda, opcionesSemanas, semanaPorDefecto, tarjetasDelTablero } from "./tableroCincoCaminos.js";
import CategoriasCincoCaminos from "./CategoriasCincoCaminos.jsx";
import ManualTacticas from "./ManualTacticas.jsx";
import JuntaLunes from "./JuntaLunes.jsx";
import { textoIndicador } from "./juntaLunes.js";

const CAMPO = "block w-full neu-campo rounded-lg px-3 py-2 mt-1 text-sm";
const ETIQUETA = "text-sm text-slate-600";
const TARJETA = "rounded-xl border border-slate-300 bg-white p-4 space-y-2 min-w-0";
const NOTA_ROJA = "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900";
const NOTA_GRIS = "text-xs text-slate-600";
const BOTON = "px-3 py-2 text-sm text-slate-700 rounded-lg border border-slate-300 flex gap-2 items-center";
const SEMAFORO = {
  verde: { texto: "En la meta", clase: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  ambar: { texto: "Cerca (hasta 5% abajo)", clase: "bg-amber-100 text-amber-900 border-amber-300" },
  rojo: { texto: "Por debajo", clase: "bg-red-100 text-red-900 border-red-300" },
};
const FLECHAS = { sube: [ArrowUp, "Sube contra la semana anterior"], baja: [ArrowDown, "Baja contra la semana anterior"],
  igual: [ArrowRight, "Igual que la semana anterior"] };

function Fila({ nombre, valor }) {
  return <div className="flex justify-between gap-2 text-xs text-slate-600"><span>{nombre}</span><span className="tabular-nums">{valor}</span></div>;
}

function Tarjeta({ t }) {
  const sem = t.semaforo ? SEMAFORO[t.semaforo] : null;
  const [Flecha, descripcion] = t.flecha ? FLECHAS[t.flecha] : [null, ""];
  const textual = ["sin dato", "sin configurar", "no confiable"].includes(t.actual);
  return (
    <section className={TARJETA} aria-label={t.etiqueta}>
      <p className="text-xs font-semibold uppercase text-slate-500">{t.camino}</p>
      <h3 className="text-sm font-semibold text-slate-900">{t.etiqueta}</h3>
      <p className={`flex items-center gap-2 tabular-nums ${textual ? "text-base text-slate-500" : "text-2xl font-bold text-slate-900"}`}>
        {t.actual}
        {Flecha && <Flecha size={18} aria-label={descripcion} role="img" />}
      </p>
      {t.nota && <p className={NOTA_GRIS}>{t.nota}: aún no hay semanas para comparar el registro del Radar.</p>}
      {sem && <p className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${sem.clase}`}>{sem.texto} (base: {t.base})</p>}
      <Fila nombre="Semana anterior" valor={t.anterior} />
      <Fila nombre="Misma semana del año pasado" valor={t.mismo_2025} />
      <Fila nombre="Promedio de 8 semanas" valor={t.promedio_8} />
      {t.detalle && t.detalle.denominador > 0 && (
        <p className={NOTA_GRIS}>Radar: {t.detalle.numerador} convertidas de {t.detalle.denominador} registradas hace 30 a 60 días.</p>
      )}
    </section>
  );
}

export default function CincoCaminos({ permisos = [], usuario = null }) {
  const [tiendas, setTiendas] = useState([]);
  const selector = tiendasDelSelector(tiendas, permisos, usuario);
  const hoy = diaDeLaTienda();
  const semanas = useMemo(() => opcionesSemanas(hoy), [hoy]);
  const [sucursal, setSucursal] = useState(String(usuario?.sucursal_id ?? ""));
  const [semana, setSemana] = useState(() => semanaPorDefecto());
  const [tablero, setTablero] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [pantalla, setPantalla] = useState("tablero");
  const [indicador, setIndicador] = useState(null);
  const verCategorias = pantalla === "categorias";
  const enTablero = pantalla === "tablero";
  const peticiones = useRef(contadorDePeticiones());
  const puedeConfigurar = permisos.includes("administrar_manual_tacticas");

  useEffect(() => {
    (async () => {
      try {
        const respuesta = await apiFetch("/sucursales?sucursal_id=");
        const lista = await respuesta.json();
        if (respuesta.ok && Array.isArray(lista)) setTiendas(lista.map((t) => ({ id: t.id, nombre: t.nombre })));
      } catch { /* sin nombres se muestran como "Tienda N" */ }
    })();
  }, []);

  // Sin tienda propia en el usuario, se toma la primera del selector. La tienda siempre viaja explícita.
  useEffect(() => {
    if (!sucursal && selector.tiendas.length > 0) setSucursal(String(selector.tiendas[0].id));
  }, [sucursal, selector.tiendas]);

  // Solo la respuesta de la última petición se muestra: una vieja que llega tarde no tapa la semana elegida.
  const cargar = useCallback(async () => {
    if (!sucursal) return;
    const numero = peticiones.current.nueva();
    setCargando(true);
    setError("");
    try {
      const respuesta = await apiFetch(`/cinco-caminos/tablero?sucursal_id=${encodeURIComponent(sucursal)}&semana=${semana}`);
      const cuerpo = await respuesta.json();
      if (!peticiones.current.vigente(numero)) return;
      if (!respuesta.ok) throw new Error(cuerpo.error || "No se pudo cargar el tablero.");
      setTablero(cuerpo);
    } catch (e) {
      if (!peticiones.current.vigente(numero)) return;
      setTablero(null);
      setError(e.message || "No se pudo cargar el tablero.");
    } finally {
      if (peticiones.current.vigente(numero)) setCargando(false);
    }
  }, [sucursal, semana]);

  useEffect(() => { if (enTablero) cargar(); }, [cargar, enTablero]);

  const vista = tablero ? tarjetasDelTablero(tablero) : null;
  const nombreTienda = tiendas.find((t) => String(t.id) === String(sucursal))?.nombre || `Tienda ${sucursal}`;
  return (
    <div className="space-y-4 min-w-0 max-w-full">
      <div className="flex flex-wrap gap-3 items-end">
        <h2 className="text-lg font-bold text-slate-900 mr-auto">Cinco caminos</h2>
        {enTablero && selector.todas && (
          <label className={ETIQUETA}>Tienda
            <select className={CAMPO} value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              {selector.tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
        )}
        {enTablero && <label className={ETIQUETA}>Semana
          <select className={CAMPO} value={semana} onChange={(e) => setSemana(e.target.value)}>
            {semanas.map((s) => <option key={s.lunes} value={s.lunes}>{s.etiqueta}</option>)}
          </select>
        </label>}
        {enTablero && <button type="button" className={BOTON} onClick={cargar}><RefreshCw size={16} aria-hidden="true" />Actualizar</button>}
        <button type="button" className={BOTON} aria-pressed={pantalla === "manual"} onClick={() => setPantalla(pantalla === "manual" ? "tablero" : "manual")}>
          {pantalla === "manual" ? "Volver al tablero" : "Manual de tácticas"}
        </button>
        {puedeConfigurar && (
          <button type="button" className={BOTON} aria-pressed={verCategorias} onClick={() => setPantalla(verCategorias ? "tablero" : "categorias")}>
            {verCategorias ? "Volver al tablero" : "Categorías"}
          </button>
        )}
      </div>
      {pantalla === "manual" ? <ManualTacticas permisos={permisos} /> : verCategorias ? <CategoriasCincoCaminos /> : (
        <>
          <p className="text-sm font-semibold text-slate-700">Ventas con cliente y de mostrador. Cifras según SICAR.</p>
          {indicador && <p className="text-sm text-slate-700" aria-label="Juntas hechas">{textoIndicador(indicador)}</p>}
          {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
          {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
          {vista && (
            <>
              <section className={TARJETA} aria-label="Venta de la semana">
                <h3 className="text-sm font-semibold text-slate-900">Venta de {nombreTienda} en la semana</h3>
                <p className="text-2xl font-bold tabular-nums text-slate-900">{vista.venta.actual}</p>
                <Fila nombre="Misma semana del año pasado" valor={vista.venta.mismo_2025} />
                <Fila nombre="Promedio de 8 semanas" valor={vista.venta.promedio_8} />
              </section>
              {vista.aviso && <p role="status" className={NOTA_ROJA}>{vista.aviso}</p>}
              {tablero.actual.sin_dato && tablero.actual.motivo !== "sin_mostrador" && (
                <p className={NOTA_GRIS}>Esta semana tiene menos de 30 ventas vigentes o la tienda no manda datos: no se califica.</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {vista.tarjetas.map((t) => <Tarjeta key={t.clave} t={t} />)}
              </div>
            </>
          )}
          {sucursal && <JuntaLunes sucursal={sucursal} lunes={semana} permisos={permisos} usuario={usuario} alIndicador={setIndicador} />}
        </>
      )}
    </div>
  );
}
