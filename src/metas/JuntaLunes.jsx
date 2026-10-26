import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { contadorDePeticiones } from "../sicar/cortesSicar";
import {
  compromisoValido, cuerpoCancelar, cuerpoCompromiso, cuerpoJuntaHecha, esSemanaActual, estadoCompromiso, fechaCompromisoInicial,
  opcionesSemanasJunta, puedeAgregarEnSemana, puedeEscribirJunta, puedeMarcarJunta, queryJunta, rangoFechaCompromiso, textoEstadoCompromiso,
  textoJuntaHecha, textoRegistrado,
} from "./juntaLunes.js";
import { diaDeLaTienda } from "./tableroCincoCaminos.js";

const TARJETA = "rounded-xl border border-slate-300 bg-white p-4 space-y-3 min-w-0";
const CAMPO = "block w-full neu-campo rounded-lg px-3 py-2 mt-1 text-sm";
const BOTON = "px-3 py-2 text-sm text-slate-700 rounded-lg border border-slate-300";
const BOTON_PRINCIPAL = "px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-40";
const NOTA_ROJA = "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900";
const NOTA_GRIS = "text-xs text-slate-600";
const FONDO = "fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4";
const VENTANA = "bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3";
const COLOR_ESTADO = { pendiente: "text-slate-600", hecho: "text-emerald-800", cancelado: "text-red-800" };

// Ventana con scroll y botón de guardar de tipo submit: Enter también guarda.
function Ventana({ titulo, alGuardar, cerrar, listo, enviando, error, textoGuardar, children }) {
  const enviar = (e) => { e.preventDefault(); if (listo && !enviando) alGuardar(); };
  return (
    <div className={FONDO}>
      <form role="dialog" aria-modal="true" aria-label={titulo} className={VENTANA} onSubmit={enviar}
        onKeyDown={(e) => { if (e.key === "Escape") cerrar(); }}>
        <h3 className="font-semibold">{titulo}</h3>
        {children}
        {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON} onClick={cerrar}>Cancelar</button>
          <button type="submit" className={BOTON_PRINCIPAL} disabled={!listo || enviando}>{textoGuardar}</button>
        </div>
      </form>
    </div>
  );
}

function DialogoCompromiso({ lunes, esActual, cerrar, alTerminar }) {
  const { min, max } = rangoFechaCompromiso(lunes);
  const [form, setForm] = useState({ texto: "", responsable: "", fecha_compromiso: fechaCompromisoInicial(lunes, diaDeLaTienda()) });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const poner = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const guardar = async () => {
    setEnviando(true);
    setError("");
    try {
      await apiFetch("/cinco-caminos/junta/compromisos", { method: "POST", body: JSON.stringify(cuerpoCompromiso(form, lunes, esActual)) })
        .then((r) => leer(r, "No se pudo guardar el compromiso"));
      await alTerminar();
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  return (
    <Ventana titulo="Agregar compromiso" alGuardar={guardar} cerrar={cerrar} listo={compromisoValido(form, lunes)} enviando={enviando}
      error={error} textoGuardar="Guardar compromiso">
      <label className="text-sm block">Compromiso
        <textarea className={CAMPO} rows={3} maxLength={200} value={form.texto} onChange={poner("texto")} />
      </label>
      <label className="text-sm block">Responsable (nombre o rol)
        <input className={CAMPO} maxLength={80} value={form.responsable} onChange={poner("responsable")} />
      </label>
      <label className="text-sm block">Fecha de compromiso
        <input className={CAMPO} type="date" min={min} max={max} value={form.fecha_compromiso} onChange={poner("fecha_compromiso")} />
      </label>
      <p className={NOTA_GRIS}>Queda con tu nombre. No se puede editar ni borrar: solo marcar hecho o cancelar con motivo.</p>
    </Ventana>
  );
}

function DialogoCancelar({ compromiso, cerrar, alTerminar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    setEnviando(true);
    setError("");
    try {
      await apiFetch(`/cinco-caminos/junta/compromisos/${compromiso.id}/cancelar`, { method: "POST", body: JSON.stringify(cuerpoCancelar(motivo)) })
        .then((r) => leer(r, "No se pudo cancelar el compromiso"));
      await alTerminar();
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  const listo = motivo.trim().length >= 3 && motivo.trim().length <= 200;
  return (
    <Ventana titulo="Cancelar compromiso" alGuardar={guardar} cerrar={cerrar} listo={listo} enviando={enviando} error={error}
      textoGuardar="Cancelar compromiso">
      <p className="text-sm text-slate-600">{compromiso.texto}</p>
      <label className="text-sm block">Motivo (3 a 200 caracteres)
        <textarea className={CAMPO} rows={3} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
    </Ventana>
  );
}

// Junta del lunes de la semana elegida. Leer pide ver los cinco caminos; escribir, marcar_junta_cinco_caminos y la tienda propia.
export default function JuntaLunes({ sucursal, permisos = [], usuario = null, alIndicador }) {
  const hoy = diaDeLaTienda();
  const semanas = useMemo(() => opcionesSemanasJunta(hoy), [hoy]);
  const [lunes, setLunes] = useState(semanas[0].lunes);
  const esActual = esSemanaActual(lunes, hoy);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [dialogo, setDialogo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const peticiones = useRef(contadorDePeticiones());
  const puedeEscribir = puedeEscribirJunta(permisos, usuario, sucursal);
  const puedeAgregar = puedeAgregarEnSemana(puedeEscribir, lunes, hoy);
  const verSolo = permisos.includes("marcar_junta_cinco_caminos") && !puedeEscribir;

  const cargar = useCallback(async () => {
    if (!sucursal || !lunes) return;
    const numero = peticiones.current.nueva();
    try {
      const cuerpo = await apiFetch(`/cinco-caminos/junta?${queryJunta(sucursal, lunes)}`).then((r) => leer(r, "No se pudo cargar la junta"));
      if (!peticiones.current.vigente(numero)) return;
      setDatos(cuerpo);
      if (alIndicador) alIndicador(cuerpo.indicador);
    } catch (e) {
      if (!peticiones.current.vigente(numero)) return;
      setDatos(null);
      setError(e.message);
      if (alIndicador) alIndicador(null);
    }
  }, [sucursal, lunes, alIndicador]);

  useEffect(() => { setDatos(null); setAviso(""); setError(""); if (alIndicador) alIndicador(null); cargar(); }, [cargar, alIndicador]);

  const terminar = async (mensaje) => { setDialogo(null); setAviso(mensaje); await cargar(); };
  const accion = async (ruta, cuerpo, mensaje, falla) => {
    setEnviando(true);
    setError("");
    try {
      await apiFetch(ruta, { method: "POST", body: JSON.stringify(cuerpo) }).then((r) => leer(r, falla));
      await terminar(mensaje);
    } catch (e) { await cargar(); setError(e.message); } finally { setEnviando(false); }
  };

  const compromisos = datos?.compromisos || [];
  return (
    <section className={TARJETA} aria-label="Junta del lunes">
      <div className="flex flex-wrap gap-2 items-end">
        <h3 className="text-sm font-semibold text-slate-900 mr-auto">Junta del lunes</h3>
        <label className="text-xs text-slate-600">Semana de la junta
          <select className={CAMPO} value={lunes} onChange={(e) => setLunes(e.target.value)}>
            {semanas.map((s) => <option key={s.lunes} value={s.lunes}>{s.etiqueta}</option>)}
          </select>
        </label>
        {puedeAgregar && datos && !datos.junta && (
          <button type="button" className={BOTON} onClick={() => { setAviso(""); setDialogo({ tipo: "nuevo" }); }}>Agregar compromiso</button>
        )}
        {puedeAgregar && datos && !datos.junta && (
          <button type="button" className={BOTON_PRINCIPAL} disabled={enviando || !puedeMarcarJunta(datos)}
            title={puedeMarcarJunta(datos) ? undefined : "Agrega al menos un compromiso vigente"}
            onClick={() => accion("/cinco-caminos/junta/hecha", cuerpoJuntaHecha(lunes), "Junta marcada como hecha.", "No se pudo marcar la junta")}>
            Marcar junta hecha
          </button>
        )}
      </div>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {aviso && <p role="status" className={NOTA_GRIS}>{aviso}</p>}
      {verSolo && <p className={NOTA_GRIS}>Solo puedes ver la junta de esta tienda: registrar compromisos se hace desde la tienda de tu usuario.</p>}
      {datos?.junta && (
        <p className="text-sm font-semibold text-emerald-800">
          {textoJuntaHecha(datos.junta)}.
        </p>
      )}
      {!datos && !error && <p className="text-sm text-slate-500">Cargando…</p>}
      {datos && !compromisos.length && <p className="text-sm text-slate-500">Esta semana todavía no tiene compromisos.</p>}
      {compromisos.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {compromisos.map((c) => {
            const estado = estadoCompromiso(c);
            return (
              <li key={c.id} className="py-2 space-y-1 text-sm">
                <p className={`text-slate-900 break-words ${estado === "cancelado" ? "line-through" : ""}`}>{c.texto}</p>
                <p className={NOTA_GRIS}>Responsable: {c.responsable} · Compromiso para el {c.fecha_compromiso.split("-").reverse().join("/")}</p>
                <p className={`text-xs ${COLOR_ESTADO[estado]}`}>{textoEstadoCompromiso(c)}</p>
                {textoRegistrado(c) && <p className={NOTA_GRIS}>{textoRegistrado(c)}</p>}
                {puedeEscribir && estado === "pendiente" && (
                  <div className="flex gap-2">
                    <button type="button" className={BOTON} disabled={enviando}
                      onClick={() => accion(`/cinco-caminos/junta/compromisos/${c.id}/hecho`, {}, "Compromiso marcado como hecho.", "No se pudo marcar hecho")}>
                      Hecho
                    </button>
                    <button type="button" className={BOTON} onClick={() => { setAviso(""); setDialogo({ tipo: "cancelar", compromiso: c }); }}>Cancelar</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dialogo?.tipo === "nuevo" && <DialogoCompromiso lunes={lunes} esActual={esActual} cerrar={() => setDialogo(null)} alTerminar={() => terminar("Compromiso guardado.")} />}
      {dialogo?.tipo === "cancelar" && (
        <DialogoCancelar compromiso={dialogo.compromiso} cerrar={() => setDialogo(null)} alTerminar={() => terminar("Compromiso cancelado.")} />
      )}
    </section>
  );
}
