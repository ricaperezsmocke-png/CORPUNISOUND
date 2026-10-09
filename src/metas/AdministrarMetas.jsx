import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { Campo, Modal } from "../objetivos/DialogosObjetivos";
import { TEXTO_PRUEBA, cuerpoMeta, etiquetaPeriodo } from "./metas";
import { ALERTA, DialogoMotivo, ENLACE, ENLACE_ROJO, EXITO, TARJETA, fechaHora } from "./Comunes";
import SelloMetas from "./SelloMetas";

const BOTON = "bg-blue-600 text-white rounded-lg px-4 py-2 text-sm";
const SEGMENTO = "px-3 py-1.5 text-sm rounded-lg border";
const ACTIVO = `${SEGMENTO} bg-blue-600 border-blue-600 text-white`;
const INACTIVO = `${SEGMENTO} border-slate-300 text-slate-700 bg-white`;
const SELECT = "block neu-campo rounded-lg px-3 py-2 mt-1 w-full";
const ALCANCES = { tienda: "Una tienda", persona: "Una persona", empresa: "Toda la empresa" };
const PRUEBAS = { liga: "Liga", foto: "Foto", ninguna: "Sin prueba" };

function Segmentos({ etiqueta, opciones, valor, cambiar }) {
  return (
    <div className="text-sm">
      <p className="mb-1">{etiqueta}</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label={etiqueta}>
        {Object.entries(opciones).map(([clave, texto]) => (
          <button key={clave} type="button" aria-pressed={valor === clave} className={valor === clave ? ACTIVO : INACTIVO}
            onClick={() => cambiar(clave)}>{texto}</button>
        ))}
      </div>
    </div>
  );
}

// "¿Para quién?": una tienda, una persona o toda la empresa (con sus participantes).
function ParaQuien({ form, cambiar, sucursales, vendedores }) {
  const alternar = (id) => cambiar("participantes")(form.participantes.includes(id)
    ? form.participantes.filter((p) => p !== id) : [...form.participantes, id]);
  return (
    <>
      <Segmentos etiqueta="¿Para quién?" opciones={ALCANCES} valor={form.alcance} cambiar={cambiar("alcance")} />
      {form.alcance === "tienda" && (
        <label className="text-sm block">Tienda
          <select className={SELECT} value={form.sucursal_id} onChange={(e) => cambiar("sucursal_id")(e.target.value)}>
            <option value="">Elige la tienda</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
      )}
      {form.alcance === "persona" && (
        <label className="text-sm block">Persona
          <select className={SELECT} value={form.vendedor_id} onChange={(e) => cambiar("vendedor_id")(e.target.value)}>
            <option value="">Elige a la persona</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </label>
      )}
      {form.alcance === "empresa" && (
        <fieldset className="text-sm">
          <legend className="mb-1">¿Quiénes participan?</legend>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {vendedores.map((v) => (
              <label key={v.id} className="flex gap-2 items-center">
                <input type="checkbox" checked={form.participantes.includes(String(v.id))} onChange={() => alternar(String(v.id))} />
                {v.nombre}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

const alcanceCompleto = (f) => (f.alcance === "tienda" && f.sucursal_id) || (f.alcance === "persona" && f.vendedor_id) ||
  (f.alcance === "empresa" && f.participantes.length > 0);
// Solo el "para quién" de un formulario, con los ids como número.
function alcanceDe(f) {
  if (f.alcance === "tienda") return { alcance: "tienda", sucursal_id: Number(f.sucursal_id) };
  if (f.alcance === "persona") return { alcance: "persona", vendedor_id: Number(f.vendedor_id) };
  return { alcance: "empresa", participantes: f.participantes.map(Number) };
}
const FORM_VACIO = { titulo: "", descripcion: "", nombre: "", unidad: "", prueba: "liga", valor_meta: "", okr_clave: "",
  alcance: "tienda", sucursal_id: "", vendedor_id: "", participantes: [], motivo: "" };

// Crear o editar un OKR o una meta. Al editar solo se mandan los campos que cambiaron, más el motivo.
function DialogoEdicion({ tipo, registro, okrs, periodo, inicio, sucursales, vendedores, cerrar, alTerminar }) {
  const editando = Boolean(registro);
  const [form, setForm] = useState(() => (registro ? { ...FORM_VACIO, ...registro, valor_meta: String(registro.valor_meta ?? ""),
    descripcion: registro.descripcion || "", motivo: "" } : FORM_VACIO));
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const esOkr = tipo === "okr";
  const listo = editando ? form.motivo.trim() : esOkr
    ? form.titulo.trim() && alcanceCompleto(form)
    : form.nombre.trim() && form.unidad.trim() && Number(form.valor_meta) >= 1 && (form.okr_clave || alcanceCompleto(form));

  const cuerpo = () => {
    if (!editando) {
      return esOkr ? { titulo: form.titulo, descripcion: form.descripcion || undefined, periodo, inicio, ...alcanceDe(form) }
        : cuerpoMeta({ ...form, periodo, inicio });
    }
    const campos = esOkr ? ["titulo", "descripcion"] : ["nombre", "descripcion", "unidad", "prueba", "valor_meta"];
    const cambios = Object.fromEntries(campos
      .map((c) => [c, c === "valor_meta" ? Number(form[c]) : form[c]])
      .filter(([c, v]) => v !== (registro[c] ?? "")));
    return { ...cambios, motivo: form.motivo.trim() };
  };
  const guardar = async () => {
    if (enviando || !listo) return;
    setEnviando(true);
    setError("");
    const base = esOkr ? "/metas/okr" : "/metas";
    try {
      await apiFetch(editando ? `${base}/${registro.clave}/editar` : base, { method: "POST", body: JSON.stringify(cuerpo()) })
        .then((r) => leer(r, "No se pudo guardar"));
      await alTerminar(editando ? "Cambio guardado." : esOkr ? "OKR creado." : "Meta creada.");
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  const titulo = `${editando ? "Editar" : "Nuevo"} ${esOkr ? "OKR" : "meta"}`.replace("Nuevo meta", "Nueva meta");
  return (
    <Modal titulo={titulo} cerrar={cerrar} guardar={guardar} deshabilitado={enviando || !listo} error={error}>
      {!editando && <p className="text-sm text-slate-500">Periodo: {etiquetaPeriodo(periodo, inicio)}</p>}
      {esOkr ? <Campo etiqueta="Objetivo" valor={form.titulo} cambiar={cambiar("titulo")} /> : (
        <>
          {!editando && okrs.length > 0 && (
            <label className="text-sm block">¿Pertenece a un OKR?
              <select className={SELECT} value={form.okr_clave} onChange={(e) => cambiar("okr_clave")(e.target.value)}>
                <option value="">Ninguno</option>
                {okrs.map((o) => <option key={o.clave} value={o.clave}>{o.titulo}</option>)}
              </select>
            </label>
          )}
          <Campo etiqueta="Nombre (ej. Videos de tips)" valor={form.nombre} cambiar={cambiar("nombre")} />
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Cifra meta" tipo="number" min="1" valor={form.valor_meta} cambiar={cambiar("valor_meta")} />
            <Campo etiqueta="Unidad (ej. videos)" valor={form.unidad} cambiar={cambiar("unidad")} />
          </div>
          <Segmentos etiqueta="¿Qué prueba pide?" opciones={PRUEBAS} valor={form.prueba} cambiar={cambiar("prueba")} />
        </>
      )}
      <Campo etiqueta="Descripción (opcional)" valor={form.descripcion} cambiar={cambiar("descripcion")} area />
      {!editando && (esOkr || !form.okr_clave) && (
        <ParaQuien form={form} cambiar={cambiar} sucursales={sucursales} vendedores={vendedores} />
      )}
      {editando && <Campo etiqueta="Motivo del cambio" valor={form.motivo} cambiar={cambiar("motivo")} area />}
    </Modal>
  );
}

function Historial({ registro, cerrar }) {
  const [versiones, setVersiones] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiFetch(`/metas/${registro.clave}/historial`).then((r) => leer(r, "No se pudo cargar el historial"))
      .then(setVersiones).catch((e) => setError(e.message));
  }, [registro.clave]);
  return (
    <Modal titulo={`Historial: ${registro.nombre}`} cerrar={cerrar} guardar={cerrar} textoGuardar="Cerrar" textoCerrar="Volver" error={error}>
      {!versiones ? <p className="text-sm text-slate-500">Cargando…</p> : (
        <ul className="space-y-2 text-sm">
          {versiones.map((v) => (
            <li key={v.id} className="border rounded-lg p-3">
              <strong>Versión {v.version}: {v.valor_meta} {v.unidad} — {v.nombre}</strong>
              <p className="text-slate-500">{v.creado_por} · {fechaHora(v.creado_en)}</p>
              {v.motivo && <p>Motivo: {v.motivo}</p>}
              {v.retirada && (
                <p className="text-red-700">Eliminada por {v.retirada.por_nombre} · {fechaHora(v.retirada.en)} · Motivo: {v.retirada.motivo}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

const paraQuien = (r, sucursales, vendedores) => {
  if (r.alcance === "tienda") return sucursales.find((s) => s.id === r.sucursal_id)?.nombre || "Tienda";
  if (r.alcance === "persona") return vendedores.find((v) => v.id === r.vendedor_id)?.nombre || "Persona";
  return `Empresa (${r.participantes.length} personas)`;
};

// Administrar: crear, editar y eliminar OKRs y metas. Lo eliminado sigue a la vista (decisión de Victor 2026-10-08).
export default function AdministrarMetas({ periodo, inicio, hoy, sucursales, vendedores }) {
  const [datos, setDatos] = useState(null);
  const [sello, setSello] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [verEliminadas, setVerEliminadas] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    const base = `periodo=${periodo}&inicio=${inicio}`;
    try {
      setDatos(await apiFetch(`/metas/admin?${base}`).then((r) => leer(r, "No se pudieron cargar las metas")));
      const r = await apiFetch(`/metas/sello?${base}`);
      setSello(r.status === 404 ? null : await leer(r, "No se pudo consultar el sello"));
    } catch (e) { setError(e.message); }
  }, [periodo, inicio]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!datos) return error ? <div role="alert" className={ALERTA}>{error}</div> : <p className="text-sm text-slate-500">Cargando…</p>;
  const okrs = datos.okrs.filter((o) => o.vigente);
  const metas = datos.metas.filter((m) => m.vigente);
  const eliminadas = [...datos.okrs.filter((o) => o.retirada).map((o) => ({ ...o, nombre: o.titulo, esOkr: true })),
    ...datos.metas.filter((m) => m.retirada)];
  const grupos = [...okrs.map((o) => ({ okr: o, metas: metas.filter((m) => m.okr_clave === o.clave) })),
    { okr: null, metas: metas.filter((m) => m.okr_clave == null) }];
  const abierto = !sello;
  const terminar = async (mensaje) => { setDialogo(null); setExito(mensaje); await cargar(); };
  const comunes = { okrs, periodo, inicio, sucursales, vendedores, cerrar: () => setDialogo(null), alTerminar: terminar };

  const Acciones = ({ registro, esOkr }) => (
    <span className="flex gap-3 text-sm shrink-0">
      {abierto && <button type="button" className={ENLACE} onClick={() => setDialogo({ tipo: esOkr ? "okr" : "meta", registro })}>Editar</button>}
      {!esOkr && <button type="button" className={ENLACE} onClick={() => setDialogo({ tipo: "historial", registro })}>Historial</button>}
      {abierto && <button type="button" className={ENLACE_ROJO} onClick={() => setDialogo({ tipo: "eliminar", registro, esOkr })}>Eliminar</button>}
    </span>
  );

  return (
    <div className="space-y-4">
      <SelloMetas periodo={periodo} inicio={inicio} hoy={hoy} sello={sello} sucursales={sucursales} vendedores={vendedores}
        alCambiar={cargar} />
      {error && <div role="alert" className={ALERTA}>{error}</div>}
      {exito && <div className={EXITO}>{exito}</div>}
      {abierto && (
        <div className="flex gap-2">
          <button type="button" className={BOTON} onClick={() => { setExito(""); setDialogo({ tipo: "okr" }); }}>+ Nuevo OKR</button>
          <button type="button" className={BOTON} onClick={() => { setExito(""); setDialogo({ tipo: "meta" }); }}>+ Nueva meta</button>
        </div>
      )}
      {!okrs.length && !metas.length && <p className="text-sm text-slate-500">Todavía no hay metas en este periodo.</p>}
      {grupos.filter((g) => g.okr || g.metas.length).map(({ okr, metas: suyas }) => (
        <section key={okr ? okr.clave : "sueltas"} className={TARJETA}>
          <header className="flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-slate-800">{okr ? okr.titulo : "Otras metas"}</h3>
              {okr && <p className="text-xs text-slate-500">{paraQuien(okr, sucursales, vendedores)}{okr.descripcion ? ` · ${okr.descripcion}` : ""}</p>}
            </div>
            {okr && <Acciones registro={okr} esOkr />}
          </header>
          {suyas.length ? (
            <ul className="divide-y divide-slate-100">
              {suyas.map((m) => (
                <li key={m.clave} className="flex gap-3 items-center py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <strong className="text-slate-800">{m.nombre}</strong>
                    <span className="text-slate-500"> · {m.valor_meta} {m.unidad} · {TEXTO_PRUEBA[m.prueba]} · {paraQuien(m, sucursales, vendedores)}</span>
                  </div>
                  <Acciones registro={m} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Este OKR todavía no tiene metas.</p>}
        </section>
      ))}
      {eliminadas.length > 0 && (
        <section className="space-y-2">
          <button type="button" className={`${ENLACE} text-sm`} aria-expanded={verEliminadas} onClick={() => setVerEliminadas(!verEliminadas)}>
            Eliminadas en este periodo ({eliminadas.length})
          </button>
          {verEliminadas && (
            <ul className="space-y-2 text-sm">
              {eliminadas.map((r) => (
                <li key={`${r.esOkr ? "okr" : "meta"}-${r.id}`} className="border rounded-lg p-3 bg-slate-50">
                  <div className="flex gap-3 items-center">
                    <del className="flex-1 text-slate-600">{r.esOkr ? "OKR: " : ""}{r.nombre}</del>
                    {!r.esOkr && <button type="button" className={ENLACE} onClick={() => setDialogo({ tipo: "historial", registro: r })}>Historial</button>}
                  </div>
                  <p className="text-red-700">Eliminada por {r.retirada.por_nombre} · {fechaHora(r.retirada.en)} · Motivo: {r.retirada.motivo}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(dialogo?.tipo === "okr" || dialogo?.tipo === "meta") && <DialogoEdicion tipo={dialogo.tipo} registro={dialogo.registro} {...comunes} />}
      {dialogo?.tipo === "historial" && <Historial registro={dialogo.registro} cerrar={() => setDialogo(null)} />}
      {dialogo?.tipo === "eliminar" && (
        <DialogoMotivo titulo={`Eliminar ${dialogo.esOkr ? "OKR" : "meta"}: ${dialogo.registro.titulo || dialogo.registro.nombre}`}
          textoGuardar="Eliminar" cerrar={() => setDialogo(null)}
          ruta={`/metas/${dialogo.esOkr ? "okr/" : ""}${dialogo.registro.clave}/retirar`}
          explicacion={`Deja de contar desde hoy. Queda en el historial con tu nombre y el motivo.${dialogo.esOkr
            ? ` También se eliminan sus ${metas.filter((m) => m.okr_clave === dialogo.registro.clave).length} metas.` : ""}`}
          alTerminar={() => terminar("Se eliminó. Quedó en el historial.")} />
      )}
    </div>
  );
}
