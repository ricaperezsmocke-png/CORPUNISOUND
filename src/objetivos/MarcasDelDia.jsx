import { useEffect, useState } from "react";
import { Package, Tags } from "lucide-react";
import { apiFetch } from "../api";
import { Campo, Modal } from "./DialogosObjetivos";
import { diasDeAtraso, leer } from "./datos";
import { pesosConCentavos, renglonesDelDia, resumenMarcasDelDia, sumarEnCentavos } from "./marcas";

const TIPOS = [
  {
    tipo: "marca", clave: "marca_id", lista: "marcas", totales: "total_por_marca", step: "0.01",
    titulo: "¿De qué marcas fue?", unidad: "Pesos", Icono: Tags, otra: "+ otra marca",
  },
  {
    tipo: "producto", clave: "producto_meta_id", lista: "productos", totales: "total_por_producto", step: "1",
    titulo: "Piezas por producto", unidad: "Piezas", Icono: Package, otra: "+ otro producto",
  },
];
const CAMPO = "neu-campo rounded-lg px-3 py-1.5 w-32 text-right";
const BOTON = "bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-40";
const cantidad = (tipo, n) => (tipo === "marca" ? pesosConCentavos(n) : `${Number(n)} ${Number(n) === 1 ? "pieza" : "piezas"}`);

// Captura manual diaria de marcas (pesos) y productos (piezas) de la persona. El servidor
// decide: candado de marcas contra la venta del día, unicidad por día y mes cerrado.
export default function MarcasDelDia({ mes, sucursalId, vendedorId, fecha, objetivos, capturas, actualizar }) {
  const [catalogo, setCatalogo] = useState({ marcas: [], productos: [] });
  const [extras, setExtras] = useState({ marca: [], producto: [] });
  const [valores, setValores] = useState({});
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [errorCatalogo, setErrorCatalogo] = useState("");
  const cerrado = objetivos.cerrado;
  const lista = capturas.capturas || [];
  const { venta, enMarcas } = resumenMarcasDelDia(lista, fecha);

  useEffect(() => {
    let vigente = true;
    Promise.all(["marcas", "productos"].map((l) => apiFetch(`/objetivos/catalogo/${l}`)
      .then((r) => leer(r, "No se pudieron cargar las listas de marcas y productos"))))
      .then(([marcas, productos]) => { if (vigente) setCatalogo({ marcas, productos }); })
      .catch((e) => { if (vigente) setErrorCatalogo(e.message); });
    return () => { vigente = false; };
  }, []);

  // Al teclear de nuevo, el rechazo anterior ya no describe lo que hay en el campo.
  const cambiarValor = (llave, valor) => {
    setValores((actual) => ({ ...actual, [llave]: valor }));
    setErrores((actual) => ({ ...actual, [llave]: "" }));
  };

  const guardar = async (t, id) => {
    const llave = `${t.tipo}|${id}`;
    setErrores((actual) => ({ ...actual, [llave]: "" }));
    setGuardando(llave);
    try {
      await apiFetch("/objetivos/captura", {
        method: "POST",
        body: JSON.stringify({
          tipo: t.tipo, [t.clave]: id, mes, fecha, sucursal_id: Number(sucursalId), vendedor_id: vendedorId,
          monto: Number(valores[llave]),
        }),
      }).then((r) => leer(r, "No se pudo guardar la captura"));
      setValores((actual) => ({ ...actual, [llave]: "" }));
      await actualizar();
    } catch (e) {
      setErrores((actual) => ({ ...actual, [llave]: e.message }));
    } finally {
      setGuardando(null);
    }
  };

  const corregir = async () => {
    setCorrigiendo((actual) => ({ ...actual, error: "" }));
    try {
      await apiFetch(`/objetivos/captura/${corrigiendo.id}/corregir`, {
        method: "POST",
        body: JSON.stringify({ monto: Number(corrigiendo.monto), motivo: corrigiendo.motivo }),
      }).then((r) => leer(r, "No se pudo corregir la captura"));
      setCorrigiendo(null);
      await actualizar();
    } catch (e) {
      setCorrigiendo((actual) => ({ ...actual, error: e.message }));
    }
  };

  const nombreDe = (t, id) => catalogo[t.lista].find((e) => Number(e.id) === Number(id))?.nombre ||
    (objetivos[t.lista] || []).find((e) => Number(e[t.clave]) === Number(id))?.nombre || `Elemento #${id}`;
  const historial = lista.filter((c) => c.tipo === "marca" || c.tipo === "producto")
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);

  return (
    <section className="neu rounded-xl p-4 space-y-4">
      <h2 className="font-semibold text-slate-700">Marcas y productos del {fecha}</h2>
      {errorCatalogo && <p role="alert" className="text-sm text-red-700">{errorCatalogo}</p>}
      {TIPOS.map((t) => {
        const renglones = renglonesDelDia({
          ...t, fecha, vendedorId, extras: extras[t.tipo], elementosMeta: objetivos[t.lista] || [],
          catalogo: catalogo[t.lista], capturas: lista, totales: capturas[t.totales] || [],
        });
        const disponibles = catalogo[t.lista].filter((e) => !renglones.some((r) => r.id === Number(e.id)));
        const sinVenta = t.tipo === "marca" && venta === null;
        return (
          <div key={t.tipo} className="border-t border-slate-100 pt-3 space-y-2">
            <h3 className="font-medium text-slate-700 flex gap-2 items-center">
              <t.Icono size={18} className="text-blue-600" aria-hidden="true" />
              {t.titulo}
            </h3>
            {t.tipo === "marca" && (sinVenta ? (
              <p className="text-sm text-amber-800">Primero captura tu venta de ese día.</p>
            ) : (
              <p className="text-sm text-slate-600">
                De tu venta de <strong>{pesosConCentavos(venta)}</strong> llevas <strong>{pesosConCentavos(enMarcas)}</strong> en marcas.
              </p>
            ))}
            {renglones.length === 0 && <p className="text-sm text-slate-500">No tienes metas aquí este mes.</p>}
            {renglones.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-slate-500 text-left">
                    <th className="py-1">{t.tipo === "marca" ? "Marca" : "Producto"}</th>
                    <th>Mi meta del mes</th>
                    <th>Llevo en el mes</th>
                    <th>{t.unidad} de este día</th>
                  </tr>
                </thead>
                <tbody>
                  {renglones.map((r) => {
                    const llave = `${t.tipo}|${r.id}`;
                    const valor = valores[llave] ?? "";
                    const pasaLaVenta = t.tipo === "marca" && venta !== null && valor !== "" && sumarEnCentavos([enMarcas, valor]) > venta;
                    return (
                      <tr key={r.id} className="border-b border-slate-100 align-top">
                        <td className="py-2">{r.nombre}</td>
                        <td>{r.meta === null ? "—" : cantidad(t.tipo, r.meta)}</td>
                        <td>{cantidad(t.tipo, r.totalMes)}</td>
                        <td className="py-1">
                          {r.captura ? (
                            <span className="flex gap-3 items-center">
                              <strong>{cantidad(t.tipo, r.captura.monto)}</strong>
                              {!cerrado && (
                                <button type="button" className="text-blue-600 hover:underline" onClick={() => setCorrigiendo({
                                  id: r.captura.id, titulo: `Corregir ${r.nombre} del ${fecha}`, monto: r.captura.monto, motivo: "", error: "",
                                })}>
                                  Corregir
                                </button>
                              )}
                            </span>
                          ) : cerrado ? "—" : (
                            <span className="flex gap-2 items-center flex-wrap">
                              <input type="number" min="0" step={t.step} value={valor} disabled={sinVenta}
                                aria-label={`${t.unidad} de ${r.nombre}`}
                                onChange={(e) => cambiarValor(llave, e.target.value)} className={CAMPO} />
                              <button type="button" className={BOTON} disabled={sinVenta || valor === "" || guardando === llave}
                                onClick={() => guardar(t, r.id)}>
                                Guardar
                              </button>
                            </span>
                          )}
                          {pasaLaVenta && <p className="text-amber-800 mt-1">Con esto pasarías tu venta del día.</p>}
                          {errores[llave] && <p role="alert" className="text-red-700 mt-1">{errores[llave]}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!cerrado && !sinVenta && disponibles.length > 0 && (
              <label className="text-sm text-slate-600 flex gap-2 items-center">
                {t.otra}
                <select value="" className="neu-campo rounded-lg px-2 py-1" onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) setExtras((actual) => ({ ...actual, [t.tipo]: [...actual[t.tipo], id] }));
                }}>
                  <option value="">Elige…</option>
                  {disponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </label>
            )}
          </div>
        );
      })}
      {historial.length > 0 && (
        <div className="border-t border-slate-100 pt-3 overflow-x-auto">
          <h3 className="font-medium text-slate-700 mb-2">Historial del mes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-slate-500 text-left">
                <th className="py-1">Fecha</th>
                <th>Elemento</th>
                <th>Cantidad</th>
                <th>Estado</th>
                <th>Capturó</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((c) => {
                const t = TIPOS.find((x) => x.tipo === c.tipo);
                const atraso = diasDeAtraso(c);
                return (
                  <tr key={c.id} className={`border-b border-slate-100 ${c.vigente ? "" : "text-slate-400"}`}>
                    <td className="py-1">
                      {c.fecha}
                      {atraso > 0 && <p className="text-amber-800">capturado {atraso} {atraso === 1 ? "día" : "días"} después</p>}
                    </td>
                    <td>{nombreDe(t, c[t.clave])}</td>
                    <td>{cantidad(c.tipo, c.monto)}</td>
                    <td>
                      {c.vigente ? (c.corrige_a ? "Corrección vigente" : "Vigente") : "Corregida"}
                      {c.corrige_a && c.motivo && <p className="text-slate-600">Motivo: {c.motivo}</p>}
                    </td>
                    <td>{c.capturado_por}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {corrigiendo && !cerrado && (
        <Modal titulo={corrigiendo.titulo} cerrar={() => setCorrigiendo(null)} guardar={corregir}
          deshabilitado={corrigiendo.monto === "" || !corrigiendo.motivo.trim()}>
          <Campo etiqueta="Cantidad correcta" tipo="number" valor={corrigiendo.monto}
            cambiar={(monto) => setCorrigiendo({ ...corrigiendo, monto })} />
          <Campo etiqueta="Motivo obligatorio" valor={corrigiendo.motivo}
            cambiar={(motivo) => setCorrigiendo({ ...corrigiendo, motivo })} area />
          {corrigiendo.error && <p role="alert" className="text-sm text-red-700">{corrigiendo.error}</p>}
        </Modal>
      )}
    </section>
  );
}
