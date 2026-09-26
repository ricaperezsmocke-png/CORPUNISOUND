import { useCallback, useEffect, useState } from "react";
import { FranjaAyuda } from "./Ayuda";
import { CreditCard } from "lucide-react";
import { apiFetch } from "../api";
import { Campo, Modal } from "./DialogosObjetivos";
import { hoyLocal, leer } from "./datos";
import { ETIQUETAS_FINANCIERA, creditoCompleto, pesosConCentavos } from "./marcas";

const CAMPO = "block neu-campo rounded-lg px-3 py-2 mt-1 w-full";
const vacio = (mes) => ({ financiera: "", fecha: mes === hoyLocal().slice(0, 7) ? hoyLocal() : `${mes}-01`, monto: "", folio: "", nota: "" });

// Créditos Coppel Pay / Atrato de la propia persona, uno por uno con folio de la financiera.
// El servidor valida folio único en toda la empresa, fecha, plantilla y mes cerrado.
export default function CreditosVendedor({ mes, sucursalId, vendedorId, objetivos }) {
  const [financieras, setFinancieras] = useState([]);
  const [datos, setDatos] = useState(null);
  const [forma, setForma] = useState(() => vacio(mes));
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [anulando, setAnulando] = useState(null);
  const cerrado = objetivos.cerrado;
  const hoy = hoyLocal();
  const maxFecha = mes === hoy.slice(0, 7) ? hoy : undefined;

  const cargar = useCallback(async () => {
    try {
      setDatos(await apiFetch(`/objetivos/${mes}/${sucursalId}/creditos/${vendedorId}`)
        .then((r) => leer(r, "No se pudieron cargar tus créditos")));
    } catch (e) {
      setError(e.message);
    }
  }, [mes, sucursalId, vendedorId]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setForma(vacio(mes)); }, [mes]);
  useEffect(() => {
    let vigente = true;
    apiFetch("/objetivos/financieras").then((r) => leer(r, "No se pudieron cargar las financieras"))
      .then((lista) => { if (vigente) setFinancieras(lista); })
      .catch((e) => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, []);

  const registrar = async (e) => {
    e.preventDefault();
    setError("");
    setExito("");
    setEnviando(true);
    try {
      await apiFetch("/objetivos/credito", {
        method: "POST",
        body: JSON.stringify({
          mes, fecha: forma.fecha, sucursal_id: Number(sucursalId), vendedor_id: vendedorId,
          financiera: forma.financiera, folio: forma.folio, monto: Number(forma.monto), nota: forma.nota,
        }),
      }).then((r) => leer(r, "No se pudo registrar el crédito"));
      setForma((actual) => ({ ...actual, monto: "", folio: "", nota: "" }));
      setExito("Crédito registrado.");
      await cargar();
    } catch (err) {
      // El formulario se conserva: el folio repetido se corrige ahí mismo.
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const anular = async () => {
    setAnulando((actual) => ({ ...actual, error: "" }));
    try {
      await apiFetch(`/objetivos/credito/${anulando.id}/anular`, {
        method: "POST", body: JSON.stringify({ motivo: anulando.motivo }),
      }).then((r) => leer(r, "No se pudo anular el crédito"));
      setAnulando(null);
      setExito("Crédito anulado; queda en la lista tachado con su motivo.");
      await cargar();
    } catch (err) {
      setAnulando((actual) => ({ ...actual, error: err.message }));
    }
  };

  const etiqueta = (clave) => financieras.find((f) => f.clave === clave)?.etiqueta || ETIQUETAS_FINANCIERA[clave] || clave;
  const metaDe = (clave) => (objetivos.creditos || []).find((c) => c.financiera === clave)?.lineas
    ?.find((l) => Number(l.vendedor_id) === Number(vendedorId))?.monto;
  const registros = datos?.registros || [];

  return (
    <section className="neu rounded-xl p-4 space-y-4">
      <FranjaAyuda clave="mis-creditos">
        <p>Registra cada venta financiada con Coppel Pay o Atrato con su folio. El mismo folio no se puede registrar dos veces.</p>
      </FranjaAyuda>
      <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
        <CreditCard size={18} className="text-blue-600" aria-hidden="true" />
        Mis créditos
      </h2>
      <div className="flex flex-wrap gap-6 text-sm">
        {(datos?.resumen || []).map((r) => {
          const meta = metaDe(r.financiera);
          return (
            <div key={r.financiera}>
              <span className="text-slate-500 block">{r.etiqueta || etiqueta(r.financiera)}</span>
              <strong className="text-lg">{r.registrados}</strong>
              {meta != null && <span className="text-slate-600"> de {meta}</span>}
            </div>
          );
        })}
      </div>
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>}
      {exito && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">{exito}</div>}
      {!cerrado && (
        <form onSubmit={registrar} className="border-t border-slate-100 pt-4 grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <label className="text-slate-600">
            Financiera
            <select value={forma.financiera} onChange={(e) => setForma({ ...forma, financiera: e.target.value })} className={CAMPO}>
              <option value="">Elige…</option>
              {financieras.map((f) => <option key={f.clave} value={f.clave}>{f.etiqueta}</option>)}
            </select>
          </label>
          <label className="text-slate-600">
            Fecha
            <input type="date" value={forma.fecha} min={`${mes}-01`} max={maxFecha}
              onChange={(e) => setForma({ ...forma, fecha: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-slate-600">
            Monto financiado
            <input type="number" min="0.01" step="any" value={forma.monto}
              onChange={(e) => setForma({ ...forma, monto: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-slate-600">
            Folio de la financiera
            <input type="text" value={forma.folio} maxLength={40}
              onChange={(e) => setForma({ ...forma, folio: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-slate-600 col-span-2">
            Nota (opcional)
            <input type="text" value={forma.nota} maxLength={300}
              onChange={(e) => setForma({ ...forma, nota: e.target.value })} className={CAMPO} />
          </label>
          <div className="col-span-2 lg:col-span-3">
            <button type="submit" disabled={enviando || !creditoCompleto(forma)}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">
              Registrar crédito
            </button>
          </div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-slate-500 text-left">
              <th className="py-2">Fecha</th>
              <th>Financiera</th>
              <th>Folio</th>
              <th>Monto</th>
              <th>Nota</th>
              <th>Registró</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {registros.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-slate-500">Todavía no registras créditos este mes.</td></tr>
            )}
            {registros.map((c) => (
              <tr key={c.id} className={`border-b border-slate-100 align-top ${c.vigente ? "" : "text-slate-400"}`}>
                <td className={`py-2 ${c.vigente ? "" : "line-through"}`}>{c.fecha}</td>
                <td className={c.vigente ? "" : "line-through"}>{etiqueta(c.financiera)}</td>
                <td className={c.vigente ? "" : "line-through"}>{c.folio}</td>
                <td className={c.vigente ? "" : "line-through"}>{pesosConCentavos(c.monto)}</td>
                <td>
                  {c.nota}
                  {!c.vigente && (
                    <p className="text-slate-600 no-underline">
                      Anulado por {c.anulado_por} el {new Date(c.anulado_en).toLocaleString("es-MX")}: {c.motivo_anulacion}
                    </p>
                  )}
                </td>
                <td>{c.registrado_por}</td>
                <td>
                  {c.vigente && !cerrado && (
                    <button type="button" className="text-red-700 hover:underline"
                      onClick={() => setAnulando({ id: c.id, folio: c.folio, motivo: "", error: "" })}>
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anulando && !cerrado && (
        <Modal titulo={`Anular el crédito ${anulando.folio}`} cerrar={() => setAnulando(null)} guardar={anular}
          deshabilitado={!anulando.motivo.trim()}>
          <Campo etiqueta="Motivo obligatorio" valor={anulando.motivo}
            cambiar={(motivo) => setAnulando({ ...anulando, motivo })} area />
          {anulando.error && <p role="alert" className="text-sm text-red-700">{anulando.error}</p>}
        </Modal>
      )}
    </section>
  );
}
