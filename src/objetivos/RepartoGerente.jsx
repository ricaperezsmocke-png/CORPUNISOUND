import { useState } from "react";
import { FranjaAyuda, AyudaBoton } from "./Ayuda";
import { History, Users, Target, WandSparkles } from "lucide-react";
import { estadoReparto, fechaCorta, filasReparto, finDelMes, sugerenciaGuardada } from "./datos";

import { pesosConCentavos } from "./marcas";

const celda = "px-3 py-3 align-top";
const boton = "flex items-center gap-2 border border-blue-200 text-blue-700 rounded-lg px-3 py-2 text-sm";
const tonos = { falta: "text-amber-700", completo: "text-emerald-700", exceso: "text-red-700", sin_meta: "text-slate-500" };

export default function RepartoGerente({
  mes, sucursalId, objetivos, equipo, nombre, agregar, editar, historial, sugerencia, pedirSugerencia, darBaja,
}) {
  const [vendedorId, setVendedorId] = useState("");
  const [personalAbierto, setPersonalAbierto] = useState(false);
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

  const estado = estadoReparto({ meta: objetivos.meta_tienda, sinAsignar: objetivos.sin_asignar, unidad: "pesos" });
  const filas = filasReparto(objetivos);

  return (
    <section className="neu rounded-xl p-4 space-y-4">
      <FranjaAyuda clave="tienda-venta">
        <ol className="list-decimal pl-5 space-y-1">
          <li><strong>Fijar meta de tienda</strong>: cuánto debe vender la tienda en el mes.</li>
          <li><strong>Personal del mes</strong>: quiénes trabajan este mes y desde qué día.</li>
          <li><strong>Sugerir reparto</strong> y presiona <strong>Usar</strong> en cada persona, o fija cada meta a mano.</li>
          <li>Revisa arriba que diga <strong>✔ Reparto completo</strong>.</li>
        </ol>
      </FranjaAyuda>
      <div className="grid grid-cols-3 gap-5">
        <div>
          <h2 className="text-sm text-slate-500">META DE TIENDA</h2>
          <p className="text-2xl font-semibold">{pesosConCentavos(objetivos.meta_tienda)}</p>
        </div>
        <div>
          <h2 className="text-sm text-slate-500">ASIGNADO</h2>
          <p className="text-2xl font-semibold">{pesosConCentavos(objetivos.asignado)}</p>
        </div>
        <p role="status" className={`text-2xl font-semibold ${tonos[estado.tono]}`}>{estado.texto}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!objetivos.cerrado && (
          <>
            <button type="button" onClick={() => editar(null, objetivos.meta_tienda)} className={boton}>
              <Target size={18} aria-hidden="true" />Fijar meta de tienda
            </button>
            <button type="button" onClick={pedirSugerencia} className={boton}>
              <WandSparkles size={18} aria-hidden="true" />Sugerir reparto
            </button>
            <AyudaBoton texto="Propone partes iguales. No guarda nada hasta que presiones Usar." />
          </>
        )}
        <button type="button" onClick={() => setPersonalAbierto(true)} className={boton}>
          <Users size={18} aria-hidden="true" />Personal del mes
        </button>
        <button type="button" onClick={() => historial(null)} className={boton}>
          <History size={18} aria-hidden="true" />Historial de tienda
        </button>
      </div>
      {sugerencia?.length === 0 && (
        <p className="text-sm text-violet-700">Primero fija la meta de tienda y registra el personal del mes.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm text-left">
          <thead className="bg-blue-600 text-white">
            <tr>
              <th className={celda}>Persona</th><th className={celda}>En tienda</th><th className={celda}>Meta</th>
              {sugerencia && (
                <th className={celda}>
                  <p className="font-normal text-xs mb-2">La sugerencia no guarda nada: usa "Usar" en cada persona.</p>
                  Sugerida
                </th>
              )}
              <th className={celda}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const sugerida = sugerencia?.find((item) => Number(item.vendedor_id) === fila.vendedor_id);
              return (
                <tr key={fila.vendedor_id} className="border-b border-slate-100 odd:bg-white even:bg-blue-50">
                  <td className={celda}>{nombre(fila.vendedor_id)}</td>
                  <td className={celda}><Periodo persona={fila} /></td>
                  <td className={celda}>{fila.monto == null ? "—" : pesosConCentavos(fila.monto)}</td>
                  {sugerencia && (
                    <td className={celda}>
                      {sugerida ? (
                        <>
                          {pesosConCentavos(sugerida.monto)}
                          {sugerenciaGuardada(sugerida, objetivos.lineas) ? (
                            <span className="ml-2 text-emerald-700">✔ Guardada</span>
                          ) : !objetivos.cerrado && (
                            <button type="button" onClick={() => editar(fila.vendedor_id, sugerida.monto)}
                              className="ml-2 text-blue-600 hover:underline">Usar</button>
                          )}
                        </>
                      ) : "—"}
                    </td>
                  )}
                  <td className={`${celda} space-x-3`}>
                    {!objetivos.cerrado && (
                      <button type="button" onClick={() => editar(fila.vendedor_id, fila.monto ?? "")}
                        className="text-blue-600 hover:underline">Fijar meta</button>
                    )}
                    <button type="button" onClick={() => historial(fila.vendedor_id)} className="text-blue-600 hover:underline">
                      Historial
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {personalAbierto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-label="Personal del mes"
            className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[85dvh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">
                Personal del mes
                <AyudaBoton texto="La persona deja de contar desde ese día; su historia se conserva." />
              </h3>
              <button type="button" onClick={() => setPersonalAbierto(false)} className={boton}>Cerrar</button>
            </div>
            {objetivos.plantilla.length ? (
              <ul className="text-sm divide-y divide-slate-100">
                {objetivos.plantilla.map((p) => (
                  <li key={p.vendedor_id} className="py-3 flex items-start justify-between gap-3">
                    <div><p className="font-medium">{nombre(p.vendedor_id)}</p><Periodo persona={p} /></div>
                    {!objetivos.cerrado && !p.hasta && (
                      <button type="button" className="text-red-700 hover:underline" onClick={() => {
                        setPersonalAbierto(false);
                        darBaja({ ...p, hasta: "", motivo: "" });
                      }}>Dar de baja</button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Todavía no hay personas en el personal del mes.</p>}
            {!objetivos.cerrado && (
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
            <button type="submit" disabled={!disponibles.some((v) => Number(v.id) === Number(vendedorId))}
              className="bg-blue-600 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40">
              Agregar a la plantilla
            </button>
            {!disponibles.length && <p className="text-sm text-slate-500">No hay vendedores activos pendientes de agregar.</p>}
          </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Periodo({ persona }) {
  if (!persona.desde) return "—";
  return (
    <div>
      {persona.hasta ? `${fechaCorta(persona.desde)}–${fechaCorta(persona.hasta)}` : `desde ${fechaCorta(persona.desde)}`}
      {persona.hasta && <p className="text-slate-500">{persona.motivo_baja}</p>}
    </div>
  );
}
