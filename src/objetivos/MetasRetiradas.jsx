// Metas eliminadas del mes (decisión de Victor 2026-10-08: "quiero que quede el historial aun ya borrado").
// Solo informa: ya no cuentan en el cierre, pero quien lo revise ve qué se quitó, quién y por qué.
const TABLA = "w-full text-sm border-collapse";
const FILA = "border-b border-slate-100";
const fechaHora = (iso) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
const cifra = (r) => (r.tipo === "venta" || r.tipo === "marca"
  ? r.monto.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
  : String(r.monto));

export default function MetasRetiradas({ retiradas, nombre }) {
  if (!retiradas?.length) return null;
  return (
    <div>
      <h3 className="font-medium text-slate-700 mb-2">Metas eliminadas este mes</h3>
      <p className="text-sm text-slate-500 mb-2">Ya no cuentan en el cierre. Se muestran para que quede constancia.</p>
      <div className="overflow-x-auto max-w-full">
        <table className={TABLA}>
          <thead><tr className="bg-slate-600 text-white text-left">
            <th>Meta</th><th>De</th><th>Cifra</th><th>Eliminada por</th><th>Cuándo</th><th>Motivo</th>
          </tr></thead>
          <tbody>
            {retiradas.map((r) => (
              <tr key={r.id} className={FILA}>
                <td className="py-2">{r.elemento}</td>
                <td>{r.vendedor_id == null ? "Tienda" : nombre(r.vendedor_id)}</td>
                <td><del>{cifra(r)}</del></td>
                <td>{r.retirada.por_nombre}</td>
                <td>{fechaHora(r.retirada.en)}</td>
                <td className="break-words">{r.retirada.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
