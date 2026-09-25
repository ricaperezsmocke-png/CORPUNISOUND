import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { Megaphone, ShoppingBag, Church, FileText } from "lucide-react";
import { lineaAvanceActividades, ultimoResultado, leerArchivoComoBase64 } from "./actividades";
import { diasDeAtraso, fechaCorta, finDelMes, hoyLocal, leer } from "./datos";

const campo = "block neu-campo rounded-lg px-3 py-2 w-full min-w-0 mt-1";
const boton = "bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-40";
const aviso = "bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm break-words";
const iconos = { grupos: Megaphone, marketplace: ShoppingBag, iglesia: Church, volanteo: FileText };
const celda = "px-3 py-3 align-top";
const claseBoton = "flex items-center justify-center gap-3 rounded-lg border-2 px-4 py-5 text-base font-medium";

export default function ActividadesVendedor({ mes, sucursalId, vendedorId, objetivos, verAvance }) {
  const [catalogo, setCatalogo] = useState([]);
  const [datos, setDatos] = useState(null);
  const [revision, setRevision] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [dialogo, setDialogo] = useState(null);
  const enCurso = useRef(false);
  const cerrado = objetivos.cerrado;

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    Promise.all([
      apiFetch("/objetivos/catalogo-actividades").then((r) => leer(r, "No se pudo cargar el catálogo de actividades")),
      apiFetch(`/objetivos/${mes}/${sucursalId}/actividades/${vendedorId}`)
        .then((r) => leer(r, "No se pudieron cargar tus actividades")),
    ]).then(([clases, actividades]) => {
      if (!vigente) return;
      setCatalogo(clases);
      setDatos(actividades);
    }).catch((e) => {
      if (!vigente) return;
      setDatos(null);
      setError(e.message);
    }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [mes, sucursalId, vendedorId, revision]);

  const guardar = async (ruta, cuerpo, mensaje) => {
    if (cerrado) throw new Error("Este mes está cerrado. Ya no se pueden modificar actividades.");
    if (enCurso.current) throw new Error("Espera a que termine la operación en curso.");
    enCurso.current = true;
    setGuardando(true);
    setExito("");
    try {
      await apiFetch(ruta, { method: "POST", body: JSON.stringify(cuerpo) })
        .then((r) => leer(r, "No se pudo guardar la actividad"));
      setExito(mensaje);
      // Un fallo al recargar no debe invitar a repetir una escritura que ya se guardó.
      setCargando(true);
      setRevision((valor) => valor + 1);
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  };

  const bloqueado = cargando || guardando;
  return (
    <section className="neu rounded-xl p-4 space-y-4 min-w-0 max-w-full">
      {error && <p role="alert" className={aviso}>{error}</p>}
      {exito && <p role="status" className="text-sm text-emerald-800 break-words">{exito}</p>}
      {cargando && <p role="status" className="text-sm text-slate-500">Cargando actividades…</p>}
      {!cargando && !datos && (
        <button type="button" onClick={() => setRevision((valor) => valor + 1)} className={boton}>Reintentar</button>
      )}
      {datos && (
        <>
          <Resumen catalogo={catalogo} datos={datos} metas={objetivos.actividades || []} vendedorId={vendedorId} verAvance={verAvance} />
          {cerrado ? <p className="text-sm text-amber-800">Mes cerrado: las actividades son de solo lectura.</p> : (
            <RegistroActividad mes={mes} sucursalId={sucursalId} vendedorId={vendedorId}
              catalogo={catalogo} guardar={guardar} bloqueado={bloqueado || dialogo !== null} />
          )}
          <div className="space-y-3">
            <h3 className="font-medium text-slate-700">Mis registros · declaradas, no verificadas</h3>
            {!datos.registros.length && <p className="text-sm text-slate-500">Todavía no hay actividades registradas.</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm text-left">
                <thead className="bg-blue-600 text-white">
                  <tr>
                    <th className={celda}>Fecha</th><th className={celda}>Actividad</th><th className={celda}>Evidencia</th>
                    <th className={celda}>Último resultado</th><th className={celda}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.registros.map((registro) => (
                    <Registro key={registro.id} registro={registro} catalogo={catalogo} cerrado={cerrado}
                      bloqueado={bloqueado} abrir={setDialogo} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {dialogo && !cerrado && (
        <DialogoActividad dialogo={dialogo} guardar={guardar} bloqueado={bloqueado} cerrar={() => setDialogo(null)} />
      )}
    </section>
  );
}

function Resumen({ catalogo, datos, metas, vendedorId, verAvance }) {
  const lineas = lineaAvanceActividades({ catalogo, metas, vendedorId, resumen: datos.resumen, registros: datos.registros });
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <p>
        {lineas.length ? lineas.map((l) => `${l.corta} ${l.declaradas}${l.meta > 0 ? ` de ${l.meta}` : ""}`).join(" · ")
          : "Sin metas ni registros de actividades este mes"}
      </p>
      <span className="text-amber-800">(declaradas, no verificadas)</span>
      <button type="button" onClick={verAvance} className="text-blue-600 hover:underline">Ver Mi avance →</button>
    </div>
  );
}

function RegistroActividad({ mes, sucursalId, vendedorId, catalogo, guardar, bloqueado }) {
  const [actividad, setActividad] = useState(catalogo[0]?.clave || "");
  const [fecha, setFecha] = useState(mes === hoyLocal().slice(0, 7) ? hoyLocal() : `${mes}-01`);
  const [link, setLink] = useState("");
  const [foto, setFoto] = useState(null);
  const [nota, setNota] = useState("");
  const [mostrarNota, setMostrarNota] = useState(false);
  const [mostrarFecha, setMostrarFecha] = useState(mes !== hoyLocal().slice(0, 7));
  const [error, setError] = useState("");
  const [pendiente, setPendiente] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const enCurso = useRef(false);
  const selectorFoto = useRef(null);
  const clase = catalogo.find((item) => item.clave === actividad);
  const hoy = hoyLocal();
  const fechaValida = fecha >= `${mes}-01` && fecha <= hoy && fecha.slice(0, 7) === mes;
  const deshabilitado = bloqueado || subiendo;

  const enviar = async (confirmada = null) => {
    if (enCurso.current || bloqueado) return;
    enCurso.current = true;
    setSubiendo(true);
    setError("");
    setPendiente(null);
    let cuerpo;
    try {
      if (!fechaValida) throw new Error("Elige una fecha del mes seleccionado que no sea futura.");
      cuerpo = confirmada || {
        mes, fecha, sucursal_id: Number(sucursalId), vendedor_id: Number(vendedorId), actividad, nota,
        ...(clase?.evidencia === "foto" ? { archivo: await leerArchivoComoBase64(foto) } : { link }),
      };
      await guardar("/objetivos/actividad", cuerpo, "Actividad registrada.");
      setLink("");
      setFoto(null);
      setNota("");
      if (selectorFoto.current) selectorFoto.current.value = "";
    } catch (e) {
      setError(e.message);
      if (e.status === 400 && e.message.startsWith("Esta evidencia ya la presentó ") &&
          e.message.endsWith("Si fue una actividad conjunta, confírmalo.")) {
        setPendiente(cuerpo);
      }
    } finally {
      enCurso.current = false;
      setSubiendo(false);
    }
  };

  return (
    <form className="border-t border-slate-100 pt-4 space-y-3 text-sm" onSubmit={(e) => {
      e.preventDefault();
      enviar();
    }} onChange={() => { setPendiente(null); setError(""); }}>
      <h3 className="font-medium text-slate-700">Registrar actividad</h3>
      <fieldset disabled={deshabilitado} className="space-y-3 min-w-0">
        <div role="group" aria-label="Clase de actividad" className="grid grid-cols-4 gap-3">
          {catalogo.map((item) => {
            const Icono = iconos[item.clave];
            const color = actividad === item.clave ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-700";
            return (
              <button key={item.clave} type="button" aria-pressed={actividad === item.clave} className={`${claseBoton} ${color}`}
                onClick={() => {
                  if (actividad === item.clave) return;
                  setActividad(item.clave);
                  setLink("");
                  setFoto(null);
                  setPendiente(null);
                  setError("");
                  if (selectorFoto.current) selectorFoto.current.value = "";
                }}>
                <Icono size={26} aria-hidden="true" />{item.etiqueta}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-slate-600">
          <p>Fecha: {fecha === hoy ? "hoy, " : ""}{fechaCorta(fecha)}</p>
          <button type="button" onClick={() => setMostrarFecha(!mostrarFecha)} aria-expanded={mostrarFecha}
            className="text-blue-600 hover:underline">cambiar</button>
        </div>
        {mostrarFecha && (
          <label className="block text-slate-600">
            Fecha
            <input type="date" required min={`${mes}-01`} max={hoy < finDelMes(mes) ? hoy : finDelMes(mes)}
              value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} />
          </label>
        )}
        {clase?.evidencia === "foto" ? (
          <label className="block text-slate-600">
            Foto (JPG o PNG, máximo 10 MB)
            <input ref={selectorFoto} type="file" required accept="image/jpeg,image/png" capture="environment"
              onChange={(e) => setFoto(e.target.files?.[0] || null)} className={campo} />
          </label>
        ) : (
          <label className="block text-slate-600">
            Link de la publicación
            <input type="url" required maxLength={500} placeholder="https://" value={link}
              onChange={(e) => setLink(e.target.value)} className={campo} />
          </label>
        )}
        {mostrarNota ? (
          <label className="block text-slate-600">
            Nota opcional
            <textarea maxLength={300} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} className={campo} />
          </label>
        ) : (
          <button type="button" onClick={() => setMostrarNota(true)} className="block text-blue-600 hover:underline">+ Agregar nota</button>
        )}
        <button type="submit" disabled={!clase || !fechaValida} className={boton}>
          {subiendo ? "Subiendo…" : "Guardar actividad"}
        </button>
      </fieldset>
      {error && <p role="alert" className={aviso}>{error}</p>}
      {pendiente && (
        <button type="button" disabled={deshabilitado} className={boton}
          onClick={() => enviar({ ...pendiente, conjunta: true })}>
          Sí, fue una actividad conjunta
        </button>
      )}
    </form>
  );
}

function Registro({ registro, catalogo, cerrado, bloqueado, abrir }) {
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const atraso = diasDeAtraso({ fecha: registro.fecha, capturado_en: registro.registrado_en });
  const etiqueta = catalogo.find((item) => item.clave === registro.actividad)?.etiqueta || registro.actividad;
  const evidencia = registro.evidencia;
  const ultimo = ultimoResultado(registro);
  const fila = `border-b border-slate-100 odd:bg-white even:bg-blue-50 ${registro.vigente ? "" : "line-through text-slate-500"}`;
  return (
    <tr className={fila}>
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
      <td className={celda}>
        {registro.vigente && !cerrado && (
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={bloqueado} onClick={() => abrir({ registro, accion: "resultado" })}
              className="text-blue-600 underline disabled:opacity-40">Agregar resultado</button>
            <button type="button" disabled={bloqueado} onClick={() => abrir({ registro, accion: "anular" })}
              className="text-red-700 underline disabled:opacity-40">Anular</button>
          </div>
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

function DialogoActividad({ dialogo, guardar, bloqueado, cerrar }) {
  const [motivo, setMotivo] = useState("");
  const [contactos, setContactos] = useState("");
  const [cotizaciones, setCotizaciones] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const anular = dialogo.accion === "anular";
  const titulo = anular ? "Anular actividad" : "Agregar resultado";
  const numerosValidos = [contactos, cotizaciones].every((valor) =>
    valor !== "" && Number.isInteger(Number(valor)) && Number(valor) >= 0);

  const enviar = async (e) => {
    e.preventDefault();
    if (bloqueado || (anular ? !motivo.trim() : !numerosValidos)) return;
    setError("");
    try {
      await guardar(`/objetivos/actividad/${dialogo.registro.id}/${dialogo.accion}`,
        anular ? { motivo: motivo.trim() } : { contactos: Number(contactos), cotizaciones: Number(cotizaciones), nota },
        anular ? "Actividad anulada; se conserva con su motivo." : "Resultado agregado; se conserva el historial.");
      cerrar();
    } catch (fallo) { setError(fallo.message); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form onSubmit={enviar} role="dialog" aria-modal="true" aria-label={titulo}
        className="bg-white rounded-xl p-5 w-full max-w-md max-h-[85dvh] overflow-y-auto space-y-3 min-w-0 text-sm">
        <h3 className="font-semibold">{titulo}</h3>
        <p>{dialogo.registro.fecha}</p>
        <fieldset disabled={bloqueado} className="space-y-3 min-w-0">
          {anular ? (
            <label className="block">
              Motivo obligatorio
              <textarea autoFocus required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
            </label>
          ) : (
            <>
              <p className="text-amber-800">Declaradas, no verificadas</p>
              <label className="block">
                Contactos
                <input autoFocus type="number" min="0" step="1" required value={contactos}
                  onChange={(e) => setContactos(e.target.value)} className={campo} />
              </label>
              <label className="block">
                Cotizaciones
                <input type="number" min="0" step="1" required value={cotizaciones}
                  onChange={(e) => setCotizaciones(e.target.value)} className={campo} />
              </label>
              <label className="block">
                Nota opcional
                <textarea maxLength={300} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} className={campo} />
              </label>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={cerrar} className="border rounded-lg px-4 py-2">Cancelar</button>
            <button type="submit" disabled={anular ? !motivo.trim() : !numerosValidos} className={boton}>
              {bloqueado ? "Guardando…" : titulo}
            </button>
          </div>
        </fieldset>
        {error && <p role="alert" className={aviso}>{error}</p>}
      </form>
    </div>
  );
}
