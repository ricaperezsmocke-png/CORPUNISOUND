import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { leerArchivoComoBase64 } from "../metas/Comunes";
import { BOTON, CAMPO, ROJO, fechaDia } from "./comunes";

const TARJETA = "bg-white rounded-xl border p-4 space-y-3";

// Lo que el supervisor le dejó a la tienda: cada falla con su paso a paso; se cierra con nota y foto.
export default function PendientesTienda() {
  const [fallas, setFallas] = useState(null);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const cargar = useCallback(async () => {
    try {
      setFallas(await apiFetch("/supervision/mis-fallas").then((r) => leer(r, "No se pudieron cargar tus pendientes")));
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const paso = async (falla, indice) => {
    setError("");
    try {
      await apiFetch(`/supervision/fallas/${falla.id}/pasos/${indice}`, { method: "POST", body: "{}" }).then((r) => leer(r, "No se pudo marcar el paso"));
      await cargar();
    } catch (e) { setError(e.message); }
  };

  if (!fallas) return error ? <div role="alert" className={ROJO}>{error}</div> : <p className="text-sm text-slate-500">Cargando…</p>;
  const abiertas = fallas.filter((f) => f.estado === "abierta");
  return (
    <div className="space-y-3 max-w-md">
      {error && <div role="alert" className={ROJO}>{error}</div>}
      {exito && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">{exito}</div>}
      {!abiertas.length && <p className="text-sm text-slate-500">No tienes pendientes de la tienda.</p>}
      {abiertas.map((falla) => (
        <article key={falla.id} className={`${TARJETA} ${falla.atrasada ? "border-red-400" : "border-slate-200"}`}>
          <header className="space-y-1">
            <strong className="text-slate-800">{falla.punto_texto}</strong>
            <p className="text-sm text-slate-600">{falla.nota}</p>
            <p className={`text-xs ${falla.atrasada ? "text-red-700 font-semibold" : "text-slate-500"}`}>
              {falla.atrasada ? `Venció el ${falla.limite}` : `Tienes hasta el ${falla.limite}`} · Abierta el {fechaDia(falla.creada_en)}
            </p>
            {falla.foto?.link && <a className="text-sm text-blue-700 underline" href={falla.foto.link} target="_blank" rel="noreferrer">Ver foto</a>}
          </header>
          <ol className="space-y-2 text-sm">
            {falla.pasos.map((p, i) => (
              <li key={i}>
                <label className="flex gap-2 items-start">
                  <input type="checkbox" checked={Boolean(p.hecho_en)} disabled={Boolean(p.hecho_en)} onChange={() => paso(falla, i)} className="mt-1" />
                  <span className={p.hecho_en ? "line-through text-slate-400" : ""}>{i + 1}. {p.texto}</span>
                </label>
              </li>
            ))}
          </ol>
          <Resolver falla={falla} alTerminar={async () => { setExito("Pendiente resuelto."); await cargar(); }} />
        </article>
      ))}
    </div>
  );
}

function Resolver({ falla, alTerminar }) {
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const elegirFoto = async (f) => {
    if (!f) return;
    try { setArchivo({ nombre_archivo: f.name, tipo_mime: f.type, contenido_base64: await leerArchivoComoBase64(f) }); }
    catch { setError("No se pudo leer la foto"); }
  };
  const enviar = async () => {
    setEnviando(true);
    setError("");
    try {
      await apiFetch(`/supervision/fallas/${falla.id}/resolver`, { method: "POST", body: JSON.stringify({ nota, archivo }) })
        .then((r) => leer(r, "No se pudo resolver"));
      await alTerminar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  if (!abierto) return <button type="button" className={BOTON} onClick={() => setAbierto(true)}>Ya quedó, resolver</button>;
  return (
    <div className="space-y-2 text-sm">
      {error && <div role="alert" className={ROJO}>{error}</div>}
      <label className="block">¿Cómo se resolvió?
        <textarea className={CAMPO} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <label className="block">Foto de cómo quedó
        <input type="file" accept="image/jpeg,image/png" capture="environment" className="block mt-1" onChange={(e) => elegirFoto(e.target.files?.[0])} />
      </label>
      <button type="button" className={BOTON} disabled={!nota.trim() || !archivo || enviando} onClick={enviar}>
        {enviando ? "Guardando…" : "Marcar resuelto"}
      </button>
    </div>
  );
}
