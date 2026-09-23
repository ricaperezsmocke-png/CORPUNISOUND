import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { diasDeAtraso, leer } from "./datos";

const campo = "block neu-campo rounded-lg px-3 py-2 w-full min-w-0 mt-1";
const boton = "bg-blue-600 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40";
const enlace = "text-blue-600 hover:underline disabled:opacity-40";
const aviso = "bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm break-words";
const consultaClase = (actividad) => `?tipo=actividad&actividad=${encodeURIComponent(actividad)}`;

export default function ActividadesGerente({ mes, sucursalId, objetivos, nombre, actualizar }) {
  const [datos, setDatos] = useState(null);
  const [revision, setRevision] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [errorLista, setErrorLista] = useState("");
  const [dialogo, setDialogo] = useState(null);
  const [sugerencias, setSugerencias] = useState({});
  const [persona, setPersona] = useState("");
  const [clase, setClase] = useState("");
  const enCurso = useRef(false);
  const montado = useRef(false);
  const cerrado = objetivos.cerrado;
  const clases = objetivos.actividades || [];
  const raiz = `/objetivos/${mes}/${sucursalId}`;

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setErrorLista("");
    apiFetch(`${raiz}/actividades`).then((r) => leer(r, "No se pudieron cargar las actividades de la tienda"))
      .then((resultado) => { if (vigente) setDatos(resultado); })
      .catch((e) => {
        if (!vigente) return;
        setDatos(null);
        setErrorLista(e.message);
      }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [raiz, revision]);

  const consultar = async (accion) => {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    setError("");
    try { await accion(); } catch (e) { if (montado.current) setError(e.message); }
    finally {
      enCurso.current = false;
      if (montado.current) setOcupado(false);
    }
  };

  const abrirMeta = (reparto, vendedorId, monto, historial = false) => consultar(async () => {
    if (cerrado && !historial) return;
    const versiones = await apiFetch(`${raiz}/historial/${vendedorId == null ? "tienda" : vendedorId}${consultaClase(reparto.actividad)}`)
      .then((r) => leer(r, "No se pudo cargar el historial de la meta de actividad"));
    if (!montado.current) return;
    setDialogo({
      reparto, vendedorId, monto, versiones, historial,
      titulo: `${reparto.etiqueta} · ${vendedorId == null ? "Tienda" : nombre(vendedorId)}`,
    });
  });

  const sugerir = (actividad) => consultar(async () => {
    if (cerrado) return;
    const lineas = await apiFetch(`${raiz}/sugerencia${consultaClase(actividad)}`)
      .then((r) => leer(r, "No se pudo calcular el reparto sugerido"));
    if (montado.current) setSugerencias((anteriores) => ({ ...anteriores, [actividad]: lineas }));
  });

  const guardar = async (monto, motivo) => {
    if (cerrado) throw new Error("Este mes está cerrado. Ya no se pueden cambiar metas.");
    if (enCurso.current) throw new Error("Espera a que termine la operación en curso.");
    enCurso.current = true;
    setOcupado(true);
    try {
      await apiFetch("/objetivos", {
        method: "POST",
        body: JSON.stringify({
          tipo: "actividad", actividad: dialogo.reparto.actividad, mes, sucursal_id: Number(sucursalId),
          vendedor_id: dialogo.vendedorId == null ? null : Number(dialogo.vendedorId), monto,
          ...(dialogo.versiones.length ? { motivo } : {}),
        }),
      }).then((r) => leer(r, "No se pudo guardar la meta de actividad"));
      if (!montado.current) return;
      // La escritura ya terminó: cerrar antes de recargar evita invitar a guardarla dos veces.
      setDialogo(null);
      await actualizar();
    } finally {
      enCurso.current = false;
      if (montado.current) setOcupado(false);
    }
  };

  const personas = [...new Set([
    ...objetivos.plantilla.map((item) => item.vendedor_id),
    ...(datos?.registros || []).map((item) => item.vendedor_id),
  ].map(Number))];
  const registros = (datos?.registros || []).filter((item) =>
    (!persona || Number(item.vendedor_id) === Number(persona)) && (!clase || item.actividad === clase));

  return (
    <section className="neu rounded-xl p-4 space-y-4 min-w-0 max-w-full">
      <div>
        <h2 className="font-semibold text-slate-700">Actividades de la tienda</h2>
        <p className="text-sm text-amber-800">Declaradas, no verificadas</p>
      </div>
      {cerrado && <p className="text-sm text-amber-800">Mes cerrado: las actividades y sus metas son de solo lectura.</p>}
      {error && <p role="alert" className={aviso}>{error}</p>}
      {clases.map((reparto) => (
        <RepartoActividad key={reparto.actividad} reparto={reparto} datos={datos} nombre={nombre}
          cerrado={cerrado} ocupado={ocupado} sugerencia={sugerencias[reparto.actividad]}
          abrir={abrirMeta} sugerir={() => sugerir(reparto.actividad)} />
      ))}
      <div className="border-t border-slate-100 pt-4 space-y-3 min-w-0">
        <h3 className="font-medium text-slate-700">Registros del mes</h3>
        <p className="text-sm text-amber-800">Declaradas, no verificadas</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="block min-w-0">
            Persona
            <select className={campo} value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">Todas las personas</option>
              {personas.map((id) => <option key={id} value={id}>{nombre(id)}</option>)}
            </select>
          </label>
          <label className="block min-w-0">
            Clase de actividad
            <select className={campo} value={clase} onChange={(e) => setClase(e.target.value)}>
              <option value="">Todas las clases</option>
              {clases.map((item) => <option key={item.actividad} value={item.actividad}>{item.etiqueta}</option>)}
            </select>
          </label>
        </div>
        {cargando && <p role="status" className="text-sm text-slate-500">Cargando actividades…</p>}
        {errorLista && (
          <div className="space-y-2">
            <p role="alert" className={aviso}>{errorLista}</p>
            <button type="button" onClick={() => setRevision((valor) => valor + 1)} className={boton}>Reintentar</button>
          </div>
        )}
        {!cargando && datos && !registros.length && (
          <p className="text-sm text-slate-500">
            {datos.registros.length ? "No hay registros con estos filtros." : "Todavía no hay actividades registradas."}
          </p>
        )}
        {registros.map((registro) => (
          <RegistroTienda key={registro.id} registro={registro} nombre={nombre(registro.vendedor_id)}
            etiqueta={clases.find((item) => item.actividad === registro.actividad)?.etiqueta || registro.actividad} />
        ))}
      </div>
      {dialogo && (dialogo.historial || !cerrado) && (
        <DialogoMetaActividad dialogo={dialogo} guardar={guardar} ocupado={ocupado} cerrar={() => setDialogo(null)} />
      )}
    </section>
  );
}

function RepartoActividad({ reparto, datos, nombre, cerrado, ocupado, sugerencia, abrir, sugerir }) {
  const resumen = datos?.resumen_tienda.find((item) => item.actividad === reparto.actividad);
  return (
    <article className="border border-slate-200 rounded-lg p-3 space-y-3 min-w-0 text-sm">
      <h3 className="font-medium text-slate-700">{reparto.etiqueta}</h3>
      <p className="text-amber-800">Declaradas, no verificadas</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <span>Meta de tienda: <strong>{reparto.meta_tienda}</strong></span>
        <span>Asignado: <strong>{reparto.asignado}</strong></span>
        <span className={reparto.sin_asignar !== 0 ? "text-red-700" : "text-slate-600"}>
          Sin asignar: <strong>{reparto.sin_asignar}</strong>
        </span>
        <span>Declaradas en tienda: <strong>{resumen?.declaradas ?? "—"}</strong></span>
      </div>
      <p className="text-slate-500">Una actividad conjunta cuenta una sola vez para la tienda.</p>
      <div className="flex flex-wrap gap-3 items-center">
        {!cerrado && (
          <>
            <button type="button" disabled={ocupado} className={boton}
              onClick={() => abrir(reparto, null, reparto.meta_tienda)}>Fijar meta de tienda</button>
            <button type="button" disabled={ocupado} className={enlace} onClick={sugerir}>Sugerir partes iguales</button>
          </>
        )}
        <button type="button" disabled={ocupado} className={enlace}
          onClick={() => abrir(reparto, null, reparto.meta_tienda, true)}>Historial de tienda</button>
      </div>
      {!cerrado && sugerencia && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
          <h4 className="font-medium">Reparto sugerido · Declaradas, no verificadas</h4>
          <p>La sugerencia no guarda cambios. Revisa y guarda cada parte.</p>
          {sugerencia.length ? (
            <ul className="space-y-2">
              {sugerencia.map((linea) => (
                <li key={linea.vendedor_id} className="flex flex-wrap gap-2 justify-between">
                  <span className="break-words min-w-0">{nombre(linea.vendedor_id)}: {linea.monto}</span>
                  <button type="button" disabled={ocupado} className={enlace}
                    onClick={() => abrir(reparto, linea.vendedor_id, linea.monto)}>Usar sugerencia</button>
                </li>
              ))}
            </ul>
          ) : <p>Primero fija la meta de tienda y registra la plantilla del mes.</p>}
        </div>
      )}
      <div className="overflow-x-auto max-w-full">
        <table className="w-full text-sm min-w-[560px]">
          <caption className="text-left text-amber-800 pb-2">Reparto por persona · Declaradas, no verificadas</caption>
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2">Persona</th><th>Meta</th><th>Declaradas</th><th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {reparto.lineas.map((linea) => {
              const persona = datos?.resumen_por_persona.find((item) => Number(item.vendedor_id) === Number(linea.vendedor_id));
              const declaradas = persona?.resumen.find((item) => item.actividad === reparto.actividad)?.declaradas ?? 0;
              return (
                <tr key={linea.vendedor_id} className="border-b border-slate-100">
                  <td className="py-2">{nombre(linea.vendedor_id)}</td><td>{linea.monto}</td><td>{datos ? declaradas : "—"}</td>
                  <td className="text-right space-x-3">
                    {!cerrado && (
                      <button type="button" disabled={ocupado} className={enlace}
                        onClick={() => abrir(reparto, linea.vendedor_id, linea.monto)}>Editar parte</button>
                    )}
                    <button type="button" disabled={ocupado} className={enlace}
                      onClick={() => abrir(reparto, linea.vendedor_id, linea.monto, true)}>Historial</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!reparto.lineas.length && <p className="text-slate-500">Todavía no hay personas en la plantilla del mes.</p>}
    </article>
  );
}

function RegistroTienda({ registro, nombre, etiqueta }) {
  const evidencia = registro.evidencia;
  const atraso = diasDeAtraso({ fecha: registro.fecha, capturado_en: registro.registrado_en });
  return (
    <article className="border border-slate-200 rounded-lg p-3 text-sm space-y-2 min-w-0 break-words">
      <div className={registro.vigente ? "space-y-2" : "space-y-2 line-through text-slate-500"}>
        <h4 className="font-medium">{nombre} · {registro.fecha} · {etiqueta}</h4>
        <p className="text-amber-800">Declaradas, no verificadas</p>
        {registro.conjunta_con != null && <p className="font-medium text-amber-800">Conjunta</p>}
        {atraso > 0 && <p className="text-amber-800">registrado {atraso} {atraso === 1 ? "día" : "días"} después</p>}
        <a href={evidencia.tipo === "foto" ? evidencia.drive_link : evidencia.link}
          target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
          {evidencia.tipo === "foto" ? "Ver foto" : evidencia.link}
        </a>
        {registro.nota && <p>{registro.nota}</p>}
        <div className="space-y-2">
          <h5 className="font-medium">Resultados · Declaradas, no verificadas</h5>
          {!registro.resultados.length && <p className="text-slate-500">Sin resultados registrados.</p>}
          {registro.resultados.map((resultado, indice) => (
            <div key={indice}>
              <p>{indice === registro.resultados.length - 1 ? "Último resultado" : "Resultado anterior"}</p>
              <p>Contactos: {resultado.contactos} · Cotizaciones: {resultado.cotizaciones}</p>
              {resultado.nota && <p>{resultado.nota}</p>}
              <p className="text-slate-500">
                {resultado.registrado_por} · {new Date(resultado.registrado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}
              </p>
            </div>
          ))}
        </div>
      </div>
      {!registro.vigente && <p className="text-red-800">Anulada: {registro.motivo_anulacion}</p>}
    </article>
  );
}

function DialogoMetaActividad({ dialogo, guardar, ocupado, cerrar }) {
  const [monto, setMonto] = useState(String(dialogo.monto));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const existente = dialogo.versiones.length > 0;
  const valido = monto.trim() !== "" && Number.isInteger(Number(monto)) && Number(monto) >= 0 && (!existente || motivo.trim());
  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado || !valido) return;
    setError("");
    try { await guardar(Number(monto), motivo.trim()); } catch (fallo) { setError(fallo.message); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={dialogo.titulo}
        className="bg-white rounded-xl p-5 w-full max-w-lg max-h-[85dvh] overflow-y-auto space-y-3 min-w-0 break-words">
        <h3 className="font-semibold">{dialogo.historial ? "Historial" : "Fijar meta"}: {dialogo.titulo}</h3>
        <p className="text-sm text-amber-800">Declaradas, no verificadas</p>
        {dialogo.historial ? (
          <>
            {dialogo.versiones.length ? (
              <ul className="space-y-2 text-sm">
                {dialogo.versiones.map((version) => (
                  <li key={version.id} className="border rounded-lg p-3">
                    <strong>Versión {version.version}: {version.monto} unidades</strong>
                    <p className="text-slate-500">
                      {version.creado_por} · {new Date(version.creado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}
                    </p>
                    {version.motivo && <p>Motivo: {version.motivo}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Todavía no hay versiones.</p>}
            <button type="button" onClick={cerrar} className="border rounded-lg px-4 py-2">Cerrar</button>
          </>
        ) : (
          <form onSubmit={enviar} className="space-y-3 text-sm">
            <fieldset disabled={ocupado} className="space-y-3 min-w-0">
              <label className="block">
                Meta (unidades enteras)
                <input autoFocus type="number" min="0" step="1" required value={monto}
                  onChange={(e) => setMonto(e.target.value)} className={campo} />
              </label>
              {existente && (
                <label className="block">
                  Motivo obligatorio
                  <textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
                </label>
              )}
              <div className="flex flex-wrap justify-end gap-3">
                <button type="button" onClick={cerrar}>Cancelar</button>
                <button type="submit" disabled={!valido} className={boton}>{ocupado ? "Guardando…" : "Guardar meta"}</button>
              </div>
            </fieldset>
            {error && <p role="alert" className={aviso}>{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
