import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { apiFetch } from "../api";
import {
  CAMINOS, MEDICIONES, QUIEN, NOMBRES_NUMERO, agruparPorCamino, textoEtiqueta, textoProbadaEn, nombreCamino, nombreNumero,
  nombreMedicion, nombreQuien, formularioVacio, formularioDeTactica, cuerpoAlta, cuerpoCambio, errorDelFormulario, entradaHistorial,
} from "./manualTacticas.js";

const CAMPO = "block w-full neu-campo rounded-lg px-3 py-2 mt-1 text-sm";
const ETIQUETA = "text-sm text-slate-600";
const TARJETA = "rounded-xl border border-slate-300 bg-white p-4 space-y-2 min-w-0";
const NOTA_ROJA = "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900";
const NOTA_GRIS = "text-xs text-slate-600";
const BOTON = "px-3 py-2 text-sm text-slate-700 rounded-lg border border-slate-300";
const BOTON_AZUL = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-700 text-white disabled:opacity-50";
const FONDO = "fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4";
const VENTANA = "bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3";
const PASTILLA = "inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800";

function Ventana({ titulo, cerrar, alEnviar, enviando, error, textoEnviar, children }) {
  const id = useId();
  useEffect(() => {
    const alPulsar = (e) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [cerrar]);
  return (
    <div className={FONDO}>
      <form className={VENTANA} role="dialog" aria-modal="true" aria-labelledby={id} onSubmit={(e) => { e.preventDefault(); if (alEnviar) alEnviar(); }}>
        <h3 id={id} className="font-semibold">{titulo}</h3>
        {children}
        {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON} onClick={cerrar}>{alEnviar ? "Cancelar" : "Cerrar"}</button>
          {alEnviar && <button type="submit" className={BOTON_AZUL} disabled={enviando}>{textoEnviar}</button>}
        </div>
      </form>
    </div>
  );
}

function Opciones({ lista }) {
  return lista.map((o) => <option key={o.clave} value={o.clave}>{o.nombre}</option>);
}

function FormularioTactica({ tactica, cerrar, alGuardar }) {
  const [f, setF] = useState(() => (tactica ? formularioDeTactica(tactica) : formularioVacio()));
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const poner = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const alternar = (q) => setF((x) => ({ ...x, quien: x.quien.includes(q) ? x.quien.filter((y) => y !== q) : [...x.quien, q] }));
  const numeros = Object.entries(NOMBRES_NUMERO);

  const enviar = async () => {
    const problema = errorDelFormulario(f);
    if (problema) { setError(problema); return; }
    const cuerpo = tactica ? cuerpoCambio(tactica, f) : cuerpoAlta(f);
    if (tactica && Object.keys(cuerpo).length === 0) { cerrar(); return; }
    setEnviando(true);
    setError("");
    try {
      const ruta = tactica ? `/cinco-caminos/manual/${tactica.id}` : "/cinco-caminos/manual";
      const r = await apiFetch(ruta, { method: tactica ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const respuesta = await r.json();
      if (!r.ok) throw new Error(respuesta.error || "No se pudo guardar la táctica.");
      alGuardar();
    } catch (e) {
      setError(e.message || "No se pudo guardar la táctica.");
      setEnviando(false);
    }
  };

  return (
    <Ventana titulo={tactica ? "Editar táctica" : "Nueva táctica"} cerrar={cerrar} alEnviar={enviar} enviando={enviando} error={error}
      textoEnviar={enviando ? "Guardando…" : "Guardar"}>
      <label className={ETIQUETA}>Nombre
        <input className={CAMPO} value={f.nombre} maxLength={120} onChange={poner("nombre")} />
      </label>
      <label className={ETIQUETA}>Descripción
        <textarea className={CAMPO} rows={3} value={f.descripcion} maxLength={600} onChange={poner("descripcion")} />
      </label>
      <label className={ETIQUETA}>Camino
        <select className={CAMPO} value={f.camino} onChange={poner("camino")}>
          <option value="">Elige…</option><Opciones lista={CAMINOS} />
        </select>
      </label>
      <label className={ETIQUETA}>Número que mueve
        <select className={CAMPO} value={f.numero_que_mueve} onChange={poner("numero_que_mueve")}>
          <option value="">Elige…</option>
          {numeros.map(([clave, nombre]) => <option key={clave} value={clave}>{nombre}</option>)}
        </select>
      </label>
      <label className={ETIQUETA}>Candado (número que no debe empeorar)
        <select className={CAMPO} value={f.candado} onChange={poner("candado")}>
          <option value="">Ninguno</option>
          {numeros.map(([clave, nombre]) => <option key={clave} value={clave}>{nombre}</option>)}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className={ETIQUETA}>Quién la hace</legend>
        {QUIEN.map((q) => (
          <label key={q.clave} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={f.quien.includes(q.clave)} onChange={() => alternar(q.clave)} />{q.nombre}
          </label>
        ))}
      </fieldset>
      <label className={ETIQUETA}>Cómo se mide
        <select className={CAMPO} value={f.como_se_mide} onChange={poner("como_se_mide")}>
          <option value="">Elige…</option><Opciones lista={MEDICIONES} />
        </select>
      </label>
      <label className={ETIQUETA}>Referencia al PDF
        <input className={CAMPO} value={f.referencia_pdf} maxLength={60} onChange={poner("referencia_pdf")} />
      </label>
    </Ventana>
  );
}

function MotivoRetiro({ tactica, cerrar, alGuardar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    const m = motivo.trim();
    if (m.length < 3 || m.length > 200) { setError("El motivo debe tener de 3 a 200 caracteres."); return; }
    setEnviando(true);
    setError("");
    try {
      const r = await apiFetch(`/cinco-caminos/manual/${tactica.id}/retirar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: m }),
      });
      const respuesta = await r.json();
      if (!r.ok) throw new Error(respuesta.error || "No se pudo retirar la táctica.");
      alGuardar();
    } catch (e) {
      setError(e.message || "No se pudo retirar la táctica.");
      setEnviando(false);
    }
  };
  return (
    <Ventana titulo={`Retirar: ${tactica.nombre}`} cerrar={cerrar} alEnviar={enviar} enviando={enviando} error={error}
      textoEnviar={enviando ? "Retirando…" : "Retirar"}>
      <p className={NOTA_GRIS}>La táctica no se borra: queda retirada con su motivo y se puede reactivar.</p>
      <label className={ETIQUETA}>Motivo
        <textarea className={CAMPO} rows={3} value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} />
      </label>
    </Ventana>
  );
}

function Historial({ tactica, cerrar }) {
  const [entradas, setEntradas] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`/cinco-caminos/manual/${tactica.id}/historial`);
        const cuerpo = await r.json();
        if (!r.ok) throw new Error(cuerpo.error || "No se pudo cargar el historial.");
        setEntradas(cuerpo.historial || []);
      } catch (e) {
        setError(e.message || "No se pudo cargar el historial.");
      }
    })();
  }, [tactica.id]);
  // /usuarios pide administrar_roles: no se usa. Sin catálogo de nombres, la persona sale como "Usuario #N".
  return (
    <Ventana titulo={`Historial: ${tactica.nombre}`} cerrar={cerrar} error={error}>
      {!entradas && !error && <p className="text-sm text-slate-500">Cargando…</p>}
      {entradas && entradas.length === 0 && <p className="text-sm text-slate-500">Sin movimientos.</p>}
      {entradas && (
        <ul className="space-y-2 text-sm">
          {[...entradas].reverse().map((h, i) => {
            const e = entradaHistorial(h);
            return (
              <li key={`${h.fecha_hora}-${i}`} className="border rounded-lg p-3">
                <strong>{e.accion}</strong>
                <p className={NOTA_GRIS}>{e.quien} · {new Date(e.fecha_hora).toLocaleString("es-MX")}</p>
                {e.cambios.map((c) => <p key={c} className="break-words">{c}</p>)}
              </li>
            );
          })}
        </ul>
      )}
    </Ventana>
  );
}

function Tactica({ t, puedeAdministrar, accion }) {
  return (
    <article className={`${TARJETA} ${t.activa ? "" : "opacity-70"}`} aria-label={t.nombre}>
      <div className="flex flex-wrap items-start gap-2">
        <h4 className="text-sm font-semibold text-slate-900 mr-auto">{t.numero_v1 ? `${t.numero_v1}. ` : ""}{t.nombre}</h4>
        {!t.activa && <span className={PASTILLA}>Retirada</span>}
      </div>
      {t.descripcion && <p className="text-sm text-slate-700 break-words">{t.descripcion}</p>}
      <p className={NOTA_GRIS}>Quién: {nombreQuien(t.quien)}</p>
      <p className={NOTA_GRIS}>Mueve: {nombreNumero(t.numero_que_mueve)}{t.candado ? ` · Candado: ${nombreNumero(t.candado)}` : ""}</p>
      <p className={NOTA_GRIS}>Cómo se mide: {nombreMedicion(t.como_se_mide)}{t.referencia_pdf ? ` · Hoja: ${t.referencia_pdf}` : ""}</p>
      {!t.activa && t.motivo_retiro && <p className={NOTA_GRIS}>Motivo del retiro: {t.motivo_retiro}</p>}
      <p className="text-sm text-slate-800">
        <span className={PASTILLA}>{textoEtiqueta(t.etiqueta_tienda)}</span> <span className={NOTA_GRIS}>{textoProbadaEn(t.probada_en)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BOTON} onClick={() => accion("historial", t)}>Historial</button>
        {puedeAdministrar && t.activa && <button type="button" className={BOTON} onClick={() => accion("editar", t)}>Editar</button>}
        {puedeAdministrar && t.activa && <button type="button" className={BOTON} onClick={() => accion("retirar", t)}>Retirar</button>}
        {puedeAdministrar && !t.activa && <button type="button" className={BOTON} onClick={() => accion("reactivar", t)}>Reactivar</button>}
      </div>
    </article>
  );
}

export default function ManualTacticas({ permisos = [] }) {
  const puedeAdministrar = permisos.includes("administrar_manual_tacticas");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [camino, setCamino] = useState("");
  const [retiradas, setRetiradas] = useState(false);
  const [dialogo, setDialogo] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await apiFetch("/cinco-caminos/manual");
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error || "No se pudo cargar el manual.");
      setDatos(cuerpo);
    } catch (e) {
      setError(e.message || "No se pudo cargar el manual.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const grupos = useMemo(() => agruparPorCamino(datos?.tacticas, { camino, retiradas }), [datos, camino, retiradas]);

  const reactivar = async (t) => {
    setError("");
    try {
      const r = await apiFetch(`/cinco-caminos/manual/${t.id}/reactivar`, { method: "POST" });
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error || "No se pudo reactivar la táctica.");
      cargar();
    } catch (e) {
      setError(e.message || "No se pudo reactivar la táctica.");
    }
  };
  const accion = (que, t) => (que === "reactivar" ? reactivar(t) : setDialogo({ que, t }));
  const terminar = () => { setDialogo(null); cargar(); };
  const cerrar = () => setDialogo(null);

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      <div className="flex flex-wrap gap-3 items-end">
        <label className={ETIQUETA}>Camino
          <select className={CAMPO} value={camino} onChange={(e) => setCamino(e.target.value)}>
            <option value="">Todos</option>
            {CAMINOS.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 py-2">
          <input type="checkbox" checked={retiradas} onChange={(e) => setRetiradas(e.target.checked)} />Mostrar retiradas
        </label>
        {puedeAdministrar && <button type="button" className={`${BOTON_AZUL} ml-auto`} onClick={() => setDialogo({ que: "nueva" })}>Nueva táctica</button>}
      </div>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {cargando && !datos && <p className="text-sm text-slate-500">Cargando…</p>}
      {datos && grupos.length === 0 && <p className="text-sm text-slate-500">No hay tácticas con ese filtro.</p>}
      {grupos.map((g) => (
        <section key={g.camino} className="space-y-2" aria-label={nombreCamino(g.camino)}>
          <h3 className="text-sm font-bold uppercase text-slate-600">{g.nombre}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.tacticas.map((t) => <Tactica key={t.id} t={t} puedeAdministrar={puedeAdministrar} accion={accion} />)}
          </div>
        </section>
      ))}
      {datos?.excluidas_texto && (
        <section className={TARJETA} aria-label="Excluidas a propósito">
          <h3 className="text-sm font-semibold text-slate-900">Excluidas a propósito</h3>
          <p className="text-sm text-slate-700">{datos.excluidas_texto}</p>
        </section>
      )}
      {dialogo?.que === "nueva" && <FormularioTactica cerrar={cerrar} alGuardar={terminar} />}
      {dialogo?.que === "editar" && <FormularioTactica tactica={dialogo.t} cerrar={cerrar} alGuardar={terminar} />}
      {dialogo?.que === "retirar" && <MotivoRetiro tactica={dialogo.t} cerrar={cerrar} alGuardar={terminar} />}
      {dialogo?.que === "historial" && <Historial tactica={dialogo.t} cerrar={cerrar} />}
    </div>
  );
}
