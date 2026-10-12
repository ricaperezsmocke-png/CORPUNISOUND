import { useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { ALERTA } from "./Comunes";
import { TEXTO_PRUEBA, etiquetaPeriodo } from "./metas";
import { cuerpoValidacion, estadoInicial, faltanPorDecidir, puedeCrear, resumenConfirmacion } from "./planIA";

const BOTON = "bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50";
const SECUNDARIO = "border border-slate-300 rounded-lg px-4 py-2 text-sm";
const CAMPO = "neu-campo rounded-lg px-2 py-1 w-full text-sm";
const DECISION = (activa, color) => `px-3 py-1 rounded-lg border text-sm ${activa ? `${color} text-white` : "bg-white text-slate-700 border-slate-300"}`;

function Decidir({ punto, cambiar }) {
  return (
    <span className="flex gap-2 shrink-0">
      <button type="button" aria-pressed={punto.decision === "aceptar"} className={DECISION(punto.decision === "aceptar", "bg-emerald-600 border-emerald-600")}
        onClick={() => cambiar({ decision: "aceptar" })}>Aceptar</button>
      <button type="button" aria-pressed={punto.decision === "rechazar"} className={DECISION(punto.decision === "rechazar", "bg-red-600 border-red-600")}
        onClick={() => cambiar({ decision: "rechazar" })}>Rechazar</button>
    </span>
  );
}

// Planeador con IA: la IA solo propone. Se crea únicamente lo que aceptas punto por punto (regla de Victor 2026-10-12).
export default function PlaneadorIA({ periodo, inicio, sucursales, vendedores, cerrar, alTerminar }) {
  const [paso, setPaso] = useState(1);
  const [entrada, setEntrada] = useState({ objetivo_texto: "", sucursal_id: "" });
  const [plan, setPlan] = useState(null);
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const destino = entrada.sucursal_id ? sucursales.find((s) => s.id === Number(entrada.sucursal_id))?.nombre : "toda la empresa";

  const proponer = async () => {
    setError(""); setEnviando(true);
    try {
      const cuerpo = { ...entrada, sucursal_id: entrada.sucursal_id ? Number(entrada.sucursal_id) : null, periodo, inicio };
      const nuevo = await apiFetch("/metas/plan-ia", { method: "POST", body: JSON.stringify(cuerpo) }).then((r) => leer(r, "No se pudo armar el plan"));
      setPlan(nuevo); setEstado(estadoInicial(nuevo)); setPaso(2);
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  const enviar = async (ruta, cuerpo) => {
    setError(""); setEnviando(true);
    try {
      await apiFetch(`/metas/plan-ia/${plan.id}/${ruta}`, { method: "POST", body: JSON.stringify(cuerpo || {}) }).then((r) => leer(r, "No se pudo guardar"));
      alTerminar(ruta === "validar" ? "Se crearon las metas que validaste." : "Plan descartado. Quedó en el registro.");
    } catch (e) { setError(e.message); setPaso(2); } finally { setEnviando(false); }
  };
  const cambiarOkr = (cambio) => setEstado({ ...estado, okr: { ...estado.okr, ...cambio } });
  const cambiarMeta = (i, cambio) => setEstado({ ...estado, metas: estado.metas.map((m, j) => (j === i ? { ...m, ...cambio } : m)) });
  const vendedoresDestino = vendedores.filter((v) => !entrada.sucursal_id || v.sucursal_id === Number(entrada.sucursal_id));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Proponer plan con IA"
        className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3">
        <h3 className="font-semibold">✨ Proponer plan con IA · {etiquetaPeriodo(periodo, inicio)}</h3>
        {paso === 1 && (
          <>
            <label className="block text-sm">Qué quieres lograr
              <textarea className={`${CAMPO} mt-1`} rows={3} maxLength={500} value={entrada.objetivo_texto}
                onChange={(e) => setEntrada({ ...entrada, objetivo_texto: e.target.value })} />
              <span className="text-xs text-slate-500">No escribas nombres de personas.</span>
            </label>
            <label className="block text-sm">Para
              <select className={`${CAMPO} mt-1`} value={entrada.sucursal_id} onChange={(e) => setEntrada({ ...entrada, sucursal_id: e.target.value })}>
                <option value="">Toda la empresa</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-500">Para otro periodo, cierra esta ventana y cámbialo arriba.</p>
          </>
        )}
        {paso === 2 && estado && (
          <>
            {plan.sin_historial && <p className={ALERTA}>Esta tienda no tiene historial; las cifras son una propuesta sin datos, revísalas con cuidado.</p>}
            <section className="border rounded-lg p-3 space-y-2">
              <div className="flex gap-2 items-start">
                <div className="flex-1 space-y-1">
                  <span className="text-xs font-semibold text-slate-500">OKR</span>
                  <input className={CAMPO} aria-label="Título del OKR" value={estado.okr.form.titulo}
                    onChange={(e) => cambiarOkr({ form: { ...estado.okr.form, titulo: e.target.value } })} />
                  <input className={CAMPO} aria-label="Descripción del OKR" value={estado.okr.form.descripcion}
                    onChange={(e) => cambiarOkr({ form: { ...estado.okr.form, descripcion: e.target.value } })} />
                </div>
                <Decidir punto={estado.okr} cambiar={cambiarOkr} />
              </div>
            </section>
            {estado.metas.map((m, i) => {
              const propuesta = plan.propuesta.metas[i];
              const forma = (campo, valor) => cambiarMeta(i, { form: { ...m.form, [campo]: valor } });
              return (
                <section key={m.indice} className="border rounded-lg p-3 space-y-2">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <input className={`${CAMPO} col-span-2`} aria-label="Nombre de la meta" value={m.form.nombre} onChange={(e) => forma("nombre", e.target.value)} />
                      <input className={CAMPO} type="number" min={1} aria-label="Cifra" value={m.form.valor_meta} onChange={(e) => forma("valor_meta", e.target.value)} />
                      <input className={CAMPO} aria-label="Unidad" value={m.form.unidad} onChange={(e) => forma("unidad", e.target.value)} />
                      <select className={CAMPO} aria-label="Prueba" value={m.form.prueba} onChange={(e) => forma("prueba", e.target.value)}>
                        {Object.entries(TEXTO_PRUEBA).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                      </select>
                      <select className={CAMPO} aria-label="Para quién" value={m.alcance === "persona" ? m.vendedor_id || "?" : ""}
                        onChange={(e) => cambiarMeta(i, e.target.value ? { alcance: "persona", vendedor_id: e.target.value === "?" ? "" : e.target.value }
                          : { alcance: "base", vendedor_id: "" })}>
                        <option value="">{entrada.sucursal_id ? `Toda la tienda (${destino})` : "Toda la empresa"}</option>
                        <option value="?" disabled>Una persona…</option>
                        {vendedoresDestino.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                      </select>
                    </div>
                    <Decidir punto={m} cambiar={(cambio) => cambiarMeta(i, cambio)} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {propuesta.nueva && <span className="mr-2 rounded bg-violet-100 text-violet-800 px-1">Idea nueva</span>}
                    {propuesta.sin_historico && <span className="mr-2 rounded bg-amber-100 text-amber-800 px-1">Sin dato histórico</span>}
                    {propuesta.por_que}
                  </p>
                  {m.alcance === "persona" && <p className="text-xs text-amber-700">Esta meta quedará fuera del OKR porque es de una sola persona.</p>}
                </section>
              );
            })}
            {faltanPorDecidir(estado) > 0 && <p className="text-sm text-slate-600">Te faltan {faltanPorDecidir(estado)} puntos por aceptar o rechazar.</p>}
          </>
        )}
        {paso === 3 && (
          <section className="space-y-2 text-sm">
            <p className="font-medium">{resumenConfirmacion(plan, estado, destino)}</p>
            <ul className="list-disc pl-5 space-y-1">
              {estado.okr.decision === "aceptar" && <li>OKR: {estado.okr.form.titulo}</li>}
              {estado.metas.filter((m) => m.decision === "aceptar").map((m) => (
                <li key={m.indice}>
                  {m.form.nombre}: {m.form.valor_meta} {m.form.unidad} · {TEXTO_PRUEBA[m.form.prueba]} · {m.alcance === "persona"
                    ? vendedores.find((v) => v.id === Number(m.vendedor_id))?.nombre : destino}
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && <p role="alert" className={ALERTA}>{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          {paso === 1 && <button type="button" className={SECUNDARIO} onClick={cerrar}>Cancelar</button>}
          {paso === 1 && (
            <button type="button" className={BOTON} disabled={enviando || !entrada.objetivo_texto.trim()} onClick={proponer}>
              {enviando ? "Armando el plan…" : "Proponer"}
            </button>
          )}
          {paso === 2 && <button type="button" className={SECUNDARIO} disabled={enviando} onClick={() => enviar("descartar")}>Descartar plan</button>}
          {paso === 2 && <button type="button" className={BOTON} disabled={!puedeCrear(estado)} onClick={() => setPaso(3)}>Crear las validadas</button>}
          {paso === 3 && <button type="button" className={SECUNDARIO} disabled={enviando} onClick={() => setPaso(2)}>Volver a revisar</button>}
          {paso === 3 && (
            <button type="button" className={BOTON} disabled={enviando} onClick={() => enviar("validar", cuerpoValidacion(plan, estado))}>
              {enviando ? "Creando…" : "Confirmar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
