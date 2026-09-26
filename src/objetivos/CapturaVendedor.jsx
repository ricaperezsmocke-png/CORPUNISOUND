import { useState } from "react";
import { FranjaAyuda, AyudaBoton } from "./Ayuda";
import { diasDeAtraso, fechaCorta, fechaLarga, finDelMes, hoyLocal, resumenVenta, ventaDelDia } from "./datos";
import { esCapturaDeVenta, pesosConCentavos } from "./marcas";

const boton = "bg-blue-600 text-white rounded-lg px-5 py-3 disabled:opacity-40";
const celda = "px-3 py-3 align-top";

export default function CapturaVendedor({
  mes, objetivos, capturas, vendedorId, fecha, setFecha, monto, setMonto, capturar, corregir, verAvance,
}) {
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const linea = objetivos.lineas.find((l) => Number(l.vendedor_id) === Number(vendedorId));
  const resumen = resumenVenta({ meta: linea?.monto || 0, total: capturas.total_capturado || 0 });
  const hoy = hoyLocal();
  const fechaValida = fecha >= `${mes}-01` && fecha <= hoy && fecha.slice(0, 7) === mes;
  const faltantes = capturas.dias_sin_capturar || [];
  const venta = ventaDelDia(capturas.capturas, fecha);
  const abrirCorreccion = (c) => corregir({ id: c.id, monto: c.monto, motivo: "", fecha: c.fecha, montoAnterior: c.monto });

  return (
    <section className="neu rounded-xl p-4 space-y-5">
      <FranjaAyuda clave="mi-venta">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Al final del día escribe cuánto vendiste y presiona <strong>Guardar</strong>.</li>
          <li>Si no vendiste nada, presiona <strong>No vendí nada ese día</strong>. No lo dejes en blanco: un día sin capturar cuenta como pendiente.</li>
          <li>¿Te faltó un día? Tócalo en la lista de días sin capturar.</li>
          <li>¿Te equivocaste? Usa <strong>Corregir</strong>: pide motivo y la versión anterior queda guardada.</li>
        </ol>
      </FranjaAyuda>
      <div className="flex items-center gap-4 text-sm">
        <p>{resumen.texto}</p>
        <button type="button" onClick={verAvance} className="text-blue-600 hover:underline">Ver Mi avance →</button>
      </div>
      {!objetivos.cerrado && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-slate-800">
              {fecha === hoy ? `Venta de hoy · ${fechaLarga(fecha)}` : `Venta del ${fechaCorta(fecha)}`}
            </h2>
            <button type="button" onClick={() => setMostrarFecha(!mostrarFecha)}
              aria-expanded={mostrarFecha} className="text-sm text-blue-600 hover:underline">cambiar día</button>
          </div>
          {mostrarFecha && (
            <label className="block text-sm text-slate-600">
              Fecha
              <input type="date" value={fecha} min={`${mes}-01`} max={hoy < finDelMes(mes) ? hoy : finDelMes(mes)} required
                onChange={(e) => setFecha(e.target.value)} className="block neu-campo rounded-lg px-3 py-2 mt-1" />
            </label>
          )}
          {venta ? (
            <div className="flex items-center gap-5">
              <p className="text-2xl font-semibold text-emerald-800">
                {Number(venta.monto) === 0 ? "✔ Registraste que no vendiste nada" : `✔ Registraste ${pesosConCentavos(venta.monto)}`}
              </p>
              <button type="button" onClick={() => abrirCorreccion(venta)} className={boton}>Corregir</button>
              <AyudaBoton texto="Cambia el importe. Tu jefa ve el motivo y el importe anterior." />
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); capturar(monto); }}>
              <label className="block text-slate-700">
                Importe vendido
                <input type="number" min="0" step="any" value={monto} required
                  onChange={(e) => setMonto(e.target.value)}
                  className="block neu-campo rounded-lg px-4 py-3 w-full max-w-md mt-2 text-3xl" />
              </label>
              <div className="flex items-center gap-4">
                <button disabled={!fechaValida || monto === ""} className={boton}>Guardar</button>
                <AyudaBoton texto="Registra tu venta del día. Solo se captura una vez por día; para cambiarla usa Corregir." />
                <button type="button" disabled={!fechaValida} onClick={() => capturar(0)}
                  className="text-slate-700 underline disabled:opacity-40">No vendí nada ese día</button>
              </div>
            </form>
          )}
        </div>
      )}
      <div className="text-sm">
        {faltantes.length ? (
          <div className="text-amber-800 flex flex-wrap items-center gap-2">
            <p className="font-medium">⚠ Tienes {faltantes.length} {faltantes.length === 1 ? "día" : "días"} sin capturar:</p>
            {faltantes.map((dia) => objetivos.cerrado ? <span key={dia}>{fechaCorta(dia)}</span> : (
              <button key={dia} type="button" onClick={() => setFecha(dia)} className="underline px-2 py-1">
                {fechaCorta(dia)}
              </button>
            ))}
          </div>
        ) : <p className="font-medium text-emerald-700">✔ Estás al día</p>}
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold text-slate-700">Historial</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] text-left">
            <thead className="bg-blue-600 text-white">
              <tr>
                <th className={celda}>Fecha</th><th className={celda}>Importe</th><th className={celda}>Estado</th>
                <th className={celda}>Capturó</th><th className={celda}><span className="sr-only">Acción</span></th>
              </tr>
            </thead>
            <tbody>
              {capturas.capturas.filter(esCapturaDeVenta).map((c) => {
                const atraso = diasDeAtraso(c);
                const fila = `border-b border-slate-100 odd:bg-white even:bg-blue-50 ${c.vigente ? "" : "text-slate-400 line-through"}`;
                return (
                  <tr key={c.id} className={fila}>
                    <td className={celda}>
                      {fechaCorta(c.fecha)}
                      {atraso > 0 && <p className="text-amber-800">capturado {atraso} {atraso === 1 ? "día" : "días"} después</p>}
                    </td>
                    <td className={celda}>{pesosConCentavos(c.monto)}</td>
                    <td className={celda}>
                      {c.vigente ? (c.corrige_a ? "Corrección vigente" : "Vigente") : "Corregida"}
                      {c.corrige_a && c.motivo && <p>Motivo: {c.motivo}</p>}
                    </td>
                    <td className={celda}>{c.capturado_por}</td>
                    <td className={celda}>
                      {c.vigente && !objetivos.cerrado && (
                        <button type="button" onClick={() => abrirCorreccion(c)} className="text-blue-600 hover:underline">Corregir</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
