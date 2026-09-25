import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { diasDeAtraso, estadoReparto, fechaCorta, filasReparto, leer, periodoEnTienda, sugerenciaGuardada } from "./datos";
import { declaradasPorPersona, presentacionMetaActividad, ultimoResultado } from "./actividades";

const campo = "block neu-campo rounded-lg px-3 py-2 w-full min-w-0 mt-1";
const boton = "bg-blue-600 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40";
const enlace = "text-blue-600 hover:underline disabled:opacity-40";
const aviso = "bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm break-words";
const consultaClase = (actividad) => `?tipo=actividad&actividad=${encodeURIComponent(actividad)}`;
const celda = "px-3 py-3 align-top";
const fila = "border-b border-slate-100 odd:bg-white even:bg-blue-50";
const tonos = { falta: "text-amber-800", completo: "text-emerald-700", exceso: "text-red-700", sin_meta: "text-slate-500" };

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
      if (dialogo.vendedorId == null) {
        setSugerencias((anteriores) => {
          const vigentes = { ...anteriores };
          delete vigentes[dialogo.reparto.actividad];
          return vigentes;
        });
      }
      // La escritura ya terminó: cerrar antes de recargar evita invitar a guardarla dos veces.
      setDialogo(null);
      await actualizar({ silenciosa: true });
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
      <h2 className="font-semibold text-slate-700">Metas de actividades · declaradas, no verificadas</h2>
      {cerrado && <p className="text-sm text-amber-800">Mes cerrado: las actividades y sus metas son de solo lectura.</p>}
      {error && <p role="alert" className={aviso}>{error}</p>}
      <div className="overflow-x-auto max-w-full">
        <table className="w-full min-w-[800px] text-sm text-left">
          <thead className="bg-blue-600 text-white">
            <tr>
              <th className={celda}>Actividad</th><th className={celda}>Meta tienda</th><th className={celda}>Asignado</th>
              <th className={celda}>Reparto</th><th className={celda}>Declaradas en tienda</th>
            </tr>
          </thead>
          {clases.map((reparto, indice) => (
            <RepartoActividad key={reparto.actividad} reparto={reparto} datos={datos} nombre={nombre}
              plantilla={objetivos.plantilla} alterna={indice % 2 === 1}
              cerrado={cerrado} ocupado={ocupado} sugerencia={sugerencias[reparto.actividad]}
              abrir={abrirMeta} sugerir={() => sugerir(reparto.actividad)} />
          ))}
        </table>
      </div>
      <div className="border-t border-slate-100 pt-4 space-y-3 min-w-0">
        <h3 className="font-medium text-slate-700">Registros del mes · declaradas, no verificadas</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="block min-w-0">
            Persona
            <select className={campo} value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">Todas las personas</option>
              {personas.map((id) => <option key={id} value={id}>{nombre(id)}</option>)}
            </select>
          </label>
          <label className="block min-w-0">
            Actividad
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
        <div className="overflow-x-auto max-w-full">
          <table className="w-full min-w-[900px] text-sm text-left">
            <thead className="bg-blue-600 text-white">
              <tr>
                <th className={celda}>Persona</th><th className={celda}>Fecha</th><th className={celda}>Actividad</th>
                <th className={celda}>Evidencia</th><th className={celda}>Último resultado</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((registro) => (
                <RegistroTienda key={registro.id} registro={registro} nombre={nombre(registro.vendedor_id)}
                  etiqueta={clases.find((item) => item.actividad === registro.actividad)?.etiqueta || registro.actividad} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {dialogo && (dialogo.historial || !cerrado) && (
        <DialogoMetaActividad dialogo={dialogo} guardar={guardar} ocupado={ocupado} cerrar={() => setDialogo(null)} />
      )}
    </section>
  );
}

function RepartoActividad({ reparto, datos, plantilla, alterna, nombre, cerrado, ocupado, sugerencia, abrir, sugerir }) {
  const [desplegada, setDesplegada] = useState(false);
  const { declaradas, inactiva } = presentacionMetaActividad(reparto, datos);
  const estado = estadoReparto({ meta: reparto.meta_tienda, sinAsignar: reparto.sin_asignar, unidad: "unidades" });
  const personas = filasReparto({ plantilla, lineas: reparto.lineas });
  const mostrarSugerencia = sugerencia !== undefined;
  const fondo = alterna ? "bg-blue-50" : "bg-white";
  const detalleId = `detalle-actividad-${reparto.actividad}`;
  return (
    <tbody>
      <tr className={`border-b border-slate-100 cursor-pointer ${fondo} ${inactiva ? "text-slate-500" : ""}`}
        onClick={() => setDesplegada(!desplegada)}>
        <th scope="row" className={`${celda} font-medium`}>
          <button type="button" aria-expanded={desplegada} aria-controls={detalleId} className="text-left w-full"
            onClick={(e) => { e.stopPropagation(); setDesplegada(!desplegada); }}>
            <span aria-hidden="true">{desplegada ? "▾" : "▸"}</span> {reparto.etiqueta}
          </button>
        </th>
        <td className={celda}>{inactiva ? "—" : reparto.meta_tienda}</td>
        <td className={celda}>{inactiva ? "—" : reparto.asignado}</td>
        <td className={`${celda} ${inactiva ? "" : tonos[estado.tono]}`}>{inactiva ? "—" : estado.texto}</td>
        <td className={celda}>{inactiva ? "—" : declaradas ?? "—"}</td>
      </tr>
      {desplegada && (
        <tr id={detalleId}>
          <td colSpan={5} className="p-4 bg-slate-50">
            <div className="space-y-3">
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
              <p className="text-slate-500">Una actividad conjunta cuenta una sola vez para la tienda.</p>
              {mostrarSugerencia && <p>La sugerencia no guarda nada: usa "Usar" en cada persona.</p>}
              {mostrarSugerencia && !sugerencia.length && <p>Primero fija la meta de tienda y registra el personal del mes.</p>}
              {personas.length ? (
                <table className="w-full text-sm text-left">
                  <thead className="bg-blue-600 text-white">
                    <tr>
                      <th className={celda}>Persona</th><th className={celda}>Meta</th><th className={celda}>Declaradas</th>
                      {mostrarSugerencia && <th className={celda}>Sugerida</th>}
                      <th className={celda}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personas.map((persona) => (
                      <ParteActividad key={persona.vendedor_id} persona={persona} reparto={reparto} datos={datos} nombre={nombre}
                        cerrado={cerrado} ocupado={ocupado} sugerencia={sugerencia} abrir={abrir} />
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-slate-500">Todavía no hay personas en el personal del mes.</p>}
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

function ParteActividad({ persona, reparto, datos, nombre, cerrado, ocupado, sugerencia, abrir }) {
  const sugerida = sugerencia?.find((item) => Number(item.vendedor_id) === persona.vendedor_id);
  const periodo = periodoEnTienda(persona);
  return (
    <tr className={fila}>
      <td className={`${celda} max-w-xs break-words`}>
        <p>{nombre(persona.vendedor_id)}</p>
        {periodo && <p className="text-slate-500">{periodo}</p>}
      </td>
      <td className={celda}>{persona.monto ?? "—"}</td>
      <td className={celda}>{declaradasPorPersona(datos, persona.vendedor_id, reparto.actividad) ?? "—"}</td>
      {sugerencia !== undefined && (
        <td className={celda}>
          {sugerida ? (
            <div className="flex flex-wrap gap-2">
              <span>{sugerida.monto}</span>
              {sugerenciaGuardada(sugerida, reparto.lineas) ? <span className="text-emerald-700">✔ Guardada</span> : !cerrado && (
                <button type="button" disabled={ocupado} className={enlace}
                  onClick={() => abrir(reparto, persona.vendedor_id, sugerida.monto)}>Usar</button>
              )}
            </div>
          ) : "—"}
        </td>
      )}
      <td className={celda}>
        <div className="flex flex-wrap gap-3">
          {!cerrado && (
            <button type="button" disabled={ocupado} className={enlace}
              onClick={() => abrir(reparto, persona.vendedor_id, persona.monto ?? 0)}>Editar parte</button>
          )}
          <button type="button" disabled={ocupado} className={enlace}
            onClick={() => abrir(reparto, persona.vendedor_id, persona.monto ?? 0, true)}>Historial</button>
        </div>
      </td>
    </tr>
  );
}

function RegistroTienda({ registro, nombre, etiqueta }) {
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const evidencia = registro.evidencia;
  const atraso = diasDeAtraso({ fecha: registro.fecha, capturado_en: registro.registrado_en });
  const ultimo = ultimoResultado(registro);
  return (
    <tr className={`${fila} ${registro.vigente ? "" : "line-through text-slate-500"}`}>
      <td className={`${celda} max-w-xs break-words`}>{nombre}</td>
      <td className={celda}>{fechaCorta(registro.fecha)}</td>
      <td className={`${celda} max-w-xs break-words`}>
        <p className="font-medium">{etiqueta}</p>
        {registro.conjunta_con != null && <p className="font-medium text-amber-800">Conjunta</p>}
        {atraso > 0 && <p className="text-amber-800">registrado {atraso} {atraso === 1 ? "día" : "días"} después</p>}
        {registro.nota && <p>{registro.nota}</p>}
        {!registro.vigente && <p>Anulada: {registro.motivo_anulacion}</p>}
      </td>
      <td className={celda}>
        <a href={evidencia.tipo === "foto" ? evidencia.drive_link : evidencia.link}
          target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          {evidencia.tipo === "foto" ? "Ver foto" : "Ver publicación"}
        </a>
      </td>
      <td className={`${celda} max-w-sm break-words`}>
        {ultimo ? <Resultado resultado={ultimo} /> : "—"}
        {registro.resultados.length > 1 && (
          <>
            <button type="button" onClick={() => setMostrarHistorial(!mostrarHistorial)} aria-expanded={mostrarHistorial}
              className="text-blue-600 hover:underline mt-2">Ver historial ({registro.resultados.length})</button>
            {mostrarHistorial && (
              <div className="mt-2 space-y-3 border-t border-slate-200 pt-2">
                {registro.resultados.slice(0, -1).map((resultado, indice) => <Resultado key={indice} resultado={resultado} />)}
              </div>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function Resultado({ resultado }) {
  return (
    <div>
      <p>
        {resultado.contactos} {Number(resultado.contactos) === 1 ? "contacto" : "contactos"}, {resultado.cotizaciones}{" "}
        {Number(resultado.cotizaciones) === 1 ? "cotización" : "cotizaciones"}
      </p>
      {resultado.nota && <p>{resultado.nota}</p>}
      <p className="text-slate-500">
        {resultado.registrado_por} · {new Date(resultado.registrado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}
      </p>
    </div>
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
