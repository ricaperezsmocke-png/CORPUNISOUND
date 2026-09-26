import { useCallback, useEffect, useState } from "react";
import { FranjaAyuda, AyudaBoton } from "./objetivos/Ayuda";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "./api";
import { Campo, Modal } from "./objetivos/DialogosObjetivos";
import { leer, mesActual, mesEnPalabras } from "./objetivos/datos";
import CierreElementos, { GRUPOS_CIERRE, nombreElemento } from "./objetivos/CierreElementos";
import {
  armarRealesCierre, camposFaltantesCierre, esRectificacionDeElemento, formatoUnidad, llaveCampo, pesosConCentavos, restarEnCentavos,
  resumenAntesDeSellar, contadorCierre, rotuloCampoCierre,
} from "./objetivos/marcas";

const diferencia = (n) => n === 0 ? "✔ Cuadra" : `Capturó ${pesosConCentavos(Math.abs(n))} ${n > 0 ? "más" : "menos"} que SICAR`;
const TABLA = "w-full text-sm min-w-[800px] [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2";
const FILA = "odd:bg-white even:bg-blue-50 border-b border-blue-100";
const tonoDiferencia = (n) => n == null ? "text-slate-500" : n === 0 ? "text-emerald-700" : "text-amber-800";
const fechaCierre = (fecha) => new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(fecha));
const nombresCampos = { meta: "Meta", capturado: "Capturado", real_sicar: "Real de SICAR" };
// Catálogo fijo: el permiso de cierre no requiere acceso a la ruta de catálogo de gerencia.
const nombresActividades = {
  grupos: "Publicación en grupos", marketplace: "Publicación en Marketplace",
  iglesia: "Salida a iglesia", volanteo: "Jornada de volanteo",
};

export default function CierreObjetivos({ permisos = [], usuario }) {
  const veTodas = permisos.includes("ver_todas_las_sucursales") || usuario?.ver_todas;
  const [mes, setMes] = useState(mesActual());
  const [sucursalId, setSucursalId] = useState(veTodas ? "" : String(usuario?.sucursal_id || ""));
  const [sucursales, setSucursales] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [previo, setPrevio] = useState([]);
  // Un valor por campo del cierre, con llaveCampo: SICAR de cada persona y el real de cada elemento.
  const [valores, setValores] = useState({});
  const [faltantes, setFaltantes] = useState([]);
  const [confirmando, setConfirmando] = useState(false);
  const [cierre, setCierre] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [rectificando, setRectificando] = useState(null);

  useEffect(() => {
    if (!veTodas) return;
    apiFetch("/sucursales").then((r) => leer(r, "No se pudieron cargar las sucursales")).then((tiendas) => {
      setSucursales(tiendas);
      if (tiendas.length) setSucursalId((actual) => actual || String(tiendas[0].id));
    }).catch((e) => setError(e.message));
  }, [veTodas]);

  const cargar = useCallback(async () => {
    setCierre(null);
    setPrevio([]);
    setRectificando(null);
    if (!mes || !sucursalId) return;
    setCargando(true);
    setError("");
    setExito("");
    try {
      const vendedores = await apiFetch("/vendedores").then((r) => leer(r, "No se pudieron cargar los vendedores"));
      setEquipo(vendedores);
      const rCierre = await apiFetch(`/objetivos/${mes}/${sucursalId}/cierre`);
      if (rCierre.ok) {
        setCierre(await rCierre.json());
        setValores({});
        return;
      }
      // Esta ruta usa 404 para un mes todavía abierto; el previo comprueba también el alcance.
      if (rCierre.status !== 404) await leer(rCierre, "No se pudo consultar el cierre");
      const lineas = await apiFetch(`/objetivos/${mes}/${sucursalId}/previo-cierre`)
        .then((r) => leer(r, "No se pudo preparar el cierre"));
      setPrevio(lineas);
      setValores({});
      setFaltantes([]);
    } catch (e) {
      setError(e.message);
      setCierre(null);
      setPrevio([]);
    } finally {
      setCargando(false);
    }
  }, [mes, sucursalId]);
  useEffect(() => { cargar(); }, [cargar]);

  const revisar = () => {
    setError("");
    const vacios = camposFaltantesCierre(previo, valores);
    setFaltantes(vacios);
    if (vacios.length) {
      setError(`Faltan ${vacios.length} ${vacios.length === 1 ? "dato" : "datos"} por capturar (marcados en rojo).`);
      return;
    }
    setConfirmando(true);
  };

  const cerrarMes = async () => {
    setError("");
    setExito("");
    try {
      const datos = await apiFetch("/objetivos/cierre", {
        method: "POST",
        body: JSON.stringify({ mes, sucursal_id: Number(sucursalId), reales: armarRealesCierre(previo, valores) }),
      }).then((r) => leer(r, "No se pudo cerrar el mes"));
      setConfirmando(false);
      setCierre(datos);
      setPrevio([]);
      setExito("El mes quedó cerrado y sellado.");
    } catch (e) {
      setConfirmando(false);
      setError(e.message);
    }
  };

  const cambiarValor = (llave, valor) => {
    setValores((actual) => ({ ...actual, [llave]: valor }));
    setFaltantes((actual) => actual.filter((f) => f !== llave));
  };

  const rectificar = async () => {
    setError("");
    setExito("");
    try {
      // El motivo permite explicar el ajuste sin alterar la fotografía sellada.
      await apiFetch(`/objetivos/cierre/${cierre.id}/rectificar`, {
        method: "POST",
        body: JSON.stringify({
          vendedor_id: rectificando.vendedor_id, campo: rectificando.campo,
          valor_nuevo: Number(rectificando.valor_nuevo), motivo: rectificando.motivo,
          // Rectificar un elemento (marca, producto o financiera) lleva su referencia; la venta, no.
          ...(rectificando.clave ? { [rectificando.clave]: rectificando.id } : {}),
        }),
      }).then((r) => leer(r, "No se pudo guardar la rectificación"));
      setRectificando(null);
      await cargar();
      setExito("Rectificación guardada sin alterar el cierre sellado.");
    } catch (e) {
      setError(e.message);
    }
  };

  const nombres = new Map(equipo.map((v) => [Number(v.id), v.nombre]));
  const nombre = (id) => nombres.get(Number(id)) || `Vendedor #${id}`;
  const nombreSucursal = sucursales.find((s) => String(s.id) === String(sucursalId))?.nombre || usuario?.sucursal_nombre || `Sucursal ${sucursalId}`;
  const resumen = confirmando ? resumenAntesDeSellar(previo, valores) : null;
  const contador = contadorCierre(previo, valores);

  return (
    <div className="p-4 space-y-4 overflow-y-auto min-w-0 max-w-full">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm text-slate-600">
          Mes
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            className="block neu-campo rounded-lg px-3 py-2 mt-1" />
        </label>
        {veTodas && (
          <label className="text-sm text-slate-600">
            Sucursal
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
              className="block neu-campo rounded-lg px-3 py-2 mt-1">
              <option value="">Selecciona una sucursal</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={cargar} className="px-3 py-2 text-sm text-slate-600 flex gap-2 items-center">
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>
      )}
      {exito && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">{exito}</div>}
      {cargando ? <p className="text-sm text-slate-500">Consultando cierre…</p> : cierre ? (
        <CierreSellado cierre={cierre} rectificar={setRectificando} nombre={nombre} mes={mes} nombreSucursal={nombreSucursal} />
      ) : (
        <section className="neu rounded-xl p-4 space-y-4 min-w-0 max-w-full">
          <FranjaAyuda clave="cierre">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Escribe el <strong>real de SICAR</strong> de cada persona, y el real de cada marca, producto y financiera.</li>
              <li>Revisa las diferencias en ámbar.</li>
              <li>Presiona <strong>Revisar y cerrar</strong> y confirma. <strong>Sellar no se puede deshacer</strong>: después solo se puede rectificar, con motivo.</li>
            </ol>
          </FranjaAyuda>
          <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
            {nombreSucursal.toUpperCase()} · {mesEnPalabras(mes).toUpperCase()} · 🔓 ABIERTO
          </h2>
          <p className="text-sm text-slate-700" aria-live="polite">
            Importes por capturar: {contador.capturados} de {contador.total} capturados · Personas con diferencia: {contador.conDiferencia}
          </p>
          <p className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm">
            Una vez cerrado no se puede editar; solo rectificar.
          </p>
          <TablaPrevio lineas={previo} valores={valores} faltantes={faltantes} cambiar={cambiarValor} />
          <CierreElementos lineas={previo} nombre={(id, l) => l.nombre || nombre(id)} valores={valores}
            faltantes={faltantes} cambiar={cambiarValor} />
          <ActividadesCierre key={`${mes}/${sucursalId}`} lineas={previo} nombre={(id, l) => l.nombre || nombre(id)} />
          <button type="button" disabled={previo.length === 0} onClick={revisar}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">
            Revisar y cerrar
          </button>
          {previo.length === 0 && !error && (
            <p className="text-sm text-slate-500">No hay participantes para cerrar en este mes y sucursal.</p>
          )}
        </section>
      )}
      {confirmando && resumen && (
        <Modal titulo="¿Sellar el mes?" cerrar={() => setConfirmando(false)} guardar={cerrarMes}
          textoGuardar="Sellar el mes" textoCerrar="Volver" error={error} focoEnCerrar>
          <div className="text-sm space-y-2">
            <p><strong>{nombreSucursal}</strong> · {mesEnPalabras(mes)} · {resumen.personas} {resumen.personas === 1 ? "persona" : "personas"}</p>
            <ul className="list-disc pl-5">
              <li>Con diferencia en venta: <strong>{resumen.conDiferencia.venta}</strong></li>
              <li>Con diferencia en marcas: <strong>{resumen.conDiferencia.marcas}</strong></li>
              <li>Con diferencia en productos: <strong>{resumen.conDiferencia.productos}</strong></li>
              <li>Con diferencia en créditos: <strong>{resumen.conDiferencia.creditos}</strong></li>
            </ul>
            <p className="text-amber-800">Al guardar se sella el mes: ya no se podrá capturar ni cambiar metas; solo rectificar.</p>
          </div>
        </Modal>
      )}
      {rectificando && (
        <Modal titulo={`Rectificar ${rectificando.rotulo || rotuloCampoCierre(rectificando)} de ${nombre(rectificando.vendedor_id)} · ${mesEnPalabras(mes)}`}
          cerrar={() => setRectificando(null)} guardar={rectificar} textoGuardar="Guardar rectificación" error={error}
          deshabilitado={rectificando.valor_nuevo === "" || !rectificando.motivo.trim()}>
          <p className="text-sm">Valor actual: {formatoUnidad(rectificando.unidad || "pesos", rectificando.valor_actual)}</p>
          <Campo etiqueta="Valor nuevo" tipo="number" valor={rectificando.valor_nuevo}
            cambiar={(valor_nuevo) => setRectificando({ ...rectificando, valor_nuevo })} />
          <Campo etiqueta="Motivo obligatorio" valor={rectificando.motivo}
            cambiar={(motivo) => setRectificando({ ...rectificando, motivo })} area />
        </Modal>
      )}
    </div>
  );
}

function TablaPrevio({ lineas, valores, faltantes, cambiar }) {
  return (
    <div className="overflow-x-auto max-w-full">
      <table className={TABLA}>
        <thead>
          <tr className="bg-blue-600 text-white text-left">
            <th>Persona</th>
            <th>Meta</th>
            <th>Capturó</th>
            <th>Real SICAR</th>
            <th>Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const llave = llaveCampo(l.vendedor_id, "sicar", "");
            const real = valores[llave] ?? "";
            const dif = real === "" ? null : restarEnCentavos(l.capturado, real);
            return (
              <tr key={l.vendedor_id} className={FILA}>
                <td className="py-2">{l.nombre}</td>
                <td>{pesosConCentavos(l.meta)}</td>
                <td>{pesosConCentavos(l.capturado)}</td>
                <td>
                  <input type="number" min="0" step="any" value={real} onChange={(e) => cambiar(llave, e.target.value)}
                    aria-label={`Real de SICAR de ${l.nombre}`}
                    className={`neu-campo rounded-lg px-2 py-1 w-32 ${faltantes.includes(llave) ? "ring-2 ring-red-500" : ""}`} />
                </td>
                <td className={tonoDiferencia(dif)}>{dif == null ? "falta el real" : diferencia(dif)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CierreSellado({ cierre, rectificar, nombre, mes, nombreSucursal = "" }) {
  return (
    <section className="neu rounded-xl p-4 space-y-4 min-w-0 max-w-full">
      <h2 className="font-semibold text-slate-700">
        {nombreSucursal.toUpperCase()} · {mesEnPalabras(mes || cierre.mes).toUpperCase()} · 🔒 SELLADO
        {" "}por {cierre.cerrado_por} el {fechaCierre(cierre.cerrado_en)}
        <AyudaBoton texto="Corrige una cifra del cierre sellado. El valor original queda visible, tachado." />
      </h2>
      <div className="overflow-x-auto max-w-full">
        <table className={TABLA}>
          <thead>
            <tr className="bg-blue-600 text-white text-left">
              <th>Persona</th>
              <th>Meta</th>
              <th>Capturó</th>
              <th>Real SICAR</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {cierre.lineas.map((l) => {
              const rectificaciones = cierre.rectificaciones
                .filter((r) => r.vendedor_id === l.vendedor_id && !esRectificacionDeElemento(r));
              const vigente = { meta: l.meta, capturado: l.capturado, real_sicar: l.real_sicar };
              for (const r of rectificaciones) vigente[r.campo] = r.valor_nuevo;
              return (
                <tr key={l.vendedor_id} className={FILA}>
                  <td className="py-2">{nombre(l.vendedor_id)}</td>
                  {(["meta", "capturado", "real_sicar"]).map((campo) => (
                    <td key={campo}>
                      {rectificaciones.some((r) => r.campo === campo) ? (
                        <>
                          <del className="block text-slate-500">{pesosConCentavos(l[campo])}</del>
                          <p>{pesosConCentavos(vigente[campo])}</p>
                          <span className="block text-violet-700 text-xs">rectificado</span>
                        </>
                      ) : pesosConCentavos(vigente[campo])}
                      <button type="button" onClick={() => rectificar({
                        vendedor_id: l.vendedor_id, campo, unidad: "pesos",
                        valor_actual: vigente[campo], valor_nuevo: vigente[campo], motivo: "",
                      })} aria-label={`Rectificar ${rotuloCampoCierre({ campo })} de ${nombre(l.vendedor_id)}`}
                        className="block text-blue-600 hover:underline">
                        Rectificar
                      </button>
                    </td>
                  ))}
                  <td className={tonoDiferencia(restarEnCentavos(vigente.capturado, vigente.real_sicar))}>
                    {diferencia(restarEnCentavos(vigente.capturado, vigente.real_sicar))}
                    {rectificaciones.length > 0 && <p className="text-violet-700">(con rectificaciones)</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CierreElementos lineas={cierre.lineas} nombre={(id) => nombre(id)} rectificaciones={cierre.rectificaciones}
        rectificar={rectificar} />
      <ActividadesCierre key={cierre.id} lineas={cierre.lineas} nombre={nombre} />
      <div>
        <h3 className="font-medium text-slate-700 mb-2">Rectificaciones</h3>
        {cierre.rectificaciones.length ? (
          <div className="overflow-x-auto max-w-full">
            <table className={TABLA}>
              <thead><tr className="bg-blue-600 text-white text-left">
                <th>Persona</th><th>Qué</th><th>Antes</th><th>Después</th><th>Motivo</th><th>Quién/cuándo</th>
              </tr></thead>
              <tbody>
                {cierre.rectificaciones.map((r) => (
                  <tr key={r.id} className={FILA}>
                    <td>{nombre(r.vendedor_id)}</td><td>{rotuloRectificacion(cierre, r)}</td>
                    <td>{valorRectificacion(r, r.valor_anterior)}</td><td>{valorRectificacion(r, r.valor_nuevo)}</td>
                    <td className="break-words">{r.motivo}</td>
                    <td>{r.rectificado_por} · {new Date(r.rectificado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-500">Sin rectificaciones.</p>}
      </div>
    </section>
  );
}

// Una rectificación de elemento se rotula "Yamaha · Real", nunca con los nombres de la venta.
const CAMPOS_ELEMENTO = { meta: "Meta", capturado: "Capturado", real: "Real" };
const grupoDe = (r) => GRUPOS_CIERRE.find(({ clave }) => r[clave] !== undefined && r[clave] !== null);

function rotuloRectificacion(cierre, r) {
  if (!esRectificacionDeElemento(r)) return nombresCampos[r.campo] || r.campo;
  const { grupo, clave } = grupoDe(r);
  const linea = cierre.lineas.find((l) => l.vendedor_id === r.vendedor_id);
  const elemento = (linea?.[grupo] || []).find((e) => e[clave] === r[clave]) || { [clave]: r[clave], nombre: String(r[clave]) };
  return `${nombreElemento(grupo, elemento)} · ${CAMPOS_ELEMENTO[r.campo] || r.campo}`;
}

const valorRectificacion = (r, n) => (esRectificacionDeElemento(r) ? formatoUnidad(grupoDe(r).unidad, n) : pesosConCentavos(n));

function ActividadesCierre({ lineas, nombre }) {
  const [abierto, setAbierto] = useState(false);
  const actividades = [...new Set(lineas.flatMap((l) => (l.actividades || []).map((a) => a.actividad)))];
  return (
    <div className="space-y-2 text-sm">
      <button type="button" aria-expanded={abierto} onClick={() => setAbierto(!abierto)} className="font-medium text-blue-700 py-2">
        {abierto ? "▾" : "▸"} Actividades del mes · declaradas, no verificadas
      </button>
      {abierto && (
        <>
          <p className="text-slate-600">No cuentan para la diferencia de SICAR.</p>
          {lineas.some((l) => !l.actividades) && <p className="text-slate-500">Este cierre no incluye datos de actividades.</p>}
          <div className="overflow-x-auto max-w-full">
            <table className={TABLA}>
              <thead><tr className="bg-blue-600 text-white text-left">
                <th>Persona</th>
                {actividades.map((actividad) => <th key={actividad}>{nombresActividades[actividad] || actividad} · declaradas / meta</th>)}
              </tr></thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.vendedor_id} className={FILA}>
                    <td>{nombre(l.vendedor_id, l)}</td>
                    {actividades.map((actividad) => {
                      const item = l.actividades?.find((a) => a.actividad === actividad);
                      return <td key={actividad}>
                        {item ? <>
                          {item.declaradas} / {item.meta}
                          {item.conjuntas > 0 && <p className="text-amber-800">Conjuntas: {item.conjuntas}</p>}
                        </> : "—"}
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
