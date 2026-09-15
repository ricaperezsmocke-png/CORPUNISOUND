import { useState } from "react";
import { History, Users } from "lucide-react";
import { finDelMes, pesos } from "./datos";

export default function RepartoGerente({
  mes, sucursalId, objetivos, equipo, nombre, agregar, editar, historial, sugerencia, pedirSugerencia, darBaja,
}) {
  const [vendedorId, setVendedorId] = useState("");
  const [desde, setDesde] = useState("");
  const disponibles = equipo.filter((v) => v.activo !== false && Number(v.sucursal_id) === Number(sucursalId) &&
    !objetivos.plantilla.some((p) => Number(p.vendedor_id) === Number(v.id)));

  const agregarPersona = async (e) => {
    e.preventDefault();
    if (await agregar(vendedorId, desde)) {
      setVendedorId("");
      setDesde("");
    }
  };

  return (
    <section className="neu rounded-xl p-4 space-y-4">
      <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
        <Users size={18} className="text-blue-600" />
        Meta de la tienda y reparto
      </h2>
      <div className="flex flex-wrap gap-5 text-sm">
        <span>
          Meta de tienda: <strong>{pesos(objetivos.meta_tienda)}</strong>
        </span>
        <span>
          Asignado: <strong>{pesos(objetivos.asignado)}</strong>
        </span>
        <span className={objetivos.sin_asignar !== 0 ? "text-red-700" : "text-slate-600"}>
          Sin asignar: <strong>{pesos(objetivos.sin_asignar)}</strong>
        </span>
      </div>
      <div>
        <h3 className="font-medium text-sm text-slate-700">Plantilla del mes</h3>
        {objetivos.plantilla.length ? (
          <ul className="text-sm mt-2 space-y-1">
            {objetivos.plantilla.map((p) => (
              <li key={p.vendedor_id}>
                {nombre(p.vendedor_id)} · Desde {p.desde}
                {p.hasta ? ` · hasta ${p.hasta} · ${p.motivo_baja}` : (
                  !objetivos.cerrado && (
                    <button type="button" onClick={() => darBaja({
                      ...p, hasta: "", motivo: "",
                    })} className="text-red-700 hover:underline ml-3">
                      Dar de baja
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Todavía no hay personas en la plantilla.</p>}
      </div>
      {/* La plantilla forma parte del sello y no se cambia después del cierre. */}
      {!objetivos.cerrado && (
        <>
          <form onSubmit={agregarPersona} className="border-t border-slate-100 pt-3 space-y-2">
            <h3 className="font-medium text-sm text-slate-700">Agregar a la plantilla del mes</h3>
            <label className="block text-sm">
              Vendedor
              <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} required
                className="block neu-campo rounded-lg px-3 py-2 mt-1 w-full">
                <option value="">Selecciona un vendedor</option>
                {disponibles.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              Desde (opcional; vacío = día 1)
              <input type="date" value={desde} min={`${mes}-01`} max={finDelMes(mes)}
                onChange={(e) => setDesde(e.target.value)} className="block neu-campo rounded-lg px-3 py-2 mt-1" />
            </label>
            <button disabled={!disponibles.some((v) => Number(v.id) === Number(vendedorId))}
              className="bg-blue-600 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40">
              Agregar a la plantilla
            </button>
            {!disponibles.length && <p className="text-sm text-slate-500">No hay vendedores activos pendientes de agregar.</p>}
          </form>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => editar(null, objetivos.meta_tienda)}
              className="bg-blue-600 text-white rounded-lg px-3 py-2 text-sm">
              Fijar meta de tienda
            </button>
            <button onClick={pedirSugerencia} className="border border-violet-300 text-violet-700 rounded-lg px-3 py-2 text-sm">
              Ver reparto sugerido
            </button>
          </div>
        </>
      )}
      {sugerencia && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm">
          <strong>Reparto sugerido</strong>
          {sugerencia.length ? (
            <ul className="mt-2">
              {sugerencia.map((s) => <li key={s.vendedor_id}>{nombre(s.vendedor_id)}: {pesos(s.monto)}</li>)}
            </ul>
          ) : <p className="mt-1">Primero fija la meta de tienda y registra la plantilla del mes.</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2">Vendedor</th>
              <th>Meta</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <FilaMeta titulo="Tienda" monto={objetivos.meta_tienda} historial={() => historial(null)} />
            {objetivos.lineas.map((l) => (
              <FilaMeta key={l.vendedor_id} titulo={nombre(l.vendedor_id)} monto={l.monto}
                historial={() => historial(l.vendedor_id)}
                editar={!objetivos.cerrado ? () => editar(l.vendedor_id, l.monto) : null} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilaMeta({ titulo, monto, historial, editar }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="py-2">{titulo}</td>
      <td>{pesos(monto)}</td>
      <td className="text-right space-x-3">
        {editar && <button onClick={editar} className="text-blue-600 hover:underline">Fijar meta</button>}
        <button onClick={historial} className="text-slate-600 hover:underline">
          <History size={15} className="inline mr-1" />
          Historial
        </button>
      </td>
    </tr>
  );
}
