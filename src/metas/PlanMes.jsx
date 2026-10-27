import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { contadorDePeticiones } from "../sicar/cortesSicar";
import { textoPorcentajeMeta, textoResultadoMeta } from "./avanceMetas.js";
import {
  avanceVisible, cuerpoProponer, etiquetaResultado, mesTerminado, mesesVisibles, nombreCamino, puedeProponer, textoAprobado, textoCalificado, textoEvidencia,
  textoSeCalifica, textoSeHizo,
} from "./planMes.js";
import PlanMesRevision from "./PlanMesRevision.jsx";
import { diaDeLaTienda } from "./tableroCincoCaminos.js";

const TARJETA = "rounded-xl border border-slate-300 bg-white p-4 space-y-3 min-w-0";
const CAMPO = "block w-full neu-campo rounded-lg px-3 py-2 mt-1 text-sm";
const BOTON = "px-3 py-2 text-sm text-slate-700 rounded-lg border border-slate-300";
const BOTON_PRINCIPAL = "px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-40";
const NOTA_ROJA = "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900";
const NOTA_AMBAR = "rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900";
const NOTA_GRIS = "text-xs text-slate-600";
const PASTILLA = "inline-block rounded-full border px-2 py-0.5 text-xs font-semibold";
const NOMBRE_PRUEBA = { foto: "foto", liga: "liga" };

// Resultado del mes: lo calificó el sistema solo, al cerrar el mes; nadie lo edita.
function ResultadoDelMes({ plan }) {
  const nombreDe = (id) => plan.tacticas.find((t) => t.id === id)?.nombre || `Táctica #${id}`;
  return (
    <section className="rounded-lg border border-slate-200 p-3 space-y-2 min-w-0" aria-label="Resultado del mes">
      <p className="text-xs font-semibold uppercase text-slate-500">Resultado del mes</p>
      <ul className="divide-y divide-slate-100">
        {plan.cierre.tacticas.map((r) => {
          const etiqueta = etiquetaResultado(r.resultado);
          return (
            <li key={r.id} className="py-2 text-sm space-y-1">
              <p className="font-semibold text-slate-900 break-words">{nombreDe(r.id)}</p>
              <p className="flex flex-wrap gap-2 items-center">
                <span className={`${PASTILLA} ${etiqueta.clase}`}>{etiqueta.texto}</span>
                <span className="text-slate-700">Se hizo: {textoSeHizo(r)}</span>
              </p>
              <p className="text-slate-700 break-words">{r.texto}</p>
            </li>
          );
        })}
      </ul>
      <p className={NOTA_GRIS}>{textoCalificado(plan.cierre)}</p>
    </section>
  );
}

function TacticaDelPlan({ t, avance, abierto }) {
  return (
    <li className="break-words">
      {t.nombre}
      {avance && abierto && (
        <span className="block text-xs text-slate-600">
          Cómo se comprueba: {NOMBRE_PRUEBA[avance.prueba] || avance.prueba} · {textoEvidencia(avance)}
        </span>
      )}
    </li>
  );
}

function PlanAprobado({ plan, hoy }) {
  const evidencias = Array.isArray(plan.evidencias) ? plan.evidencias : [];
  const terminado = mesTerminado(plan.mes, hoy);
  const avisos = [];
  if (plan.camino_forzado_por_servidor) avisos.push("Sin dato de clientes o menos del 50 %: el camino es calidad del dato");
  if (plan.camino_cambiado_por_gerente) avisos.push("El gerente se apartó del camino que propuso el sistema");
  return (
    <div className="space-y-3" aria-label="Plan aprobado">
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">Camino</p>
        <p className="text-base font-semibold text-slate-900">{nombreCamino(plan.camino)}</p>
        {plan.por_que_camino && <p className="text-sm text-slate-700 break-words">{plan.por_que_camino}</p>}
        {avisos.map((a) => <p key={a} role="note" className={`${NOTA_AMBAR} mt-1`}>{a}</p>)}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">Tácticas</p>
        <ul className="list-disc pl-5 text-sm text-slate-800">
          {plan.tacticas.map((t) => (
            <TacticaDelPlan key={t.id} t={t} avance={evidencias.find((e) => e.tactica_id === t.id)} abierto={avanceVisible(plan)} />
          ))}
        </ul>
      </div>
      {plan.cierre && <ResultadoDelMes plan={plan} />}
      {!plan.cierre && terminado && plan.fecha_calificacion && (
        <p role="note" className={NOTA_AMBAR}>{textoSeCalifica(plan.fecha_calificacion)}</p>
      )}
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">Metas</p>
        <ul className="divide-y divide-slate-100">
          {plan.metas.map((m) => (
            <li key={m.clave} className="py-2 text-sm">
              <p className="font-semibold text-slate-900 break-words">{m.nombre}</p>
              <p className="text-slate-700">{textoResultadoMeta(m)} · {textoPorcentajeMeta(m)}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className={NOTA_GRIS}>{textoAprobado(plan)}</p>
    </div>
  );
}

function Borradores({ lista, revisar }) {
  if (!lista.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase text-slate-500">Borradores</p>
      <ul className="divide-y divide-slate-100">
        {lista.map((b) => (
          <li key={b.id} className="py-2 flex flex-wrap gap-2 items-center text-sm">
            <span className="mr-auto">Borrador n.º {b.id} · {nombreCamino(b.propuesta.camino)} · {b.creado_por_nombre}</span>
            <button type="button" className={BOTON} onClick={() => revisar(b)}>Revisar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Mes sin plan aprobado: en un mes que se puede planear, quien tiene permiso ve sus borradores.
function SinPlan({ planificable, puede, borradores, revisar }) {
  return (
    <>
      <p className="text-sm text-slate-500">
        {planificable ? "Esta tienda todavía no tiene plan aprobado para este mes." : "Esta tienda no tuvo plan aprobado ese mes."}
      </p>
      {puede && planificable && <Borradores lista={borradores} revisar={revisar} />}
    </>
  );
}

// Plan del mes de la tienda. Ver pide ver_cinco_caminos; proponer, revisar y descartar, el permiso del planeador de metas.
export default function PlanMes({ sucursal, permisos = [] }) {
  const hoy = useMemo(() => diaDeLaTienda(), []);
  const meses = useMemo(() => mesesVisibles(hoy), [hoy]);
  // Se abre en el mes actual; los anteriores solo se ven (con su resultado), no se planean.
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const planificable = meses.some((m) => m.mes === mes && m.planificable);
  const [datos, setDatos] = useState(null);
  const [borradores, setBorradores] = useState([]);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorAccion, setErrorAccion] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [revisando, setRevisando] = useState(null);
  const peticiones = useRef(contadorDePeticiones());
  const puede = puedeProponer(permisos);
  const consulta = `sucursal_id=${encodeURIComponent(sucursal)}&mes=${mes}`;

  // El error de una acción (por ejemplo "El planeador con IA no está configurado") NO se borra al recargar: solo al intentar otra cosa.
  const cargar = useCallback(async () => {
    if (!sucursal) return;
    const numero = peticiones.current.nueva();
    try {
      const plan = await apiFetch(`/cinco-caminos/plan-mes?${consulta}`).then((r) => leer(r, "No se pudo cargar el plan del mes"));
      const lista = puede
        ? await apiFetch(`/cinco-caminos/plan-mes/borradores?${consulta}`).then((r) => leer(r, "No se pudieron cargar los borradores"))
        : { borradores: [] };
      if (!peticiones.current.vigente(numero)) return;
      setDatos(plan);
      setBorradores(lista.borradores || []);
      setErrorCarga("");
    } catch (e) {
      if (!peticiones.current.vigente(numero)) return;
      setDatos(null);
      setErrorCarga(e.message);
    }
  }, [sucursal, consulta, puede]);

  useEffect(() => { setDatos(null); setAviso(""); setErrorAccion(""); setRevisando(null); cargar(); }, [cargar]);

  const proponer = async () => {
    setEnviando(true);
    setErrorAccion("");
    setAviso("");
    try {
      const plan = await apiFetch("/cinco-caminos/plan-mes/proponer", { method: "POST", body: JSON.stringify(cuerpoProponer(sucursal, mes)) })
        .then((r) => leer(r, "No se pudo proponer el plan"));
      setRevisando(plan);
      await cargar();
    } catch (e) { setErrorAccion(e.message); } finally { setEnviando(false); }
  };
  const terminar = async (mensaje) => { setRevisando(null); setErrorAccion(""); setAviso(mensaje); await cargar(); };

  const plan = datos?.plan || null;
  return (
    <section className={TARJETA} aria-label="Plan del mes">
      <div className="flex flex-wrap gap-2 items-end">
        <h3 className="text-sm font-semibold text-slate-900 mr-auto">Plan del mes</h3>
        <label className="text-xs text-slate-600">Mes
          <select className={CAMPO} value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => <option key={m.mes} value={m.mes}>{m.etiqueta}</option>)}
          </select>
        </label>
        {puede && planificable && datos && !plan && (
          <button type="button" className={BOTON_PRINCIPAL} disabled={enviando} onClick={proponer}>Proponer plan con IA</button>
        )}
      </div>
      {enviando && <p role="status" className="text-sm text-slate-500">Esto puede tardar hasta un minuto y medio.</p>}
      {errorAccion && <p role="alert" className={NOTA_ROJA}>{errorAccion}</p>}
      {errorCarga && <p role="alert" className={NOTA_ROJA}>{errorCarga}</p>}
      {aviso && <p role="status" className={NOTA_GRIS}>{aviso}</p>}
      {!datos && !errorCarga && <p className="text-sm text-slate-500">Cargando…</p>}
      {plan && <PlanAprobado plan={plan} hoy={hoy} />}
      {datos && !plan && (
        <SinPlan planificable={planificable} puede={puede} borradores={borradores} revisar={(b) => { setAviso(""); setRevisando(b); }} />
      )}
      {revisando && <PlanMesRevision key={revisando.id} plan={revisando} cerrar={() => setRevisando(null)} alTerminar={terminar} />}
    </section>
  );
}
