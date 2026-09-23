import { useCallback, useEffect, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { apiFetch } from "./api";
import { Campo, Modal } from "./objetivos/DialogosObjetivos";
import { leer, mesActual, pesos } from "./objetivos/datos";

const diferencia = (n) => n === 0 ? "Cuadra" : `Capturó ${pesos(Math.abs(n))} ${n > 0 ? "más" : "menos"} que SICAR`;
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
  const [reales, setReales] = useState({});
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
        setReales({});
        return;
      }
      // Esta ruta usa 404 para un mes todavía abierto; el previo comprueba también el alcance.
      if (rCierre.status !== 404) await leer(rCierre, "No se pudo consultar el cierre");
      const lineas = await apiFetch(`/objetivos/${mes}/${sucursalId}/previo-cierre`)
        .then((r) => leer(r, "No se pudo preparar el cierre"));
      setPrevio(lineas);
      setReales(Object.fromEntries(lineas.map((l) => [l.vendedor_id, ""])));
    } catch (e) {
      setError(e.message);
      setCierre(null);
      setPrevio([]);
    } finally {
      setCargando(false);
    }
  }, [mes, sucursalId]);
  useEffect(() => { cargar(); }, [cargar]);

  const cerrarMes = async () => {
    setError("");
    setExito("");
    try {
      const datos = await apiFetch("/objetivos/cierre", {
        method: "POST",
        body: JSON.stringify({
          mes,
          sucursal_id: Number(sucursalId),
          reales: previo.map((l) => ({ vendedor_id: l.vendedor_id, real_sicar: Number(reales[l.vendedor_id]) })),
        }),
      }).then((r) => leer(r, "No se pudo cerrar el mes"));
      setCierre(datos);
      setPrevio([]);
      setExito("El mes quedó cerrado y sellado.");
    } catch (e) {
      setError(e.message);
    }
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
  const completos = previo.length > 0 && previo.every((l) => reales[l.vendedor_id] !== "" && Number(reales[l.vendedor_id]) >= 0);

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
        <button onClick={cargar} className="px-3 py-2 text-sm text-slate-600 flex gap-2 items-center">
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>
      )}
      {exito && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">{exito}</div>}
      {cargando ? <p className="text-sm text-slate-500">Consultando cierre…</p> : cierre ? (
        <CierreSellado cierre={cierre} rectificar={setRectificando} nombre={nombre} />
      ) : (
        <section className="neu rounded-xl p-4 space-y-4 min-w-0 max-w-full">
          <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
            <LockKeyhole size={18} className="text-blue-600" />
            Cierre mensual de objetivos
          </h2>
          <p className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm">
            Una vez cerrado no se puede editar; solo rectificar.
          </p>
          <TablaPrevio lineas={previo} reales={reales} cambiar={(id, valor) => setReales({ ...reales, [id]: valor })} />
          <button disabled={!completos} onClick={cerrarMes}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">
            Cerrar mes
          </button>
          {previo.length === 0 && !error && (
            <p className="text-sm text-slate-500">No hay participantes para cerrar en este mes y sucursal.</p>
          )}
        </section>
      )}
      {rectificando && (
        <Modal titulo={`Rectificar cierre sellado: ${nombre(rectificando.vendedor_id)}`}
          cerrar={() => setRectificando(null)} guardar={rectificar}
          deshabilitado={rectificando.valor_nuevo === "" || !rectificando.motivo.trim()}>
          <label className="text-sm block">
            Campo
            <select value={rectificando.campo} onChange={(e) => setRectificando({ ...rectificando, campo: e.target.value })}
              className="neu-campo rounded-lg px-3 py-2 w-full mt-1">
              <option value="meta">Meta</option>
              <option value="capturado">Capturado</option>
              <option value="real_sicar">Real de SICAR</option>
            </select>
          </label>
          <Campo etiqueta="Valor nuevo" tipo="number" valor={rectificando.valor_nuevo}
            cambiar={(valor_nuevo) => setRectificando({ ...rectificando, valor_nuevo })} />
          <Campo etiqueta="Motivo obligatorio" valor={rectificando.motivo}
            cambiar={(motivo) => setRectificando({ ...rectificando, motivo })} area />
        </Modal>
      )}
    </div>
  );
}

function TablaPrevio({ lineas, reales, cambiar }) {
  return (
    <div className="overflow-x-auto max-w-full">
      <table className="w-full text-sm min-w-[1000px]">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Vendedor</th>
            <th>Meta</th>
            <th>Capturado</th>
            <th>Real de SICAR</th>
            <th>Diferencia</th>
            <th className="px-3">Actividades (declaradas, no verificadas)</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const real = reales[l.vendedor_id];
            const dif = real === "" ? null : l.capturado - Number(real);
            return (
              <tr key={l.vendedor_id} className="border-b border-slate-100">
                <td className="py-2">{l.nombre}</td>
                <td>{pesos(l.meta)}</td>
                <td>{pesos(l.capturado)}</td>
                <td>
                  <input type="number" min="0" value={real} onChange={(e) => cambiar(l.vendedor_id, e.target.value)}
                    className="neu-campo rounded-lg px-2 py-1 w-32" />
                </td>
                <td>{dif == null ? "Pendiente" : diferencia(dif)}</td>
                <td className="p-3"><ActividadesCierre actividades={l.actividades} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CierreSellado({ cierre, rectificar, nombre }) {
  return (
    <section className="neu rounded-xl p-4 space-y-4 min-w-0 max-w-full">
      <div>
        <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
          <LockKeyhole size={18} className="text-emerald-600" />
          Cierre sellado
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Cerró <strong>{cierre.cerrado_por}</strong> el {new Date(cierre.cerrado_en).toLocaleString("es-MX")}
        </p>
      </div>
      <div className="overflow-x-auto max-w-full">
        <table className="w-full text-sm min-w-[1040px]">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2">Vendedor</th>
              <th>Meta</th>
              <th>Capturado</th>
              <th>Real de SICAR</th>
              <th>Diferencia</th>
              <th className="px-3">Actividades (declaradas, no verificadas)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cierre.lineas.map((l) => {
              const rectificaciones = cierre.rectificaciones.filter((r) => r.vendedor_id === l.vendedor_id);
              const vigente = { meta: l.meta, capturado: l.capturado, real_sicar: l.real_sicar };
              for (const r of rectificaciones) vigente[r.campo] = r.valor_nuevo;
              return (
                <tr key={l.vendedor_id} className="border-b border-slate-100">
                  <td className="py-2">{nombre(l.vendedor_id)}</td>
                  {(["meta", "capturado", "real_sicar"]).map((campo) => (
                    <td key={campo}>
                      {pesos(l[campo])}
                      {vigente[campo] !== l[campo] && (
                        <p className="text-violet-700">Rectificado: {pesos(vigente[campo])}</p>
                      )}
                    </td>
                  ))}
                  <td>
                    {diferencia(vigente.capturado - vigente.real_sicar)}
                    {rectificaciones.length > 0 && <p className="text-violet-700">(con rectificaciones)</p>}
                  </td>
                  <td className="p-3">
                    <ActividadesCierre actividades={l.actividades} />
                  </td>
                  <td>
                    <button onClick={() => rectificar({
                      vendedor_id: l.vendedor_id,
                      campo: "real_sicar",
                      valor_nuevo: vigente.real_sicar,
                      motivo: "",
                    })} className="text-blue-600 hover:underline">
                      Rectificar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="font-medium text-slate-700 mb-2">Rectificaciones</h3>
        {cierre.rectificaciones.length ? (
          <ul className="space-y-2 text-sm">
            {cierre.rectificaciones.map((r) => (
              <li key={r.id} className="border rounded-lg p-3">
                <strong>{nombre(r.vendedor_id)}: {nombresCampos[r.campo] || r.campo}</strong>
                {" "}de {pesos(r.valor_anterior)} a {pesos(r.valor_nuevo)}
                <p>{r.motivo}</p>
                <p className="text-slate-500">{r.rectificado_por} · {new Date(r.rectificado_en).toLocaleString("es-MX")}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Sin rectificaciones.</p>}
      </div>
    </section>
  );
}

function ActividadesCierre({ actividades }) {
  if (!actividades) return <p className="text-slate-500">Este cierre no incluye datos de actividades.</p>;
  return (
    <div className="space-y-1 min-w-[240px] text-sm">
      <p className="text-amber-800">Declaradas, no verificadas</p>
      <p className="text-slate-500">Declaradas / meta · No afectan la diferencia de SICAR</p>
      <ul className="space-y-1">
        {actividades.map((item) => (
          <li key={item.actividad}>
            {nombresActividades[item.actividad] || item.actividad}: <strong>{item.declaradas} / {item.meta}</strong>
            {item.conjuntas > 0 && <span className="text-amber-800"> · Conjuntas: {item.conjuntas}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
