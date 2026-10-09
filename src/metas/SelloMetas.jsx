import { useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { Campo, Modal } from "../objetivos/DialogosObjetivos";
import { periodoTerminado } from "./metas";
import { ENLACE, fechaHora } from "./Comunes";

const TABLA = "w-full text-sm border-collapse";
const FILA = "border-b border-slate-100";
const AVISO = "bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm flex flex-wrap gap-3 items-center";

const deQuien = (r, sucursales, vendedores) => (r.alcance === "tienda"
  ? sucursales.find((s) => s.id === r.sucursal_id)?.nombre || "Tienda"
  : r.alcance === "persona" ? vendedores.find((v) => v.id === r.vendedor_id)?.nombre || "Persona" : "Empresa");

// Resultado vigente de una meta sellada: la última rectificación o, si no hay, el sellado.
const vigenteDe = (sello, r) => sello.rectificaciones.filter((x) => x.meta_clave === r.clave).at(-1)?.valor_nuevo ?? r.resultado;

// Sellar el periodo cuando ya terminó, y ver lo sellado (con sus correcciones y lo eliminado).
export default function SelloMetas({ periodo, inicio, hoy, sello, sucursales, vendedores, alCambiar }) {
  const [previo, setPrevio] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const base = `periodo=${periodo}&inicio=${inicio}`;

  if (!sello && !periodoTerminado(periodo, inicio, hoy)) return null;

  const revisar = async () => {
    setError("");
    try { setPrevio(await apiFetch(`/metas/sello/previo?${base}`).then((r) => leer(r, "No se pudo preparar el sello"))); } catch (e) { setError(e.message); }
  };
  const sellar = async () => {
    if (enviando) return;
    setEnviando(true);
    setError("");
    try {
      await apiFetch("/metas/sello", { method: "POST", body: JSON.stringify({ periodo, inicio }) }).then((r) => leer(r, "No se pudo sellar"));
      setPrevio(null);
      await alCambiar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };

  if (!sello) {
    return (
      <>
        <div className={AVISO}>
          <span className="flex-1">Este periodo ya terminó. Revisa los resultados y séllalo.</span>
          <button type="button" className="bg-amber-600 text-white rounded-lg px-4 py-2" onClick={revisar}>Revisar y sellar</button>
        </div>
        {error && !previo && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {previo && (
          <Modal titulo="Sellar el periodo" cerrar={() => setPrevio(null)} guardar={sellar} textoGuardar="Sellar" deshabilitado={enviando}
            error={error} focoEnCerrar>
            <table className={TABLA}>
              <thead><tr className="text-left text-slate-500"><th>Meta</th><th>De</th><th>Resultado</th><th>%</th></tr></thead>
              <tbody>
                {previo.resultados.map((r) => (
                  <tr key={r.clave} className={FILA}>
                    <td className="py-1">{r.nombre}</td><td>{deQuien(r, sucursales, vendedores)}</td>
                    <td>{r.resultado} de {r.valor_meta}</td><td>{r.porcentaje}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-amber-800">Después de sellar ya no se puede capturar, quitar ni cambiar nada; solo corregir el resultado con motivo.</p>
          </Modal>
        )}
      </>
    );
  }

  const eliminadas = [...(sello.foto.okrs_retirados || []).map((o) => ({ ...o, nombre: `OKR: ${o.titulo}` })), ...(sello.foto.retiradas || [])];
  return (
    <section className="bg-slate-100 rounded-xl p-4 space-y-3">
      <p className="text-sm text-slate-700">🔒 Sellado por {sello.sellado_por} el {fechaHora(sello.sellado_en)}</p>
      <table className={TABLA}>
        <thead><tr className="text-left text-slate-500"><th>Meta</th><th>De</th><th>Resultado</th><th /></tr></thead>
        <tbody>
          {sello.foto.resultados.map((r) => {
            const vigente = vigenteDe(sello, r);
            return (
              <tr key={r.clave} className={FILA}>
                <td className="py-1">{r.nombre}</td>
                <td>{deQuien(r, sucursales, vendedores)}</td>
                <td>
                  {vigente !== r.resultado && <del className="text-slate-400 mr-2">{r.resultado}</del>}
                  {vigente} de {r.valor_meta}
                </td>
                <td><button type="button" className={ENLACE} onClick={() => setCorrigiendo({ ...r, vigente })}>Corregir</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {eliminadas.length > 0 && (
        <div className="text-sm">
          <h4 className="font-medium text-slate-700">Eliminadas en este periodo</h4>
          <ul>
            {eliminadas.map((r) => (
              <li key={`${r.titulo ? "okr" : "meta"}-${r.id}`}>
                <del>{r.nombre}</del>{" "}
                <span className="text-red-700">· {r.retirada.por_nombre} · {fechaHora(r.retirada.en)} · Motivo: {r.retirada.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {corrigiendo && (
        <Corregir sello={sello} meta={corrigiendo} cerrar={() => setCorrigiendo(null)}
          alTerminar={async () => { setCorrigiendo(null); await alCambiar(); }} />
      )}
    </section>
  );
}

function Corregir({ sello, meta, cerrar, alTerminar }) {
  const [valor, setValor] = useState(String(meta.vigente));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const listo = valor !== "" && Number.isInteger(Number(valor)) && Number(valor) >= 0 && motivo.trim();
  const guardar = async () => {
    if (enviando || !listo) return;
    setEnviando(true);
    setError("");
    try {
      await apiFetch(`/metas/sello/${sello.id}/rectificar`, {
        method: "POST", body: JSON.stringify({ meta_clave: meta.clave, valor_nuevo: Number(valor), motivo: motivo.trim() }),
      }).then((r) => leer(r, "No se pudo corregir"));
      await alTerminar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo={`Corregir resultado: ${meta.nombre}`} cerrar={cerrar} guardar={guardar} deshabilitado={enviando || !listo} error={error}>
      <p className="text-sm text-slate-600">El resultado sellado ({meta.resultado}) queda a la vista; la cifra meta no se puede cambiar.</p>
      <Campo etiqueta="Resultado correcto" tipo="number" valor={valor} cambiar={setValor} />
      <Campo etiqueta="Motivo" valor={motivo} cambiar={setMotivo} area />
    </Modal>
  );
}
