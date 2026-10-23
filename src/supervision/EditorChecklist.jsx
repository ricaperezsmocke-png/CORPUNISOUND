import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { SECCIONES } from "./pestanasSupervision";
import { BOTON, BOTON_SECUNDARIO, CAMPO, ROJO } from "./comunes";

// Editar el checklist de visitas: agregar, desactivar o reactivar puntos, siempre con motivo.
export default function EditorChecklist() {
  const [lista, setLista] = useState([]);
  const [nuevo, setNuevo] = useState({ seccion: "imagen", texto: "", motivo: "" });
  const [pendiente, setPendiente] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    try { setLista(await apiFetch("/supervision/checklist").then((r) => leer(r, "No se pudo cargar el checklist"))); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const enviar = async (cuerpo) => {
    setError("");
    try {
      await apiFetch("/supervision/checklist", { method: "POST", body: JSON.stringify(cuerpo) }).then((r) => leer(r, "No se pudo guardar"));
      setPendiente(null);
      setMotivo("");
      setNuevo((n) => ({ ...n, texto: "", motivo: "" }));
      await cargar();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-4 max-w-xl">
      {error && <div role="alert" className={ROJO}>{error}</div>}
      {SECCIONES.map((s) => (
        <section key={s.clave} className="bg-white rounded-xl border border-slate-200 p-3">
          <h3 className="font-semibold text-slate-800 mb-2">{s.etiqueta}</h3>
          <ul className="space-y-2 text-sm">
            {lista.filter((p) => p.seccion === s.clave).map((p) => (
              <li key={p.id} className="space-y-1">
                <div className="flex gap-2 items-center">
                  <span className={`flex-1 ${p.activo ? "" : "line-through text-slate-400"}`}>{p.texto}</span>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setPendiente(p)}>{p.activo ? "Quitar" : "Volver a usar"}</button>
                </div>
                {pendiente?.id === p.id && (
                  <div className="flex gap-2">
                    <input className={`${CAMPO} mt-0`} placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    <button type="button" className={BOTON} disabled={!motivo.trim()}
                      onClick={() => enviar({ accion: p.activo ? "desactivar" : "reactivar", id: p.id, motivo })}>Guardar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 text-sm">
        <h3 className="font-semibold text-slate-800">Agregar punto</h3>
        <select className={CAMPO} value={nuevo.seccion} onChange={(e) => setNuevo((n) => ({ ...n, seccion: e.target.value }))}>
          {SECCIONES.map((s) => <option key={s.clave} value={s.clave}>{s.etiqueta}</option>)}
        </select>
        <input className={CAMPO} placeholder="Qué se revisa" value={nuevo.texto} onChange={(e) => setNuevo((n) => ({ ...n, texto: e.target.value }))} />
        <input className={CAMPO} placeholder="Motivo" value={nuevo.motivo} onChange={(e) => setNuevo((n) => ({ ...n, motivo: e.target.value }))} />
        <button type="button" className={BOTON} disabled={!nuevo.texto.trim() || !nuevo.motivo.trim()}
          onClick={() => enviar({ accion: "agregar", ...nuevo })}>Agregar</button>
      </section>
    </div>
  );
}
