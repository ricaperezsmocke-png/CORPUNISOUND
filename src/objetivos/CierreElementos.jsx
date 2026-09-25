import { ETIQUETAS_FINANCIERA, formatoUnidad, llaveCampo, restarEnCentavos, vigenteDeElemento } from "./marcas";

export const GRUPOS_CIERRE = [
  { grupo: "marcas", clave: "marca_id", titulo: "Marcas", unidad: "pesos", real: "Real de SICAR" },
  { grupo: "productos", clave: "producto_meta_id", titulo: "Productos", unidad: "piezas", real: "Real de SICAR" },
  { grupo: "creditos", clave: "financiera", titulo: "Créditos", unidad: "creditos", real: "Real de la financiera" },
];
const CAMPO = "neu-campo rounded-lg px-2 py-1 w-28 text-right";
const CAMPO_FALTANTE = "neu-campo rounded-lg px-2 py-1 w-28 text-right ring-2 ring-red-500";
const TABLA = "w-full text-sm min-w-[760px] [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2";
const FILA = "odd:bg-white even:bg-blue-50 border-b border-blue-100";

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
    <div className="space-y-4 min-w-0">
      <h3 className="font-medium text-slate-700">Marcas, productos y créditos</h3>
      {conElementos.map((l) => (
        <div key={l.vendedor_id} className="border border-blue-200 rounded-lg overflow-x-auto space-y-3">
          <h4 className="font-medium bg-blue-600 text-white px-3 py-2">{nombre(l.vendedor_id, l)}</h4>
          {GRUPOS_CIERRE.filter(({ grupo }) => (l[grupo] || []).length > 0).map(({ grupo, clave, titulo, unidad, real }) => (
            <table key={grupo} className={TABLA}>
              <thead>
                <tr className="bg-blue-600 text-white text-left">
                  <th className="py-1 w-1/4">{titulo}</th>
                  <th>Meta</th>
                  <th>{grupo === "creditos" ? "Registrados" : "Capturado"}</th>
                  <th>{real}</th>
                  <th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {l[grupo].map((e) => {
                  const capturado = Number(e.capturado ?? e.registrados);
                  const llave = llaveCampo(l.vendedor_id, grupo, e[clave]);
                  if (!sellado) {
                    const valor = valores[llave] ?? "";
                    return (
                      <tr key={e[clave]} className={FILA}>
                        <td className="py-1">{nombreElemento(grupo, e)}</td>
                        <td>{formatoUnidad(unidad, e.meta)}</td>
                        <td>{formatoUnidad(unidad, capturado)}</td>
                        <td>
                          <input type="number" min="0" step={unidad === "pesos" ? "any" : "1"} value={valor}
                            aria-label={`${real} de ${nombreElemento(grupo, e)} de ${nombre(l.vendedor_id, l)}`}
                            onChange={(ev) => cambiar(llave, ev.target.value)}
                            className={faltantes.includes(llave) ? CAMPO_FALTANTE : CAMPO} />
                        </td>
                        <td>{valor === "" ? "Pendiente" : textoDiferencia(unidad, restarEnCentavos(capturado, valor))}</td>
                      </tr>
                    );
                  }
                  const propias = rectificaciones.filter((r) => r.vendedor_id === l.vendedor_id);
                  const vigente = vigenteDeElemento(e, propias, clave);
                  return (
                    <tr key={e[clave]} className={FILA}>
                      <td className="py-1">{nombreElemento(grupo, e)}</td>
                      {["meta", "capturado", "real"].map((campo) => {
                        const original = campo === "capturado" ? capturado : e[campo];
                        const rectificado = propias.some((r) => r[clave] === e[clave] && r.campo === campo);
                        const etiqueta = campo === "capturado" && grupo === "creditos" ? "registrados" : campo;
                        const rotulo = `${etiqueta} de ${nombreElemento(grupo, e)}`;
                        return (
                          <td key={campo}>
                            {rectificado ? <>
                              <del className="block text-slate-500">{formatoUnidad(unidad, original)}</del>
                              <p>{formatoUnidad(unidad, vigente[campo])}</p>
                              <span className="block text-violet-700 text-xs">rectificado</span>
                            </> : formatoUnidad(unidad, vigente[campo])}
                            <button type="button" className="block text-blue-600 hover:underline"
                              aria-label={`Rectificar ${rotulo} de ${nombre(l.vendedor_id, l)}`} onClick={() => rectificar({
                                vendedor_id: l.vendedor_id, clave, id: e[clave], unidad, grupo, campo, rotulo,
                                valor_actual: vigente[campo], valor_nuevo: vigente[campo], motivo: "",
                              })}>
                              Rectificar
                            </button>
                          </td>
                        );
                      })}
                      <td>{textoDiferencia(unidad, restarEnCentavos(vigente.capturado, vigente.real))}</td>
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
