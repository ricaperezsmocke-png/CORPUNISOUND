import { ETIQUETAS_FINANCIERA, formatoUnidad, llaveCampo, vigenteDeElemento } from "./marcas";

export const GRUPOS_CIERRE = [
  { grupo: "marcas", clave: "marca_id", titulo: "Marcas", unidad: "pesos", real: "Real de SICAR" },
  { grupo: "productos", clave: "producto_meta_id", titulo: "Productos", unidad: "piezas", real: "Real de SICAR" },
  { grupo: "creditos", clave: "financiera", titulo: "Créditos", unidad: "creditos", real: "Real de la financiera" },
];
const CAMPO = "neu-campo rounded-lg px-2 py-1 w-28 text-right";
const CAMPO_FALTANTE = "neu-campo rounded-lg px-2 py-1 w-28 text-right ring-2 ring-red-500";

export const nombreElemento = (grupo, e) =>
  (grupo === "creditos" ? ETIQUETAS_FINANCIERA[e.financiera] || e.financiera : e.nombre) || "—";

function textoDiferencia(unidad, n) {
  if (!Number.isFinite(n)) return "Pendiente";
  if (n === 0) return "Cuadra";
  return `${formatoUnidad(unidad, Math.abs(n))} ${n > 0 ? "más" : "menos"} de lo real`;
}

// Tablas de marcas, productos y créditos por persona. En modo captura (previo) pide el real de
// cada elemento; en modo sellado muestra real, diferencia y rectificaciones del elemento.
export default function CierreElementos({ lineas, nombre, valores, cambiar, faltantes = [], rectificaciones, rectificar }) {
  const sellado = Boolean(rectificaciones);
  const conElementos = lineas.filter((l) => GRUPOS_CIERRE.some(({ grupo }) => (l[grupo] || []).length > 0));
  if (conElementos.length === 0) return null;
  return (
    <div className="space-y-4">
      <h3 className="font-medium text-slate-700">Marcas, productos y créditos</h3>
      {conElementos.map((l) => (
        <div key={l.vendedor_id} className="neu-panel rounded-xl p-3 space-y-3">
          <h4 className="font-medium text-slate-700">{nombre(l.vendedor_id, l)}</h4>
          {GRUPOS_CIERRE.filter(({ grupo }) => (l[grupo] || []).length > 0).map(({ grupo, clave, titulo, unidad, real }) => (
            <table key={grupo} className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-1 w-1/4">{titulo}</th>
                  <th>Meta</th>
                  <th>{grupo === "creditos" ? "Registrados" : "Capturado"}</th>
                  <th>{real}</th>
                  <th>Diferencia</th>
                  {sellado && <th />}
                </tr>
              </thead>
              <tbody>
                {l[grupo].map((e) => {
                  const capturado = Number(e.capturado ?? e.registrados);
                  const llave = llaveCampo(l.vendedor_id, grupo, e[clave]);
                  if (!sellado) {
                    const valor = valores[llave] ?? "";
                    return (
                      <tr key={e[clave]} className="border-b border-slate-100">
                        <td className="py-1">{nombreElemento(grupo, e)}</td>
                        <td>{formatoUnidad(unidad, e.meta)}</td>
                        <td>{formatoUnidad(unidad, capturado)}</td>
                        <td>
                          <input type="number" min="0" step={unidad === "pesos" ? "any" : "1"} value={valor}
                            aria-label={`${real} de ${nombreElemento(grupo, e)} de ${nombre(l.vendedor_id, l)}`}
                            onChange={(ev) => cambiar(llave, ev.target.value)}
                            className={faltantes.includes(llave) ? CAMPO_FALTANTE : CAMPO} />
                        </td>
                        <td>{valor === "" ? "Pendiente" : textoDiferencia(unidad, capturado - Number(valor))}</td>
                      </tr>
                    );
                  }
                  const propias = rectificaciones.filter((r) => r.vendedor_id === l.vendedor_id);
                  const vigente = vigenteDeElemento(e, propias, clave);
                  const cambio = (campo, original) => vigente[campo] !== original && (
                    <p className="text-violet-700">Rectificado: {formatoUnidad(unidad, vigente[campo])}</p>
                  );
                  return (
                    <tr key={e[clave]} className="border-b border-slate-100">
                      <td className="py-1">{nombreElemento(grupo, e)}</td>
                      <td>{formatoUnidad(unidad, e.meta)}{cambio("meta", e.meta)}</td>
                      <td>{formatoUnidad(unidad, capturado)}{cambio("capturado", capturado)}</td>
                      <td>{formatoUnidad(unidad, e.real)}{cambio("real", e.real)}</td>
                      <td>{textoDiferencia(unidad, Number(vigente.capturado) - Number(vigente.real))}</td>
                      <td>
                        <button type="button" className="text-blue-600 hover:underline" onClick={() => rectificar({
                          vendedor_id: l.vendedor_id, clave, id: e[clave], unidad, campo: "real", valor_nuevo: vigente.real, motivo: "",
                          titulo: `${nombreElemento(grupo, e)} de ${nombre(l.vendedor_id, l)}`,
                        })}>
                          Rectificar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      ))}
    </div>
  );
}
