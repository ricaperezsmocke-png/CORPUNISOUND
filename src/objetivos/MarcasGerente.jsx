import { useCallback, useEffect, useState } from "react";
import { FranjaAyuda } from "./Ayuda";
import { History, Plus, Tags } from "lucide-react";
import { apiFetch } from "../api";
import { Campo, Modal } from "./DialogosObjetivos";
import ListasObjetivos from "./ListasObjetivos";
import { leer, sugerenciaGuardada } from "./datos";
import {
  ETIQUETAS_FINANCIERA, consultaElemento, filasMetasTienda, formatoUnidad, pesosConCentavos, sugerenciaDeFila, textoPendiente,
} from "./marcas";

const TIPOS_ALTA = [
  { tipo: "marca", clave: "marca_id", lista: "marcas", etiqueta: "Marca (pesos)" },
  { tipo: "producto", clave: "producto_meta_id", lista: "productos", etiqueta: "Producto (piezas)" },
  { tipo: "credito", clave: "financiera", lista: null, etiqueta: "Crédito (número de créditos)" },
];
const FINANCIERAS = Object.entries(ETIQUETAS_FINANCIERA).map(([id, nombre]) => ({ id, nombre }));
const FILA = "border-b border-slate-100 cursor-pointer hover:bg-blue-50";
const BOTON = "bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-40";
const BOTON_SEC = "border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700";

// Metas de marca, producto y crédito de la tienda. Se guarda una meta por petición, igual que la
// de venta; motivo obligatorio al cambiar una existente (el servidor lo exige también).
export default function MarcasGerente({ mes, sucursalId, objetivos, nombre, actualizar, permisos = [] }) {
  const administraListas = permisos.includes("editar_objetivos_venta") && permisos.includes("ver_todas_las_sucursales");
  const [catalogo, setCatalogo] = useState({ marcas: [], productos: [] });
  const [elegida, setElegida] = useState(null);
  const [sugerencia, setSugerencia] = useState(null);
  const [editando, setEditando] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [agregando, setAgregando] = useState(null);
  const [creditos, setCreditos] = useState(null);
  const [error, setError] = useState("");
  const cerrado = objetivos.cerrado;
  const filas = filasMetasTienda(objetivos);
  const fila = filas.find((f) => f.llave === elegida) || null;
  const sugeridos = sugerenciaDeFila(sugerencia, elegida);

  const cargarCreditos = useCallback(async () => {
    try {
      setCreditos(await apiFetch(`/objetivos/${mes}/${sucursalId}/creditos`)
        .then((r) => leer(r, "No se pudieron cargar los créditos de la tienda")));
    } catch (e) {
      setError(e.message);
    }
  }, [mes, sucursalId]);

  const cargarCatalogo = useCallback(async () => {
    try {
      const [marcas, productos] = await Promise.all(["marcas", "productos"].map((l) => apiFetch(`/objetivos/catalogo/${l}`)
        .then((r) => leer(r, "No se pudieron cargar las listas de marcas y productos"))));
      setCatalogo({ marcas, productos });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { cargarCreditos(); }, [cargarCreditos]);
  useEffect(() => { cargarCatalogo(); }, [cargarCatalogo]);

  const elegir = (llave) => {
    setElegida(llave);
    setSugerencia(null);
  };

  const guardarMeta = async (datos, alTerminar) => {
    await apiFetch("/objetivos", {
      method: "POST",
      body: JSON.stringify({ ...datos, mes, sucursal_id: Number(sucursalId) }),
    }).then((r) => leer(r, "No se pudo guardar la meta"));
    alTerminar();
    await actualizar();
  };

  const abrirEdicion = async (vendedorId, monto) => {
    setError("");
    try {
      const versiones = await apiFetch(`/objetivos/${mes}/${sucursalId}/historial/${vendedorId ?? "tienda"}?${consultaElemento(fila)}`)
        .then((r) => leer(r, "No se pudo consultar el historial"));
      setEditando({ llave: fila.llave, vendedor_id: vendedorId, monto, motivo: "", existente: versiones.length > 0, error: "" });
    } catch (e) {
      setError(e.message);
    }
  };

  const guardarEdicion = async () => {
    try {
      await guardarMeta({
        tipo: fila.tipo, [fila.clave]: fila.id, vendedor_id: editando.vendedor_id, monto: Number(editando.monto),
        motivo: editando.existente ? editando.motivo : undefined,
      }, () => {
        // Cambiar la meta de tienda invalida la sugerencia; guardar una parte, no.
        if (editando.vendedor_id == null) setSugerencia(null);
        setEditando(null);
      });
    } catch (e) {
      setEditando((actual) => ({ ...actual, error: e.message }));
    }
  };

  const guardarAlta = async () => {
    const t = TIPOS_ALTA.find((x) => x.tipo === agregando.tipo);
    const id = t.tipo === "credito" ? agregando.id : Number(agregando.id);
    try {
      await guardarMeta({ tipo: t.tipo, [t.clave]: id, vendedor_id: null, monto: Number(agregando.monto) }, () => {
        setAgregando(null);
        elegir(`${t.tipo}|${id}`);
      });
    } catch (e) {
      setAgregando((actual) => ({ ...actual, error: e.message }));
    }
  };

  const pedirSugerencia = async () => {
    setError("");
    try {
      // Se guarda con su fila: si la respuesta llega después de cambiar de marca, no se pinta en la otra.
      const llave = fila.llave;
      const datos = await apiFetch(`/objetivos/${mes}/${sucursalId}/sugerencia?${consultaElemento(fila)}`)
        .then((r) => leer(r, "No se pudo calcular el reparto sugerido"));
      setSugerencia({ llave, datos });
    } catch (e) {
      setError(e.message);
    }
  };

  const abrirHistorial = async (vendedorId) => {
    setError("");
    try {
      const datos = await apiFetch(`/objetivos/${mes}/${sucursalId}/historial/${vendedorId ?? "tienda"}?${consultaElemento(fila)}`)
        .then((r) => leer(r, "No se pudo consultar el historial"));
      setHistorial({ titulo: `${fila.nombre} · ${vendedorId == null ? "Tienda" : nombre(vendedorId)}`, unidad: fila.unidad, datos });
    } catch (e) {
      setError(e.message);
    }
  };

  const tipoAlta = agregando && TIPOS_ALTA.find((x) => x.tipo === agregando.tipo);
  const opcionesAlta = !tipoAlta ? [] : (tipoAlta.lista ? catalogo[tipoAlta.lista] : FINANCIERAS)
    .filter((e) => !filas.some((f) => f.tipo === tipoAlta.tipo && String(f.id) === String(e.id)));

  return (
    <section className="neu rounded-xl p-4 space-y-4">
      <FranjaAyuda clave="tienda-marcas">
        <p>Fija metas por marca (en pesos), por producto (en piezas) y por financiera. Las listas de marcas y productos se dan de alta aquí.</p>
      </FranjaAyuda>
      <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
        <Tags size={18} className="text-blue-600" aria-hidden="true" />
        Metas de marca, producto y crédito
      </h2>
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-slate-500 text-left">
              <th className="py-2">Tipo</th>
              <th>Elemento</th>
              <th>Unidad</th>
              <th>Meta de tienda</th>
              <th>Asignado</th>
              <th>Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-slate-500">Todavía no hay metas de marca, producto o crédito este mes.</td></tr>
            )}
            {filas.map((f) => (
              <tr key={f.llave} onClick={() => elegir(f.llave)} aria-selected={f.llave === elegida}
                className={`${FILA} ${f.llave === elegida ? "bg-blue-50 font-medium" : ""}`}>
                <td className="py-2">{f.titulo}</td>
                <td>{f.nombre}</td>
                <td>{f.unidad === "creditos" ? "créditos" : f.unidad}</td>
                <td>{formatoUnidad(f.unidad, f.meta_tienda)}</td>
                <td>{formatoUnidad(f.unidad, f.asignado)}</td>
                <td className={f.sin_asignar === 0 ? "text-slate-600" : "text-red-700"}>{textoPendiente(f.sin_asignar, f.unidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!cerrado && (
        <button type="button" className={`${BOTON} flex gap-1 items-center`}
          onClick={() => setAgregando({ tipo: "marca", id: "", monto: "", error: "" })}>
          <Plus size={16} aria-hidden="true" /> Agregar meta
        </button>
      )}
      {fila && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <h3 className="font-medium text-slate-700 mr-3">Reparto de {fila.nombre}</h3>
            {!cerrado && (
              <>
                <button type="button" className={BOTON_SEC} onClick={() => abrirEdicion(null, fila.meta_tienda)}>Cambiar meta de tienda</button>
                <button type="button" className={BOTON_SEC} onClick={pedirSugerencia}>Sugerir reparto</button>
              </>
            )}
            <button type="button" className={`${BOTON_SEC} flex gap-1 items-center`} onClick={() => abrirHistorial(null)}>
              <History size={14} aria-hidden="true" /> Historial de tienda
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-slate-500 text-left">
                <th className="py-1">Persona</th>
                <th>Meta</th>
                <th>Sugerido</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(fila.lineas || []).map((l) => {
                const sug = sugeridos?.find((s) => Number(s.vendedor_id) === Number(l.vendedor_id));
                const guardada = sug && sugerenciaGuardada(sug, fila.lineas);
                return (
                  <tr key={l.vendedor_id} className="border-b border-slate-100">
                    <td className="py-2">{nombre(l.vendedor_id)}</td>
                    <td>{formatoUnidad(fila.unidad, l.monto)}</td>
                    <td>
                      {sug ? (
                        <span className="flex gap-2 items-center flex-wrap">
                          {formatoUnidad(fila.unidad, sug.monto)}
                          {guardada ? <span className="text-emerald-700">Guardada</span> : (
                            <>
                              <span className="text-amber-800">Pendiente de guardar</span>
                              {!cerrado && (
                                <button type="button" className="text-blue-600 hover:underline"
                                  onClick={() => abrirEdicion(l.vendedor_id, sug.monto)}>
                                  Usar sugerencia
                                </button>
                              )}
                            </>
                          )}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="space-x-3">
                      {!cerrado && (
                        <button type="button" className="text-blue-600 hover:underline" onClick={() => abrirEdicion(l.vendedor_id, l.monto)}>
                          Editar
                        </button>
                      )}
                      <button type="button" className="text-slate-600 hover:underline" onClick={() => abrirHistorial(l.vendedor_id)}>
                        Historial
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(fila.lineas || []).length === 0 && <p className="text-sm text-slate-500">No hay personas en la plantilla del mes.</p>}
        </div>
      )}
      <div className="border-t border-slate-100 pt-3 overflow-x-auto">
        <h3 className="font-medium text-slate-700 mb-2">Créditos de la tienda</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-slate-500 text-left">
              <th className="py-1">Persona</th>
              <th>Financiera</th>
              <th>Folio</th>
              <th>Fecha</th>
              <th>Monto</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(creditos?.registros || []).length === 0 && (
              <tr><td colSpan={6} className="py-3 text-slate-500">Sin créditos registrados este mes.</td></tr>
            )}
            {(creditos?.registros || []).map((c) => (
              <tr key={c.id} className={`border-b border-slate-100 ${c.vigente ? "" : "text-slate-400"}`}>
                <td className="py-1">{nombre(c.vendedor_id)}</td>
                <td>{ETIQUETAS_FINANCIERA[c.financiera] || c.financiera}</td>
                <td className={c.vigente ? "" : "line-through"}>{c.folio}</td>
                <td>{c.fecha}</td>
                <td>{pesosConCentavos(c.monto)}</td>
                <td>{c.vigente ? "Vigente" : `Anulado por ${c.anulado_por}: ${c.motivo_anulacion}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {administraListas && <ListasObjetivos onCambio={cargarCatalogo} />}
      {editando && fila && editando.llave === fila.llave && !cerrado && (
        <Modal titulo={`${fila.nombre} · ${editando.vendedor_id == null ? "Meta de la tienda" : `Meta de ${nombre(editando.vendedor_id)}`}`}
          cerrar={() => setEditando(null)} guardar={guardarEdicion}
          deshabilitado={editando.monto === "" || (editando.existente && !editando.motivo.trim())}>
          <Campo etiqueta={`Meta (${fila.unidad === "creditos" ? "créditos" : fila.unidad})`} tipo="number" valor={editando.monto}
            cambiar={(monto) => setEditando({ ...editando, monto })} />
          {editando.existente && (
            <Campo etiqueta="Motivo obligatorio" valor={editando.motivo} area
              cambiar={(motivo) => setEditando({ ...editando, motivo })} />
          )}
          {editando.error && <p role="alert" className="text-sm text-red-700">{editando.error}</p>}
        </Modal>
      )}
      {agregando && !cerrado && (
        <Modal titulo="Agregar meta de tienda" cerrar={() => setAgregando(null)} guardar={guardarAlta}
          deshabilitado={!agregando.id || agregando.monto === ""}>
          <label className="text-sm block">
            Tipo
            <select value={agregando.tipo} onChange={(e) => setAgregando({ ...agregando, tipo: e.target.value, id: "" })}
              className="neu-campo rounded-lg px-3 py-2 w-full mt-1">
              {TIPOS_ALTA.map((t) => <option key={t.tipo} value={t.tipo}>{t.etiqueta}</option>)}
            </select>
          </label>
          <label className="text-sm block">
            Elemento
            <select value={agregando.id} onChange={(e) => setAgregando({ ...agregando, id: e.target.value })}
              className="neu-campo rounded-lg px-3 py-2 w-full mt-1">
              <option value="">Elige de la lista…</option>
              {opcionesAlta.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          {tipoAlta?.lista && opcionesAlta.length === 0 && (
            <p className="text-sm text-slate-500">No hay más elementos activos en la lista. Se dan de alta en "Listas de marcas y productos".</p>
          )}
          <Campo etiqueta="Meta de la tienda" tipo="number" valor={agregando.monto}
            cambiar={(monto) => setAgregando({ ...agregando, monto })} />
          {agregando.error && <p role="alert" className="text-sm text-red-700">{agregando.error}</p>}
        </Modal>
      )}
      {historial && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-lg max-h-[80vh] overflow-auto">
            <h3 className="font-semibold mb-3">Historial: {historial.titulo}</h3>
            {historial.datos.length ? (
              <ul className="space-y-2 text-sm">
                {historial.datos.map((h) => (
                  <li key={h.id} className="border rounded-lg p-3">
                    <strong>Versión {h.version}: {formatoUnidad(historial.unidad, h.monto)}</strong>
                    <p className="text-slate-500">{h.creado_por} · {new Date(h.creado_en).toLocaleString("es-MX")}</p>
                    {h.motivo && <p>Motivo: {h.motivo}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Todavía no hay versiones.</p>}
            <button type="button" onClick={() => setHistorial(null)} className="mt-4 border rounded-lg px-4 py-2">Cerrar</button>
          </div>
        </div>
      )}
    </section>
  );
}
