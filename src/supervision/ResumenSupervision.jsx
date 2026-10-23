import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { estadoVisita } from "./pestanasSupervision";
import { BOTON_SECUNDARIO, CAMPO, ROJO, fechaDia } from "./comunes";

const ESTADOS = {
  hecha: ["Hecha", "bg-emerald-100 text-emerald-800"],
  no_comprobada: ["Hecha sin ubicación comprobada", "bg-amber-100 text-amber-800"],
  en_curso: ["En curso", "bg-blue-100 text-blue-800"],
  falta: ["Falta", "bg-red-100 text-red-800"],
};
const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 7);

// Para Victor y el supervisor: qué tiendas se visitaron este mes y qué fallas siguen abiertas.
export default function ResumenSupervision({ sucursales }) {
  const [mes, setMes] = useState(mesActual);
  const [visitas, setVisitas] = useState([]);
  const [fallas, setFallas] = useState([]);
  const [accion, setAccion] = useState(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    setError("");
    try {
      setVisitas(await apiFetch(`/supervision/visitas?mes=${mes}`).then((r) => leer(r, "No se pudieron cargar las visitas")));
      setFallas(await apiFetch("/supervision/fallas").then((r) => leer(r, "No se pudieron cargar las fallas")));
    } catch (e) { setError(e.message); }
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);
  const nombreTienda = (id) => sucursales.find((s) => s.id === id)?.nombre || `Tienda ${id}`;
  const abiertas = fallas.filter((f) => f.estado === "abierta").sort((a, b) => Number(b.atrasada) - Number(a.atrasada));
  const cerradas = fallas.filter((f) => f.estado !== "abierta");

  return (
    <div className="space-y-5">
      {error && <div role="alert" className={ROJO}>{error}</div>}
      <section className="space-y-2">
        <label className="text-sm text-slate-600">Mes
          <input type="month" className={`${CAMPO} max-w-[12rem]`} value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>
        <ul className="divide-y divide-slate-100 bg-white rounded-xl border border-slate-200">
          {sucursales.map((s) => {
            const [texto, color] = ESTADOS[estadoVisita(visitas, s.id)];
            return (
              <li key={s.id} className="flex justify-between items-center px-4 py-2 text-sm">
                <span>{s.nombre}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{texto}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold text-slate-800">Fallas abiertas ({abiertas.length})</h3>
        {!abiertas.length && <p className="text-sm text-slate-500">No hay fallas abiertas.</p>}
        {abiertas.map((f) => (
          <article key={f.id} className={`bg-white rounded-xl border p-3 text-sm space-y-1 ${f.atrasada ? "border-red-400" : "border-slate-200"}`}>
            <strong>{nombreTienda(f.sucursal_id)} · {f.punto_texto}</strong>
            <p className="text-slate-600">{f.nota}</p>
            <p className={f.atrasada ? "text-red-700 font-semibold" : "text-slate-500"}>
              {f.responsable_nombre} · {f.atrasada ? `venció el ${f.limite}` : `hasta el ${f.limite}`} ·
              {` ${f.pasos.filter((p) => p.hecho_en).length} de ${f.pasos.length} pasos`}
            </p>
            <div className="flex gap-2 pt-1">
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion({ tipo: "reasignar", falla: f })}>Reasignar</button>
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => setAccion({ tipo: "cancelar", falla: f })}>Cancelar</button>
            </div>
            <Historial falla={f} />
          </article>
        ))}
      </section>
      {cerradas.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-slate-700">Fallas cerradas ({cerradas.length})</summary>
          <ul className="mt-2 space-y-2">
            {cerradas.map((f) => (
              <li key={f.id} className="bg-slate-50 rounded-lg p-2">
                {nombreTienda(f.sucursal_id)} · {f.punto_texto} · {f.estado === "resuelta" ? "Resuelta" : "Cancelada"}
                <Historial falla={f} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {accion && <DialogoAccion {...accion} cerrar={() => setAccion(null)} alTerminar={async () => { setAccion(null); await cargar(); }} />}
    </div>
  );
}

function Historial({ falla }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-blue-700">Historial</summary>
      <ul className="text-xs text-slate-600 mt-1 space-y-0.5">
        {falla.historial.map((h, i) => (
          <li key={i}>
            {fechaDia(h.en)} · {h.por_nombre} · {h.accion}{h.nota ? ` · ${h.nota}` : ""}
            {h.foto?.link && <a className="text-blue-700 underline ml-1" href={h.foto.link} target="_blank" rel="noreferrer">foto</a>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DialogoAccion({ tipo, falla, cerrar, alTerminar }) {
  const [motivo, setMotivo] = useState("");
  const [responsable, setResponsable] = useState("");
  const [cuentas, setCuentas] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (tipo !== "reasignar") return;
    apiFetch(`/supervision/responsables?sucursal_id=${falla.sucursal_id}`).then((r) => leer(r, "No se pudo cargar el personal"))
      .then((d) => setCuentas(d.cuentas)).catch((e) => setError(e.message));
  }, [tipo, falla.sucursal_id]);
  const enviar = async () => {
    setError("");
    try {
      const cuerpo = tipo === "reasignar" ? { motivo, responsable_id: Number(responsable) } : { motivo };
      await apiFetch(`/supervision/fallas/${falla.id}/${tipo}`, { method: "POST", body: JSON.stringify(cuerpo) }).then((r) => leer(r, "No se pudo guardar"));
      await alTerminar();
    } catch (e) { setError(e.message); }
  };
  const listo = motivo.trim() && (tipo !== "reasignar" || responsable);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-4 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto text-sm">
        <h3 className="font-semibold">{tipo === "reasignar" ? "Reasignar falla" : "Cancelar falla"}: {falla.punto_texto}</h3>
        {error && <div role="alert" className={ROJO}>{error}</div>}
        {tipo === "reasignar" && (
          <label className="block">Nuevo responsable
            <select className={CAMPO} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="">Elige</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        )}
        <label className="block">Motivo
          <textarea className={CAMPO} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" className={BOTON_SECUNDARIO} onClick={cerrar}>Volver</button>
          <button type="button" className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50" disabled={!listo} onClick={enviar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}
