import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import PersonalSicar from "./PersonalSicar.jsx";
import {
  textoPersona, claseDiferencia, textoAtribucion, formatoDinero, nombreFormaPago, fechaHoraCorte, parametrosCortes, fechaRelativa,
  contadorDePeticiones, tiendasDelSelector, resultadoDeCarga,
} from "./cortesSicar.js";

const PAGINA = "mx-auto max-w-7xl p-4 sm:p-6";
const CAJA = "rounded-lg border border-slate-300 bg-white";
const CAMPO = "w-full rounded-md border border-slate-400 px-3 py-2 text-sm";
const ETIQUETA = "block text-xs font-semibold text-slate-700";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const CELDA = "border-b border-slate-200 px-3 py-2 align-top";
const DERECHA = "text-right tabular-nums";
const NOTA_ROJA = "mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800";
const NOTA_GRIS = "text-xs text-slate-600";
const PESTANA = "rounded-md border px-3 py-2 text-sm";
const PESTANA_ON = "border-blue-700 bg-blue-700 text-white";
const PESTANA_OFF = "border-slate-400 bg-white text-slate-700";
const BTN_DESGLOSE = "rounded-md border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

const nombreDeTienda = (tiendas, id) => tiendas.find((t) => String(t.id) === String(id))?.nombre || `Tienda ${id}`;

function Desglose({ corte }) {
  const canceladas = corte.cobraron.filter((b) => b.canceladas > 0);
  return (
    <div className="space-y-3 bg-slate-50 p-3">
      <p className="text-sm text-slate-800">{textoAtribucion(corte)}</p>
      <table className="w-full max-w-3xl text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left">Forma de pago</th>
            <th className={`px-2 py-1 ${DERECHA}`}>Calculado</th>
            <th className={`px-2 py-1 ${DERECHA}`}>Contado</th>
            <th className={`px-2 py-1 ${DERECHA}`}>Diferencia</th>
            <th className={`px-2 py-1 ${DERECHA}`}>Retiro</th>
          </tr>
        </thead>
        <tbody>
          {corte.pagos.map((p) => (
            <tr key={p.tpa_id}>
              <td className="px-2 py-1">{nombreFormaPago(p.tpa_id)}</td>
              <td className={`px-2 py-1 ${DERECHA}`}>{formatoDinero(p.calculado)}</td>
              <td className={`px-2 py-1 ${DERECHA}`}>{formatoDinero(p.contado)}</td>
              <td className={`px-2 py-1 ${DERECHA} ${claseDiferencia(p.diferencia)}`}>{formatoDinero(p.diferencia)}</td>
              <td className={`px-2 py-1 ${DERECHA}`}>{formatoDinero(p.retiro)}</td>
            </tr>
          ))}
          {corte.pagos.length === 0 && <tr><td className="px-2 py-1" colSpan={5}>SICAR no mandó desglose por forma de pago.</td></tr>}
        </tbody>
      </table>
      {canceladas.length > 0 && (
        <p className={NOTA_GRIS}>
          Ventas canceladas en el turno: {canceladas
            .map((b) => `${textoPersona(b)}: ${b.canceladas} por ${formatoDinero(b.total_canceladas)}`).join("; ")}
        </p>
      )}
    </div>
  );
}

function TablaCortes({ cortes, tiendas }) {
  const [abierto, setAbierto] = useState(null);
  return (
    <div className={`${CAJA} overflow-x-auto`}>
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr>
            <th className={ENCABEZADO}>Fecha y hora</th>
            <th className={ENCABEZADO}>Tienda / Caja</th>
            <th className={ENCABEZADO}>Cerró</th>
            <th className={ENCABEZADO}>Cobraron</th>
            <th className={`${ENCABEZADO} text-right`}>Calculado</th>
            <th className={`${ENCABEZADO} text-right`}>Contado</th>
            <th className={`${ENCABEZADO} text-right`}>Diferencia</th>
            <th className={`${ENCABEZADO} text-right`}>Retiro</th>
            <th className={ENCABEZADO}>Desglose</th>
          </tr>
        </thead>
        <tbody>
          {cortes.map((c) => {
            const llave = `${c.sucursal_id}-${c.cor_id}`;
            const visible = abierto === llave;
            return (
              <React.Fragment key={llave}>
                <tr>
                  <td className={CELDA}>{fechaHoraCorte(c.fecha_local)}</td>
                  <td className={CELDA}>{nombreDeTienda(tiendas, c.sucursal_id)} / caja {c.caj_id}</td>
                  <td className={CELDA}>{c.cerro ? textoPersona(c.cerro) : "—"}</td>
                  <td className={CELDA}>
                    {c.cobraron.length === 0 && "—"}
                    {c.cobraron.map((b) => (
                      <p key={b.usu_id}>{textoPersona(b)}: {b.ventas} ventas, {formatoDinero(b.total)}</p>
                    ))}
                  </td>
                  <td className={`${CELDA} ${DERECHA}`}>{formatoDinero(c.calculado)}</td>
                  <td className={`${CELDA} ${DERECHA}`}>{formatoDinero(c.contado)}</td>
                  <td className={`${CELDA} ${DERECHA} ${claseDiferencia(c.diferencia)}`}>{formatoDinero(c.diferencia)}</td>
                  <td className={`${CELDA} ${DERECHA}`}>{formatoDinero(c.retiro)}</td>
                  <td className={CELDA}>
                    <button type="button" className={BTN_DESGLOSE} aria-expanded={visible} onClick={() => setAbierto(visible ? null : llave)}>
                      {visible ? "Ocultar" : "Ver"}
                    </button>
                  </td>
                </tr>
                {visible && <tr><td colSpan={9} className="border-b border-slate-200 p-0"><Desglose corte={c} /></td></tr>}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResumenPersonas({ resumen, umbral, tiendas }) {
  const monto = formatoDinero(umbral);
  return (
    <div className="mt-4">
      <h2 className="mb-1 text-base font-semibold text-slate-900">Resumen por persona</h2>
      <p className={`${NOTA_GRIS} mb-2`}>
        Contadores: diferencias de {monto} o más. La diferencia propia cuenta solo los turnos en que esa persona fue la
        única que cobró; las compartidas no se le atribuyen.
      </p>
      <div className={`${CAJA} overflow-x-auto`}>
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr>
              <th className={ENCABEZADO}>Persona</th>
              <th className={`${ENCABEZADO} text-right`}>Turnos en que cobró</th>
              <th className={`${ENCABEZADO} text-right`}>Ventas</th>
              <th className={`${ENCABEZADO} text-right`}>Total cobrado</th>
              <th className={`${ENCABEZADO} text-right`}>Turnos que cerró</th>
              <th className={`${ENCABEZADO} text-right`}>Diferencia propia</th>
              <th className={`${ENCABEZADO} text-right`}>Faltantes de {monto} o más</th>
              <th className={`${ENCABEZADO} text-right`}>Sobrantes de {monto} o más</th>
              <th className={`${ENCABEZADO} text-right`}>Diferencias de turnos compartidos en que participó (no se le atribuyen)</th>
            </tr>
          </thead>
          <tbody>
            {resumen.map((r) => (
              <tr key={`${r.persona.sucursal_id}-${r.persona.usu_id}`}>
                <td className={CELDA}>
                  {textoPersona(r.persona)}
                  <span className="block text-xs text-slate-500">{nombreDeTienda(tiendas, r.persona.sucursal_id)}</span>
                </td>
                <td className={`${CELDA} ${DERECHA}`}>{r.turnos_cobro}</td>
                <td className={`${CELDA} ${DERECHA}`}>{r.ventas}</td>
                <td className={`${CELDA} ${DERECHA}`}>{formatoDinero(r.total)}</td>
                <td className={`${CELDA} ${DERECHA}`}>{r.turnos_cerro}</td>
                <td className={`${CELDA} ${DERECHA} ${claseDiferencia(r.diferencia_propia)}`}>{formatoDinero(r.diferencia_propia)}</td>
                <td className={`${CELDA} ${DERECHA}`}>{r.faltantes_propios}</td>
                <td className={`${CELDA} ${DERECHA}`}>{r.sobrantes_propios}</td>
                <td className={`${CELDA} ${DERECHA}`}>{formatoDinero(r.diferencia_compartida)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CortesSicar({ permisos = [], usuario = null }) {
  const [pestana, setPestana] = useState("cortes");
  const [tiendas, setTiendas] = useState([]);
  // El selector ofrece solo las tiendas del alcance: quien no ve todas, solo la suya (el servidor la impone igual).
  const selector = tiendasDelSelector(tiendas, permisos, usuario);
  const propia = selector.todas ? "" : String(usuario?.sucursal_id ?? "");
  const [filtros, setFiltros] = useState({ sucursal: propia, desde: fechaRelativa(29), hasta: fechaRelativa(0), caja: "", persona: "" });
  // Los filtros se consultan 300 ms después de la última tecla, como en Existencias SICAR.
  const [consulta, setConsulta] = useState(filtros);
  const peticiones = useRef(contadorDePeticiones());
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const puedeAsignar = permisos.includes("asignar_cajeros_sicar");
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

  // Solo la respuesta de la última petición se muestra: una vieja que llega tarde no tapa los filtros actuales.
  const cargar = useCallback(async () => {
    const numero = peticiones.current.nueva();
    setCargando(true);
    setError("");
    try {
      const respuesta = await apiFetch(`/sicar/cortes?${parametrosCortes(consulta)}`);
      const cuerpo = await respuesta.json();
      if (!peticiones.current.vigente(numero)) return;
      // Si falló se limpian los datos: no queda a la vista la tabla ni el resumen del rango anterior, solo el mensaje.
      const resultado = resultadoDeCarga(respuesta.ok, cuerpo);
      setDatos(resultado.datos);
      setError(resultado.error);
    } catch (e) {
      if (!peticiones.current.vigente(numero)) return;
      setDatos(null);
      setError(e.message || "No se pudieron cargar los cortes.");
    } finally {
      if (peticiones.current.vigente(numero)) setCargando(false);
    }
  }, [consulta]);

  useEffect(() => { if (pestana === "cortes") cargar(); }, [cargar, pestana]);

  const cortes = datos?.cortes || [];
  const estilo = (id) => `${PESTANA} ${pestana === id ? PESTANA_ON : PESTANA_OFF}`;
  return (
    <div className={PAGINA}>
      <h1 className="mb-1 text-xl font-bold text-slate-900">Cortes SICAR</h1>
      <p className="mb-3 text-sm font-semibold text-slate-700">Cifras según SICAR</p>
      <div className="mb-4 flex gap-2">
        <button type="button" aria-pressed={pestana === "cortes"} className={estilo("cortes")} onClick={() => setPestana("cortes")}>Cortes</button>
        <button type="button" aria-pressed={pestana === "personal"} className={estilo("personal")} onClick={() => setPestana("personal")}>
          Personal de SICAR
        </button>
      </div>
      {pestana === "personal" && <PersonalSicar puedeAsignar={puedeAsignar} tiendas={tiendas} />}
      {pestana === "cortes" && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            <label className={ETIQUETA}>Caja (número de SICAR)
              <input className={CAMPO} value={filtros.caja} onChange={cambiar("caja")} />
            </label>
            <label className={ETIQUETA}>Persona (usuario SICAR)
              <input className={CAMPO} value={filtros.persona} onChange={cambiar("persona")} />
            </label>
          </div>
          {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
          {cargando && <p className="mb-2 text-sm text-slate-500">Cargando…</p>}
          <TablaCortes cortes={cortes} tiendas={tiendas} />
          {!cargando && !error && datos && cortes.length === 0 && (
            <p className="mt-3 text-sm text-slate-700">No hay cortes con estos filtros</p>
          )}
          {cortes.length > 0 && <ResumenPersonas resumen={datos.resumen || []} umbral={datos.umbral || "1.00"} tiendas={tiendas} />}
        </>
      )}
    </div>
  );
}
