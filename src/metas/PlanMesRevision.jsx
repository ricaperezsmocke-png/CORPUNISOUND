import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import {
  CAMINOS_PLAN, PRUEBAS_EVIDENCIA, ROLES, avisosDelCamino, baseDeMeta, cifraDeMeta, cuerpoDescartar, cuerpoValidar, estadoInicialPlan, motivoValido,
  nombreCamino, necesitaEvidencia, nombreNumero, opcionesParaPlan, avisoDescuento, resumenDecision, textoAjuste, textoDescartada, textoRango,
  textoRechazoTactica,
} from "./planMes.js";

const CAMPO = "block w-full neu-campo rounded-lg px-3 py-2 mt-1 text-sm";
const BOTON = "px-3 py-2 text-sm text-slate-700 rounded-lg border border-slate-300";
const BOTON_PRINCIPAL = "px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-40";
const NOTA_ROJA = "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900";
const NOTA_AMBAR = "rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900";
const NOTA_GRIS = "text-xs text-slate-600";
const PUNTO = "rounded-lg border border-slate-200 p-3 space-y-2 min-w-0";
const FONDO = "fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4";
const VENTANA = "bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3";
const COLORES = { aceptar: "bg-emerald-600 border-emerald-600", cambiar: "bg-blue-600 border-blue-600", rechazar: "bg-red-600 border-red-600" };
const NOMBRES_BOTON = { aceptar: "Aceptar", cambiar: "Cambiar", rechazar: "Rechazar" };

const claseDecision = (activa, decision) => `px-3 py-1 rounded-lg border text-sm ${activa ? `${COLORES[decision]} text-white` : "bg-white text-slate-700 border-slate-300"}`;

// Aceptar, Cambiar y Rechazar de un punto. `sinAceptar` deja el punto solo para cambiar o rechazar.
function Decidir({ punto, cambiar, sinAceptar = false, sinRechazar = false }) {
  return (
    <span className="flex flex-wrap gap-2" role="group" aria-label="Decisión">
      {Object.keys(NOMBRES_BOTON).filter((d) => !(sinRechazar && d === "rechazar")).map((d) => (
        <button key={d} type="button" aria-pressed={punto.decision === d} disabled={sinAceptar && d === "aceptar"}
          className={`${claseDecision(punto.decision === d, d)} disabled:opacity-40`} onClick={() => cambiar({ decision: d })}>{NOMBRES_BOTON[d]}</button>
      ))}
    </span>
  );
}

function Ventana({ titulo, alEnviar, cerrar, listo, enviando, error, textoEnviar, izquierda, children }) {
  const enviar = (e) => { e.preventDefault(); if (listo && !enviando) alEnviar(); };
  return (
    <div className={FONDO}>
      <form role="dialog" aria-modal="true" aria-label={titulo} className={VENTANA} onSubmit={enviar}
        onKeyDown={(e) => { if (e.key === "Escape") cerrar(); }}>
        <h3 className="font-semibold">{titulo}</h3>
        {children}
        {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {izquierda}
          <button type="button" className={BOTON} onClick={cerrar}>Cerrar</button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={!listo || enviando}>{textoEnviar}</button>
        </div>
      </form>
    </div>
  );
}

function DialogoDescartar({ plan, cerrar, alTerminar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    setEnviando(true);
    setError("");
    try {
      await apiFetch(`/cinco-caminos/plan-mes/${plan.id}/descartar`, { method: "POST", body: JSON.stringify(cuerpoDescartar(motivo)) })
        .then((r) => leer(r, "No se pudo descartar el plan"));
      await alTerminar("Plan descartado. Quedó en el registro.");
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  return (
    <Ventana titulo="Descartar plan" alEnviar={guardar} cerrar={cerrar} listo={motivoValido(motivo)} enviando={enviando} error={error} textoEnviar="Descartar plan">
      <label className="text-sm block">Motivo (3 a 300 caracteres)
        <textarea className={CAMPO} rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
    </Ventana>
  );
}

const alElegir = (decision, punto, propuesta) => (decision === "aceptar" ? propuesta.camino : punto.decision === "cambiar" ? punto.camino : "");

function PuntoCamino({ propuesta, punto, cambiar }) {
  const avisos = avisosDelCamino(propuesta, punto);
  const final = punto.decision === "cambiar" ? punto.camino : propuesta.camino;
  return (
    <section className={PUNTO} aria-label="Camino">
      <p className="text-xs font-semibold uppercase text-slate-500">Camino más débil</p>
      <p className="text-base font-semibold text-slate-900">{nombreCamino(final)}</p>
      <p className="text-sm text-slate-700 break-words">{propuesta.por_que_camino}</p>
      {avisos.map((a) => <p key={a} role="note" className={NOTA_AMBAR}>{a}</p>)}
      <Decidir punto={punto} sinRechazar cambiar={(c) => cambiar({ decision: c.decision, camino: alElegir(c.decision, punto, propuesta) })} />
      {punto.decision === "cambiar" && (
        <label className="text-sm block">Camino
          <select className={CAMPO} value={punto.camino} onChange={(e) => cambiar({ decision: "cambiar", camino: e.target.value })}>
            <option value="">Elige un camino</option>
            {CAMINOS_PLAN.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

// Una táctica por evidencia se comprueba con foto o liga, de 1 a 31 veces en el mes: se crea su meta al aprobar.
function EvidenciaTactica({ punto, cambiar }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm block">Cómo se comprueba
        <select className={CAMPO} value={punto.prueba} onChange={(e) => cambiar({ ...punto, prueba: e.target.value })}>
          {PRUEBAS_EVIDENCIA.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
        </select>
      </label>
      <label className="text-sm block">Cuántas veces en el mes (1 a 31)
        <input className={CAMPO} type="number" min={1} max={31} step={1} inputMode="numeric" value={punto.veces}
          onChange={(e) => cambiar({ ...punto, veces: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
      </label>
    </div>
  );
}

function PuntoTactica({ t, punto, cambiar, opciones, cargaManual, manual }) {
  const motivo = textoRechazoTactica(t);
  const elegida = punto.decision === "cambiar" ? punto.nuevo_id : t.id;
  const conEvidencia = punto.decision !== "rechazar" && necesitaEvidencia(elegida, manual);
  return (
    <li className={PUNTO}>
      <p className="text-sm font-semibold text-slate-900 break-words">{t.nombre}</p>
      <p className="text-sm text-slate-700 break-words">{t.por_que}</p>
      {motivo && <p role="note" className={NOTA_AMBAR}>{motivo}</p>}
      <p className={NOTA_GRIS}>{resumenDecision(punto)}</p>
      <Decidir punto={punto} cambiar={(c) => cambiar({ ...punto, ...c })} sinAceptar={t.rechazada === true} />
      {punto.decision === "cambiar" && (
        <label className="text-sm block">Cambiar por
          <select className={CAMPO} value={punto.nuevo_id} disabled={!opciones.length} onChange={(e) => cambiar({ ...punto, nuevo_id: e.target.value })}>
            <option value="">{cargaManual}</option>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </label>
      )}
      {conEvidencia && <EvidenciaTactica punto={punto} cambiar={cambiar} />}
    </li>
  );
}

function PuntoMeta({ m, punto, cambiar }) {
  const ajuste = textoAjuste(m);
  const valorInicial = () => String(m.valor);
  const alCambiar = (c) => cambiar({ ...punto, ...c, valor: c.decision === "cambiar" && !punto.valor ? valorInicial() : punto.valor });
  return (
    <li className={PUNTO}>
      <p className="text-sm font-semibold text-slate-900">{nombreNumero(m.numero)}: llegar a {cifraDeMeta(m)}</p>
      <p className={NOTA_GRIS}>Base: {baseDeMeta(m)} · Rango permitido: {textoRango(m)}</p>
      <p className={NOTA_GRIS}>Responsable: {ROLES[m.responsable_rol] || m.responsable_rol}</p>
      <p className="text-sm text-slate-700 break-words">{m.por_que}</p>
      {ajuste && <p role="note" className={NOTA_AMBAR}>{ajuste}</p>}
      {m.fuera_de_camino && <p role="note" className={NOTA_AMBAR}>Esta meta no es la del camino: primero hay que arreglar el dato de clientes.</p>}
      <p className={NOTA_GRIS}>{resumenDecision(punto)}</p>
      <Decidir punto={punto} cambiar={alCambiar} />
      {punto.decision === "cambiar" && (
        <label className="text-sm block">Cifra (ej. {m.valor})
          <input className={CAMPO} inputMode="decimal" value={punto.valor} onChange={(e) => cambiar({ ...punto, valor: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
        </label>
      )}
    </li>
  );
}

// Revisión de un borrador: la IA solo propone; se crea únicamente lo que el gerente decide punto por punto (todo o nada en el servidor).
export default function PlanMesRevision({ plan, cerrar, alTerminar }) {
  const propuesta = plan.propuesta;
  const [estado, setEstado] = useState(() => estadoInicialPlan(propuesta));
  const [manual, setManual] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [descartando, setDescartando] = useState(false);

  useEffect(() => {
    let vigente = true;
    apiFetch("/cinco-caminos/manual").then((r) => leer(r, "No se pudo cargar el manual de tácticas"))
      .then((c) => { if (vigente) setManual(c.tacticas); })
      .catch((e) => { if (vigente) { setManual([]); setError(e.message); } });
    return () => { vigente = false; };
  }, []);

  const opciones = opcionesParaPlan(propuesta, manual);
  const descuento = avisoDescuento(propuesta, estado);
  const cargaManual = manual === null ? "Cargando tácticas…" : "Elige una táctica";
  const poner = (llave, id, valor) => setEstado((e) => ({ ...e, [llave]: { ...e[llave], [id]: valor } }));
  const crear = async () => {
    const r = cuerpoValidar(propuesta, estado, manual);
    if (!r.ok) { setError(r.error); return; }
    setEnviando(true);
    setError("");
    try {
      await apiFetch(`/cinco-caminos/plan-mes/${plan.id}/validar`, { method: "POST", body: JSON.stringify(r.cuerpo) }).then((x) => leer(x, "No se pudo crear el plan"));
      await alTerminar("Plan creado. Las metas aceptadas ya están en Metas extra.");
    } catch (e) { setError(e.message); setEnviando(false); }
  };

  return (
    <>
      <Ventana titulo={`Plan del mes ${plan.entrada.mes} (borrador)`} alEnviar={crear} cerrar={cerrar} listo enviando={enviando} error={error}
        textoEnviar="Crear lo aceptado"
        izquierda={<button type="button" className={BOTON} disabled={enviando} onClick={() => setDescartando(true)}>Descartar</button>}>
        <p className={NOTA_GRIS}>La IA solo propone. No se crea nada hasta que decidas cada punto y pulses "Crear lo aceptado".</p>
        <PuntoCamino propuesta={propuesta} punto={estado.camino} cambiar={(c) => setEstado((e) => ({ ...e, camino: c }))} />
        <h4 className="text-sm font-semibold text-slate-900">Tácticas del manual</h4>
        {descuento && <p role="alert" className={NOTA_AMBAR}>{descuento}</p>}
        <ul className="space-y-2">
          {propuesta.tacticas.map((t) => (
            <PuntoTactica key={t.id} t={t} punto={estado.tacticas[t.id]} cambiar={(p) => poner("tacticas", t.id, p)} opciones={opciones}
              cargaManual={cargaManual} manual={manual} />
          ))}
        </ul>
        <h4 className="text-sm font-semibold text-slate-900">Metas</h4>
        <ul className="space-y-2">
          {propuesta.metas.map((m) => <PuntoMeta key={m.numero} m={m} punto={estado.metas[m.numero]} cambiar={(p) => poner("metas", m.numero, p)} />)}
        </ul>
        {propuesta.descartadas.length > 0 && (
          <section className={PUNTO} aria-label="Metas descartadas">
            <h4 className="text-sm font-semibold text-slate-900">Metas descartadas por el servidor</h4>
            <ul className="list-disc pl-5 text-sm text-slate-700">
              {propuesta.descartadas.map((d) => <li key={d.numero}>{textoDescartada(d)}</li>)}
            </ul>
          </section>
        )}
      </Ventana>
      {descartando && <DialogoDescartar plan={plan} cerrar={() => setDescartando(false)} alTerminar={alTerminar} />}
    </>
  );
}
