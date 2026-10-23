import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { leerArchivoComoBase64 } from "../metas/Comunes";
import { SECCIONES } from "./pestanasSupervision";
import { AVISO, BOTON, BOTON_SECUNDARIO, CAMPO, RESULTADO, RESULTADOS, ROJO, pedirUbicacion } from "./comunes";

// Visita a tienda, pensada para celular: llegar (GPS), revisar cada punto y terminar.
export default function VisitaTienda({ sucursales, usuario }) {
  const [sucursalId, setSucursalId] = useState("");
  const [checklist, setChecklist] = useState([]);
  const [visita, setVisita] = useState(null);
  const [fallaAbierta, setFallaAbierta] = useState(null);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    apiFetch("/supervision/checklist").then((r) => leer(r, "No se pudo cargar el checklist"))
      .then((lista) => setChecklist(lista.filter((p) => p.activo))).catch((e) => setError(e.message));
    // Si se recargó la página a media visita, se retoma la que quedó en curso.
    apiFetch("/supervision/visitas").then((r) => leer(r, "No se pudieron cargar tus visitas"))
      .then((lista) => {
        const enCurso = lista.find((v) => v.estado === "en_curso" && v.supervisor_id === usuario?.id);
        if (enCurso) setVisita(enCurso);
      }).catch(() => {});
  }, [usuario?.id]);

  const llegar = async () => {
    setError("");
    setExito("");
    setOcupado(true);
    try {
      const { lat, lng } = await pedirUbicacion();
      setVisita(await apiFetch("/supervision/visitas", { method: "POST", body: JSON.stringify({ sucursal_id: Number(sucursalId), lat, lng }) })
        .then((r) => leer(r, "No se pudo iniciar la visita")));
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  };
  const marcar = async (punto, datos) => {
    setError("");
    try {
      setVisita(await apiFetch(`/supervision/visitas/${visita.id}/puntos`, { method: "POST", body: JSON.stringify({ checklist_id: punto.id, ...datos }) })
        .then((r) => leer(r, "No se pudo guardar el punto")));
      setFallaAbierta(null);
    } catch (e) { setError(e.message); throw e; }
  };
  const terminar = async () => {
    setError("");
    setOcupado(true);
    try {
      const { fallas } = await apiFetch(`/supervision/visitas/${visita.id}/terminar`, { method: "POST", body: "{}" })
        .then((r) => leer(r, "No se pudo terminar la visita"));
      setVisita(null);
      setExito(`Visita terminada. ${fallas.length ? `Se abrieron ${fallas.length} pendientes para la tienda.` : "Todo bien."}`);
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  };

  if (!visita) {
    return (
      <div className="space-y-3 max-w-md">
        {error && <div role="alert" className={ROJO}>{error}</div>}
        {exito && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">{exito}</div>}
        <label className="text-sm block">Tienda
          <select className={CAMPO} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            <option value="">Elige la tienda</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <button type="button" className={`${BOTON} w-full`} disabled={!sucursalId || ocupado} onClick={llegar}>
          {ocupado ? "Tomando ubicación…" : "Llegué a la tienda"}
        </button>
      </div>
    );
  }

  const marcados = new Map(visita.puntos.map((p) => [p.checklist_id, p]));
  const faltan = checklist.filter((p) => !marcados.has(p.id)).length;
  return (
    <div className="space-y-4 max-w-md">
      {!visita.ubicacion.comprobada && (
        <div className={AVISO}>La ubicación no se pudo comprobar; esta visita no contará para la meta.</div>
      )}
      {error && <div role="alert" className={ROJO}>{error}</div>}
      {SECCIONES.map((seccion) => (
        <details key={seccion.clave} open className="bg-white rounded-xl border border-slate-200 p-3">
          <summary className="font-semibold text-slate-800 cursor-pointer">{seccion.etiqueta}</summary>
          <ul className="mt-3 space-y-3">
            {checklist.filter((p) => p.seccion === seccion.clave).map((punto) => (
              <li key={punto.id} className="space-y-2">
                <p className="text-sm text-slate-700">{punto.texto}</p>
                <div className="flex gap-2">
                  {RESULTADOS.map((r) => (
                    <button key={r.clave} type="button"
                      className={`${RESULTADO} ${marcados.get(punto.id)?.resultado === r.clave ? r.activo : "bg-white border-slate-300"}`}
                      onClick={() => (r.clave === "falla" ? setFallaAbierta(punto) : marcar(punto, { resultado: r.clave }).catch(() => {}))}>
                      {r.etiqueta}
                    </button>
                  ))}
                </div>
                {fallaAbierta?.id === punto.id && (
                  <PanelFalla sucursalId={visita.sucursal_id} guardar={(datos) => marcar(punto, { resultado: "falla", ...datos })}
                    cancelar={() => setFallaAbierta(null)} />
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
      <button type="button" className={`${BOTON} w-full`} disabled={faltan > 0 || ocupado} onClick={terminar}>
        {faltan > 0 ? `Faltan ${faltan} puntos` : "Terminar visita"}
      </button>
    </div>
  );
}

function PanelFalla({ sucursalId, guardar, cancelar }) {
  const [responsables, setResponsables] = useState({ cuentas: [], sugerido: null });
  const [form, setForm] = useState({ nota: "", responsable_id: "", pasos: [""], archivo: null });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    apiFetch(`/supervision/responsables?sucursal_id=${sucursalId}`).then((r) => leer(r, "No se pudo cargar el personal de la tienda"))
      .then((datos) => {
        setResponsables(datos);
        if (datos.sugerido) setForm((f) => ({ ...f, responsable_id: String(datos.sugerido) }));
      }).catch((e) => setError(e.message));
  }, [sucursalId]);
  const pasos = form.pasos.map((p) => p.trim()).filter(Boolean);
  const listo = form.nota.trim() && form.responsable_id && pasos.length && form.archivo;
  const cambiarPaso = (i, valor) => setForm((f) => ({ ...f, pasos: f.pasos.map((p, j) => (j === i ? valor : p)) }));
  const elegirFoto = async (archivo) => {
    if (!archivo) return;
    try {
      const contenido_base64 = await leerArchivoComoBase64(archivo);
      setForm((f) => ({ ...f, archivo: { nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 } }));
    } catch { setError("No se pudo leer la foto"); }
  };
  const enviar = async () => {
    setGuardando(true);
    setError("");
    try {
      await guardar({ nota: form.nota, responsable_id: Number(form.responsable_id), pasos, archivo: form.archivo });
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };
  return (
    <div className="border border-red-200 bg-red-50/40 rounded-lg p-3 space-y-3 text-sm">
      {error && <div role="alert" className={ROJO}>{error}</div>}
      <label className="block">¿Qué está mal?
        <textarea className={CAMPO} rows={2} value={form.nota} onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))} />
      </label>
      <label className="block">Foto de la falla
        <input type="file" accept="image/jpeg,image/png" capture="environment" className="block mt-1"
          onChange={(e) => elegirFoto(e.target.files?.[0])} />
      </label>
      <label className="block">¿Quién la resuelve?
        <select className={CAMPO} value={form.responsable_id} onChange={(e) => setForm((f) => ({ ...f, responsable_id: e.target.value }))}>
          <option value="">Elige al encargado</option>
          {responsables.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend>Paso a paso para resolverla</legend>
        {form.pasos.map((paso, i) => (
          <div key={i} className="flex gap-2">
            <input className={`${CAMPO} mt-0`} value={paso} placeholder={`Paso ${i + 1}`} onChange={(e) => cambiarPaso(i, e.target.value)} />
            {form.pasos.length > 1 && (
              <button type="button" className={BOTON_SECUNDARIO} aria-label={`Quitar paso ${i + 1}`}
                onClick={() => setForm((f) => ({ ...f, pasos: f.pasos.filter((_, j) => j !== i) }))}>✕</button>
            )}
          </div>
        ))}
        {form.pasos.length < 10 && (
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => setForm((f) => ({ ...f, pasos: [...f.pasos, ""] }))}>+ Agregar paso</button>
        )}
      </fieldset>
      <div className="flex gap-2">
        <button type="button" className={BOTON} disabled={!listo || guardando} onClick={enviar}>{guardando ? "Guardando…" : "Guardar falla"}</button>
        <button type="button" className={BOTON_SECUNDARIO} onClick={cancelar}>Cancelar</button>
      </div>
    </div>
  );
}
