import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { Campo, Modal } from "../objetivos/DialogosObjetivos";
import { cuerpoCaptura } from "./metas";
import {
  ALERTA, Anulada, Barra, DialogoMotivo, ENLACE, ENLACE_ROJO, EXITO, Prueba, Semaforo, TARJETA, fechaCorta, leerArchivoComoBase64,
} from "./Comunes";

const BOTON_HECHO = "bg-blue-600 text-white rounded-lg px-5 py-2.5 font-semibold shrink-0";
const DE_QUIEN = { tienda: "De la tienda", persona: "Tuya", empresa: "De toda la empresa" };
const PIDE = { liga: "Pega la liga de la publicación", foto: "Sube la foto", ninguna: "¿Cuántas?" };

// "Mis metas": lo que le toca a la persona, con un botón grande "Hecho" (decisión de Victor 2026-10-08).
export default function MisMetas({ periodo, inicio, hoy }) {
  const [tablero, setTablero] = useState(null);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [capturando, setCapturando] = useState(null);
  const [quitando, setQuitando] = useState(null);
  const [abiertas, setAbiertas] = useState({});

  const cargar = useCallback(async () => {
    setError("");
    try {
      setTablero(await apiFetch(`/metas/tablero?periodo=${periodo}&inicio=${inicio}`).then((r) => leer(r, "No se pudieron cargar tus metas")));
    } catch (e) { setError(e.message); }
  }, [periodo, inicio]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!tablero) return error ? <div role="alert" className={ALERTA}>{error}</div> : <p className="text-sm text-slate-500">Cargando…</p>;
  const grupos = [
    ...tablero.okrs.map((o) => ({ titulo: o.titulo, metas: o.metas.filter((m) => m.puede_capturar) })),
    { titulo: null, metas: tablero.sueltas.filter((m) => m.puede_capturar) },
  ].filter((g) => g.metas.length);
  const terminar = async (mensaje) => { setCapturando(null); setQuitando(null); setExito(mensaje); await cargar(); };

  return (
    <div className="space-y-4">
      {error && <div role="alert" className={ALERTA}>{error}</div>}
      {exito && <div className={EXITO}>{exito}</div>}
      {tablero.sellado && <p className="bg-slate-100 rounded-lg p-3 text-sm text-slate-700">🔒 Periodo sellado. Ya no se puede capturar.</p>}
      {!grupos.length && <p className="text-sm text-slate-500">No tienes metas en este periodo.</p>}
      {grupos.map((grupo) => (
        <section key={grupo.titulo || "sueltas"} className="space-y-3">
          {grupo.titulo && <h3 className="font-semibold text-slate-700">{grupo.titulo}</h3>}
          {grupo.metas.map((meta) => {
            const mias = meta.mis_capturas.filter((c) => !c.anulada).reduce((s, c) => s + c.cantidad, 0);
            return (
              <article key={meta.clave} className={TARJETA}>
                <div className="flex gap-4 items-start">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap gap-2 items-baseline">
                      <strong className="text-slate-800">{meta.nombre}</strong>
                      <span className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-0.5">{DE_QUIEN[meta.alcance]}</span>
                    </div>
                    <p className="text-sm text-slate-700">{meta.resultado} de {meta.valor_meta} {meta.unidad}</p>
                    <Barra porcentaje={meta.porcentaje} />
                    <div className="flex flex-wrap gap-4 items-center">
                      <Semaforo semaforo={meta.semaforo} />
                      {meta.alcance !== "persona" && <span className="text-xs text-slate-600">Tú llevas {mias}</span>}
                    </div>
                  </div>
                  {!tablero.sellado && (
                    <button type="button" className={BOTON_HECHO} onClick={() => { setExito(""); setCapturando(meta); }}>Hecho</button>
                  )}
                </div>
                {meta.mis_capturas.length > 0 && (
                  <div>
                    <button type="button" className={`${ENLACE} text-sm`} aria-expanded={Boolean(abiertas[meta.clave])}
                      onClick={() => setAbiertas((a) => ({ ...a, [meta.clave]: !a[meta.clave] }))}>
                      Ver lo que capturé ({meta.mis_capturas.length})
                    </button>
                    {abiertas[meta.clave] && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {meta.mis_capturas.map((c) => (
                          <li key={c.id} className={`flex flex-wrap gap-3 items-center ${c.anulada ? "line-through text-slate-400" : ""}`}>
                            <span>{fechaCorta(c.fecha)}</span>
                            <Prueba captura={c} />
                            {c.nota && <span className="text-slate-500">{c.nota}</span>}
                            {!c.anulada && !tablero.sellado && (
                              <button type="button" className={ENLACE_ROJO} onClick={() => setQuitando(c)}>Quitar</button>
                            )}
                            <span className="no-underline"><Anulada anulada={c.anulada} /></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}
      {capturando && (
        <DialogoHecho meta={capturando} inicio={inicio} hoy={hoy} cerrar={() => setCapturando(null)}
          alTerminar={() => terminar("¡Listo! Se registró.")} />
      )}
      {quitando && (
        <DialogoMotivo titulo="Quitar captura" textoGuardar="Quitar" ruta={`/metas/captura/${quitando.id}/anular`}
          explicacion="Deja de contar. Queda registrado con tu nombre y el motivo." cerrar={() => setQuitando(null)}
          alTerminar={() => terminar("Se quitó la captura.")} />
      )}
    </div>
  );
}

function DialogoHecho({ meta, inicio, hoy, cerrar, alTerminar }) {
  const [form, setForm] = useState({ fecha: hoy < inicio ? inicio : hoy, link: "", archivo: null, cantidad: "", nota: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const falta = (meta.prueba === "liga" && !form.link.trim()) || (meta.prueba === "foto" && !form.archivo) ||
    (meta.prueba === "ninguna" && !(Number(form.cantidad) >= 1));
  const guardar = async () => {
    if (enviando || falta) return;
    setEnviando(true);
    setError("");
    try {
      await apiFetch(`/metas/${meta.clave}/captura`, { method: "POST", body: JSON.stringify(cuerpoCaptura(meta, form)) })
        .then((r) => leer(r, "No se pudo registrar"));
      await alTerminar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  const elegirFoto = async (archivo) => {
    if (!archivo) return cambiar("archivo")(null);
    try {
      cambiar("archivo")({ nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64: await leerArchivoComoBase64(archivo) });
    } catch { setError("No se pudo leer la foto"); }
  };
  return (
    <Modal titulo={`¿Qué hiciste? · ${meta.nombre}`} cerrar={cerrar} guardar={guardar} deshabilitado={enviando || falta} error={error}>
      <label className="text-sm block">
        Fecha
        <input type="date" value={form.fecha} min={inicio} max={hoy} onChange={(e) => cambiar("fecha")(e.target.value)}
          className="neu-campo rounded-lg px-3 py-2 w-full mt-1" />
      </label>
      {meta.prueba === "liga" && <Campo etiqueta={PIDE.liga} tipo="url" valor={form.link} cambiar={cambiar("link")} />}
      {meta.prueba === "foto" && (
        <label className="text-sm block">
          {PIDE.foto}
          <input type="file" accept="image/jpeg,image/png" onChange={(e) => elegirFoto(e.target.files?.[0])} className="block mt-1" />
        </label>
      )}
      {meta.prueba === "ninguna" && <Campo etiqueta={PIDE.ninguna} tipo="number" min="1" valor={form.cantidad} cambiar={cambiar("cantidad")} />}
      <Campo etiqueta="Nota (opcional)" valor={form.nota} cambiar={cambiar("nota")} />
    </Modal>
  );
}
