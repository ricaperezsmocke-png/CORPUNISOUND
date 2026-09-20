import { Target } from "lucide-react";
import { diasDeAtraso, hoyLocal, pesos } from "./datos";

export default function CapturaVendedor({
  mes, objetivos, capturas, vendedorId, fecha, setFecha, monto, setMonto, capturar, corregir,
}) {
  const linea = objetivos.lineas.find((l) => Number(l.vendedor_id) === Number(vendedorId));
  const total = capturas.total_capturado || 0;
  const meta = linea?.monto || 0;
  const porcentaje = meta > 0 ? Math.round(total / meta * 100) : 0;
  const hoy = hoyLocal();
  const fechaValida = fecha >= `${mes}-01` && fecha <= hoy && fecha.slice(0, 7) === mes;
  const faltantes = capturas.dias_sin_capturar || [];

  return (
    <section className="neu rounded-xl p-4 space-y-4">
      <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
        <Target size={18} className="text-blue-600" />
        Mi objetivo de venta
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Dato titulo="Meta del mes" valor={pesos(meta)} />
        <Dato titulo="Capturado" valor={pesos(total)} />
        <Dato titulo="Avance" valor={`${porcentaje}%`} />
        <Dato titulo="Por alcanzar" valor={pesos(Math.max(0, meta - total))} />
      </div>
      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, porcentaje)}%` }} />
      </div>
      {/* El sello conserva las cifras: después solo la administradora puede rectificar el cierre. */}
      {!objetivos.cerrado && (
        <form onSubmit={(e) => {
          e.preventDefault();
          capturar(monto);
        }} className="border-t border-slate-100 pt-4">
          <p className="font-medium text-sm text-slate-700 mb-2">Captura del día</p>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-600">
              Fecha
              <input type="date" value={fecha} min={`${mes}-01`} max={hoy} required
                onChange={(e) => setFecha(e.target.value)} className="block neu-campo rounded-lg px-3 py-2 mt-1" />
            </label>
            <label className="text-sm text-slate-600">
              Monto vendido
              <input type="number" min="0" step="any" value={monto} required
                onChange={(e) => setMonto(e.target.value)} className="block neu-campo rounded-lg px-3 py-2 w-full mt-1" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={!fechaValida || monto === ""}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">
                Guardar captura
              </button>
              <button type="button" disabled={!fechaValida} onClick={() => capturar(0)}
                className="border border-slate-300 rounded-lg px-4 py-2 text-slate-700 disabled:opacity-40">
                No vendí nada ese día
              </button>
            </div>
          </div>
        </form>
      )}
      <div>
        <p className="font-medium text-sm text-red-700">Días sin capturar</p>
        <div className="text-sm text-red-600 mt-1 flex flex-wrap gap-2">
          {faltantes.length ? faltantes.map((dia) => objetivos.cerrado ? (
            <span key={dia}>{dia}</span>
          ) : (
            <button key={dia} type="button" onClick={() => setFecha(dia)} className="underline py-1">
              {dia}
            </button>
          )) : "Ninguno"}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[540px]">
          <thead>
            <tr className="border-b text-slate-500 text-left">
              <th className="py-2">Fecha</th>
              <th>Monto</th>
              <th>Estado</th>
              <th>Capturó</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {capturas.capturas.map((c) => {
              const atraso = diasDeAtraso(c);
              return (
                <tr key={c.id} className={`border-b border-slate-100 ${c.vigente ? "" : "text-slate-400"}`}>
                  <td className="py-2">
                    {c.fecha}
                    {atraso > 0 && (
                      <p className="text-amber-800">
                        capturado {atraso} {atraso === 1 ? "día" : "días"} después
                      </p>
                    )}
                  </td>
                  <td>{pesos(c.monto)}</td>
                  <td>
                    {c.vigente ? (c.corrige_a ? "Corrección vigente" : "Vigente") : "Corregida"}
                    {c.corrige_a && c.motivo && <p className="text-slate-600">Motivo: {c.motivo}</p>}
                  </td>
                  <td>{c.capturado_por}</td>
                  <td>
                    {c.vigente && !objetivos.cerrado && (
                      <button onClick={() => corregir({ id: c.id, monto: c.monto, motivo: "" })}
                        className="text-blue-600 hover:underline">
                        Corregir
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Dato({ titulo, valor }) {
  return (
    <div>
      <span className="text-slate-500 block">{titulo}</span>
      <strong>{valor}</strong>
    </div>
  );
}
