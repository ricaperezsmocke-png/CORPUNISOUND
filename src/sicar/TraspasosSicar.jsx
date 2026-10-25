import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import {
  formatoDinero, fechaHoraCorte, fechaRelativa, contadorDePeticiones, tiendasDelSelector,
} from "./cortesSicar.js";
import {
  parametrosTraspasos, alertasDeTraspaso, resumenDeAlertas, etiquetaFueraDeRango, textoComparacion, formatoCantidad,
  puedeEditarMapa, textoSinAsignar, nombreEstado, llaveTraspaso,
} from "./traspasosSicar.js";

const PAGINA = "mx-auto max-w-7xl p-4 sm:p-6";
const CAJA = "rounded-lg border border-slate-300 bg-white";
const CAMPO = "w-full rounded-md border border-slate-400 px-3 py-2 text-sm";
const ETIQUETA = "block text-xs font-semibold text-slate-700";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const CELDA = "border-b border-slate-200 px-3 py-2 align-top";
const DERECHA = "text-right tabular-nums";
const NOTA_ROJA = "mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800";
const NOTA_AMBAR = "mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900";
const NOTA_GRIS = "text-xs text-slate-600";
const PESTANA = "rounded-md border px-3 py-2 text-sm";
const PESTANA_ON = "border-blue-700 bg-blue-700 text-white";
const PESTANA_OFF = "border-slate-400 bg-white text-slate-700";
const BTN = "rounded-md border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50";
const BTN_PRIMARIO = "rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50";
const ETIQUETA_VIEJO = "ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700";
const ESTADOS = [{ id: "", nombre: "Todos" }, { id: "enviado", nombre: "Enviados" }, { id: "recibido", nombre: "Recibidos" }, { id: "cancelado", nombre: "Cancelados" }];

const nombreDeTienda = (tiendas, id) => tiendas.find((t) => String(t.id) === String(id))?.nombre || `Tienda ${id}`;

function Desglose({ t }) {
  return (
    <div className="space-y-2 bg-slate-50 p-3 text-sm">
      <p className="text-slate-800">{textoComparacion(t)}</p>
      {t.diferencias.length === 0 ? (
        <p className={NOTA_GRIS}>Sin diferencias por artículo entre lo enviado y lo recibido.</p>
      ) : (
        <table className="w-full max-w-xl text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left">Artículo SICAR</th>
              <th className={`px-2 py-1 ${DERECHA}`}>Enviado</th>
              <th className={`px-2 py-1 ${DERECHA}`}>Recibido</th>
              <th className={`px-2 py-1 ${DERECHA}`}>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {t.diferencias.map((d) => (
              <tr key={d.art_id}>
                <td className="px-2 py-1">{d.art_id}</td>
                <td className={`px-2 py-1 ${DERECHA}`}>{formatoCantidad(d.enviado)}</td>
                <td className={`px-2 py-1 ${DERECHA}`}>{formatoCantidad(d.recibido)}</td>
                <td className={`px-2 py-1 ${DERECHA} font-semibold text-amber-700`}>{formatoCantidad(d.diferencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={NOTA_GRIS}>Son las cifras que registró cada SICAR; no se acusa a nadie, solo se muestran las diferencias.</p>
    </div>
  );
}

function AlertasArriba({ traspasos }) {
  const resumen = resumenDeAlertas(traspasos);
  if (resumen.length === 0) return null;
  return (
    <div role="status" className={NOTA_AMBAR}>
      <p className="font-semibold">Para revisar</p>
      <ul className="list-disc pl-5">
        {resumen.map((a) => <li key={a.clave}>{a.cantidad} {a.texto}</li>)}
      </ul>
    </div>
  );
}

function TablaTraspasos({ traspasos, tiendas, desde, hasta }) {
  const [abierto, setAbierto] = useState(null);
  return (
    <div className={`${CAJA} overflow-x-auto`}>
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr>
            <th className={ENCABEZADO}>Fecha</th>
            <th className={ENCABEZADO}>Folio</th>
            <th className={ENCABEZADO}>De</th>
            <th className={ENCABEZADO}>Para</th>
            <th className={ENCABEZADO}>Estado</th>
            <th className={`${ENCABEZADO} text-right`}>Total</th>
            <th className={ENCABEZADO}>Avisos</th>
            <th className={ENCABEZADO}>Desglose</th>
          </tr>
        </thead>
        <tbody>
          {traspasos.map((t) => {
            const llave = llaveTraspaso(t);
            const visible = abierto === llave;
            const viejo = etiquetaFueraDeRango(t, desde, hasta);
            return (
              <React.Fragment key={llave}>
                <tr>
                  <td className={CELDA}>{fechaHoraCorte(t.fecha)}</td>
                  <td className={CELDA}>
                    {t.folio}
                    <span className="block text-xs text-slate-500">Registro de {nombreDeTienda(tiendas, t.sucursal_id)}</span>
                  </td>
                  <td className={CELDA}>{t.origen}</td>
                  <td className={CELDA}>{t.destino}</td>
                  <td className={CELDA}>
                    {nombreEstado(t.estado)}
                    {viejo && <span className={ETIQUETA_VIEJO}>{viejo}</span>}
                  </td>
                  <td className={`${CELDA} ${DERECHA}`}>{formatoDinero(t.total)}</td>
                  <td className={CELDA}>
                    {alertasDeTraspaso(t).map((a) => <p key={a.clave} className="text-xs font-semibold text-amber-800">{a.texto}</p>)}
                    {alertasDeTraspaso(t).length === 0 && "—"}
                  </td>
                  <td className={CELDA}>
                    <button type="button" className={BTN} aria-expanded={visible} onClick={() => setAbierto(visible ? null : llave)}>
                      {visible ? "Ocultar" : "Ver"}
                    </button>
                  </td>
                </tr>
                {visible && <tr><td colSpan={8} className="border-b border-slate-200 p-0"><Desglose t={t} /></td></tr>}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FilaMapa({ fila, tiendas, editable, onGuardado }) {
  const [valor, setValor] = useState(fila.sucursal_id === null || fila.sucursal_id === undefined ? "" : String(fila.sucursal_id));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const cuerpo = { sicar_sucursal: fila.sicar_sucursal, sucursal_id: valor === "" ? null : Number(valor) };
      const r = await apiFetch("/sicar/sucursales-mapa", { method: "PUT", body: JSON.stringify(cuerpo) });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) setError(datos.error || "No se pudo guardar el mapa.");
      else onGuardado();
    } catch (err) {
      setError(err.message || "No se pudo guardar el mapa.");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <tr>
      <td className={CELDA}>SICAR {fila.sicar_sucursal}</td>
      <td className={CELDA}>
        {editable ? (
          <form onSubmit={guardar} className="flex flex-wrap items-center gap-2">
            <select className={`${CAMPO} sm:w-60`} value={valor} onChange={(e) => setValor(e.target.value)} aria-label={`Tienda del número SICAR ${fila.sicar_sucursal}`}>
              <option value="">Sin tienda</option>
              {tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <button type="submit" className={BTN_PRIMARIO} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </form>
        ) : (fila.tienda || "Sin tienda")}
        {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      </td>
    </tr>
  );
}

function MapaSucursales({ permisos }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const editable = puedeEditarMapa(permisos);
  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch("/sicar/sucursales-mapa");
      const cuerpo = await r.json();
      setDatos(r.ok ? cuerpo : null);
      setError(r.ok ? "" : cuerpo?.error || "No se pudo cargar el mapa.");
    } catch (e) {
      setDatos(null);
      setError(e.message || "No se pudo cargar el mapa.");
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const mapa = datos?.mapa || [];
  const sinAsignar = datos?.sin_asignar || [];
  const extra = sinAsignar.filter((n) => !mapa.some((m) => m.sicar_sucursal === n)).map((n) => ({ sicar_sucursal: n, sucursal_id: null, tienda: null }));
  const filas = [...mapa, ...extra].sort((a, b) => Number(a.sicar_sucursal) - Number(b.sicar_sucursal));
  return (
    <div>
      <p className={`${NOTA_GRIS} mb-2`}>
        Cada SICAR numera sus sucursales por su cuenta. Este mapa dice a qué tienda de CORPUNISOUND corresponde cada número.
        {editable
          ? " Para pasar una tienda a otro número, primero quita el número anterior (déjalo en “Sin tienda”) y luego asigna el nuevo."
          : " Solo lo puede cambiar quien administra las tiendas."}
      </p>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {textoSinAsignar(sinAsignar) && <p className={NOTA_AMBAR}>{textoSinAsignar(sinAsignar)}</p>}
      {datos && (
        <div className={`${CAJA} overflow-x-auto`}>
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr><th className={ENCABEZADO}>Número en SICAR</th><th className={ENCABEZADO}>Tienda</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <FilaMapa key={`${f.sicar_sucursal}-${f.sucursal_id}`} fila={f} tiendas={datos.tiendas || []} editable={editable} onGuardado={cargar} />
              ))}
              {filas.length === 0 && <tr><td className={CELDA} colSpan={2}>Todavía no hay números de sucursal SICAR.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TraspasosSicar({ permisos = [], usuario = null }) {
  const [pestana, setPestana] = useState("traspasos");
  const [tiendas, setTiendas] = useState([]);
  // El selector ofrece solo las tiendas del alcance; el servidor impone el alcance con el token.
  const selector = tiendasDelSelector(tiendas, permisos, usuario);
  const propia = selector.todas ? "" : String(usuario?.sucursal_id ?? "");
  const [filtros, setFiltros] = useState({ sucursal: propia, desde: fechaRelativa(29), hasta: fechaRelativa(0), estado: "" });
  const [consulta, setConsulta] = useState(filtros);
  const peticiones = useRef(contadorDePeticiones());
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const cambiar = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  useEffect(() => {
    (async () => {
      try {
        const respuesta = await apiFetch("/sucursales?sucursal_id=");
        const lista = await respuesta.json();
        if (respuesta.ok && Array.isArray(lista)) setTiendas(lista.map((t) => ({ id: t.id, nombre: t.nombre })));
      } catch { /* sin nombres se muestran como "Tienda N" */ }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setConsulta(filtros), 300);
    return () => clearTimeout(t);
  }, [filtros]);

  const cargar = useCallback(async () => {
    const numero = peticiones.current.nueva();
    setCargando(true);
    setError("");
    try {
      const respuesta = await apiFetch(`/sicar/traspasos?${parametrosTraspasos(consulta)}`);
      const cuerpo = await respuesta.json();
      if (!peticiones.current.vigente(numero)) return;
      setDatos(respuesta.ok ? cuerpo : null);
      setError(respuesta.ok ? "" : cuerpo?.error || "No se pudieron cargar los traspasos.");
    } catch (e) {
      if (!peticiones.current.vigente(numero)) return;
      setDatos(null);
      setError(e.message || "No se pudieron cargar los traspasos.");
    } finally {
      if (peticiones.current.vigente(numero)) setCargando(false);
    }
  }, [consulta]);

  useEffect(() => { if (pestana === "traspasos") cargar(); }, [cargar, pestana]);

  const traspasos = datos?.traspasos || [];
  const estilo = (id) => `${PESTANA} ${pestana === id ? PESTANA_ON : PESTANA_OFF}`;
  return (
    <div className={PAGINA}>
      <h1 className="mb-1 text-xl font-bold text-slate-900">Traspasos SICAR</h1>
      <p className="mb-3 text-sm font-semibold text-slate-700">Cifras según SICAR</p>
      <div className="mb-4 flex gap-2">
        <button type="button" aria-pressed={pestana === "traspasos"} className={estilo("traspasos")} onClick={() => setPestana("traspasos")}>Traspasos</button>
        <button type="button" aria-pressed={pestana === "mapa"} className={estilo("mapa")} onClick={() => setPestana("mapa")}>Mapa de sucursales</button>
      </div>
      {pestana === "mapa" && <MapaSucursales permisos={permisos} />}
      {pestana === "traspasos" && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={ETIQUETA}>Tienda
              <select className={CAMPO} value={filtros.sucursal} onChange={cambiar("sucursal")}>
                {selector.todas && <option value="">Todas</option>}
                {selector.tiendas.length === 0 && !selector.todas && <option value={propia}>Mi tienda</option>}
                {selector.tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </label>
            <label className={ETIQUETA}>Desde
              <input type="date" className={CAMPO} value={filtros.desde} onChange={cambiar("desde")} />
            </label>
            <label className={ETIQUETA}>Hasta
              <input type="date" className={CAMPO} value={filtros.hasta} onChange={cambiar("hasta")} />
            </label>
            <label className={ETIQUETA}>Estado
              <select className={CAMPO} value={filtros.estado} onChange={cambiar("estado")}>
                {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </label>
          </div>
          <p className={`${NOTA_GRIS} mb-3`}>
            Los traspasos enviados que siguen sin recibirse aparecen siempre, aunque sean de fechas anteriores al filtro.
          </p>
          {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
          {cargando && <p className="mb-2 text-sm text-slate-500">Cargando…</p>}
          <AlertasArriba traspasos={traspasos} />
          <TablaTraspasos traspasos={traspasos} tiendas={tiendas} desde={consulta.desde} hasta={consulta.hasta} />
          {!cargando && !error && datos && traspasos.length === 0 && <p className="mt-3 text-sm text-slate-700">No hay traspasos con estos filtros</p>}
        </>
      )}
    </div>
  );
}
