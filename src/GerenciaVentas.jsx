import React, { useState, useEffect, useCallback, useRef } from "react";
import { Target, RefreshCw, Check, X, Users } from "lucide-react";
import { apiFetch, sinSucursalElegida } from "./api";

const pesos = (n) =>
  Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

/**
 * Gerencia de Ventas — el objetivo del vendedor y sus tareas del mes.
 *
 * Dos caras en la misma pantalla:
 *  - VENDEDOR: su meta, su avance y su lista de tareas.
 *  - JEFATURA (permiso editar_objetivos_venta): la tabla de todo su personal,
 *    con la meta editable.
 *
 * Todo lo que se muestra viene calculado del backend (gerenteVentas.js) a
 * partir de datos reales: ventas cerradas del mes, clientes que el CRM marca
 * en riesgo, y demanda proyectada. Aquí no se calcula ninguna cifra.
 */
export default function GerenciaVentas({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const esJefatura = puede("editar_objetivos_venta");

  const [miVendedorId, setMiVendedorId] = useState(null);
  const [tablero, setTablero] = useState(null);
  const [equipo, setEquipo] = useState([]);
  const [verVendedorId, setVerVendedorId] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [editandoMeta, setEditandoMeta] = useState(null); // { vendedor_id, valor }
  const [sugerencia, setSugerencia] = useState(null);     // { vendedor_id, ...datos }
  const [pidiendoSugerencia, setPidiendoSugerencia] = useState(null); // vendedor_id
  // Un fallo al cargar tiene que VERSE. Antes se tragaba el error y se dejaba
  // `tablero` en null: una cuenta ligada a un vendedor que ya no existe (id mal
  // capturado, o un respaldo restaurado sin ese vendedor) no entraba al aviso
  // ámbar —porque sí tiene vendedor_id— y no renderizaba absolutamente nada.
  // Para quien no programa, una pantalla en blanco es "el sistema no sirve".
  const [errorCarga, setErrorCarga] = useState(null);
  const [errorEquipo, setErrorEquipo] = useState(null);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 4000); };

  const cargarTablero = useCallback(async (vendedorId) => {
    if (vendedorId == null) { setTablero(null); return; }
    try {
      const r = await apiFetch(`/gerente-ventas/${vendedorId}`);
      if (r.ok) {
        setTablero(await r.json());
        setErrorCarga(null);
        return;
      }
      const data = await r.json().catch(() => ({}));
      setTablero(null);
      setErrorCarga(
        data.error === "Tablero no encontrado" || r.status === 404
          ? "Tu cuenta está ligada a un vendedor que ya no existe en el catálogo. " +
            "Pídele a quien administra el personal que la vuelva a ligar desde Roles y Personal."
          : data.error || "No se pudo cargar tu objetivo de venta. Intenta recargar la página."
      );
    } catch (_) {
      setTablero(null);
      setErrorCarga("No se pudo conectar con el sistema. Revisa tu internet y recarga la página.");
    }
  }, []);

  const cargarEquipo = useCallback(async () => {
    if (!esJefatura) return;
    // Una lista vacía por fallo se ve idéntica a una lista vacía de verdad, y
    // la pantalla decía "No hay vendedores en tu alcance" — o sea, mentía. El
    // error se guarda aparte para poder distinguirlos.
    try {
      const r = await apiFetch("/gerente-ventas");
      if (r.ok) {
        setEquipo(await r.json());
        setErrorEquipo(null);
        return;
      }
      const data = await r.json().catch(() => ({}));
      setEquipo([]);
      setErrorEquipo(data.error || "No se pudo cargar a tu equipo. Intenta recargar la página.");
    } catch (_) {
      setEquipo([]);
      setErrorEquipo("No se pudo conectar con el sistema. Revisa tu internet y recarga la página.");
    }
  }, [esJefatura]);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const r = await apiFetch("/gerente-ventas/mi/vendedor");
        // Si la consulta FALLA no se concluye "no está ligada": eso mandaba a
        // la vendedora a pedirle al administrador que arreglara algo que no
        // estaba roto. Sin try/catch, además, un error de red escapaba de este
        // efecto y `cargando` se quedaba en true: "Cargando…" para siempre.
        if (!r.ok) {
          setErrorCarga("No se pudo consultar tu objetivo de venta. Intenta recargar la página.");
          setCargando(false);
          return;
        }
        const mio = (await r.json()).vendedor_id;
        setMiVendedorId(mio);
        setVerVendedorId(mio);
        await Promise.all([cargarTablero(mio), cargarEquipo()]);
      } catch (_) {
        setErrorCarga("No se pudo conectar con el sistema. Revisa tu internet y recarga la página.");
      } finally {
        setCargando(false);
      }
    })();
  }, [cargarTablero, cargarEquipo]);

  const cerrarTarea = async (tareaId, estado) => {
    const r = await apiFetch(`/gerente-ventas/${verVendedorId}/tareas/${tareaId}`, {
      method: "PUT",
      body: JSON.stringify({ estado }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return mostrarAviso("❌ " + (data.error || "No se pudo actualizar la tarea"));
    mostrarAviso(estado === "hecha" ? "✅ Tarea marcada como hecha" : "Tarea descartada");
    cargarTablero(verVendedorId);
    cargarEquipo();
  };

  const guardarMeta = async (vendedorId, valor) => {
    const r = await apiFetch(`/gerente-ventas/${vendedorId}/meta`, {
      method: "PUT",
      body: JSON.stringify({ meta: Number(valor) }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return mostrarAviso("❌ " + (data.error || "No se pudo guardar la meta"));
    setEditandoMeta(null);
    mostrarAviso("✅ Objetivo actualizado");
    cargarEquipo();
    if (vendedorId === verVendedorId) cargarTablero(vendedorId);
  };

  // Contador de petición: si se piden dos sugerencias seguidas, la respuesta
  // lenta de la primera ya no apaga el "Calculando…" de la segunda ni pisa su
  // resultado. Sin esto el estado quedaba inconsistente (las cifras no se
  // cruzaban, porque el vendedor_id viaja con el dato, pero la pantalla mentía
  // sobre qué se estaba calculando).
  const peticionSugerencia = useRef(0);

  const pedirSugerencia = async (vendedorId) => {
    const miTurno = ++peticionSugerencia.current;
    setPidiendoSugerencia(vendedorId);
    setSugerencia(null);
    try {
      const r = await apiFetch(`/gerente-ventas/${vendedorId}/sugerencia-meta`);
      const data = await r.json().catch(() => ({}));
      if (miTurno !== peticionSugerencia.current) return; // llegó tarde: se descarta
      if (!r.ok) throw new Error(data.error || "No se pudo calcular la sugerencia");
      setSugerencia({ vendedor_id: vendedorId, ...data });
    } catch (err) {
      if (miTurno === peticionSugerencia.current) mostrarAviso("❌ " + err.message);
    } finally {
      if (miTurno === peticionSugerencia.current) setPidiendoSugerencia(null);
    }
  };

  const barra = (porcentaje) => {
    // Se dibuja topada al 100% para que la barra no se salga de la caja, pero
    // el número de arriba sí muestra el real (rebasar la meta debe verse).
    const ancho = Math.min(100, Math.max(0, porcentaje || 0));
    const color = ancho >= 100 ? "bg-emerald-500" : ancho >= 60 ? "bg-blue-500" : "bg-amber-500";
    return (
      <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${ancho}%` }} />
      </div>
    );
  };

  if (cargando) {
    return <div className="p-6 text-slate-500 text-sm">Cargando tu objetivo…</div>;
  }

  // Ni vendedor ligado ni jefatura: no hay nada que mostrarle a esta cuenta.
  if (miVendedorId == null && !esJefatura) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 max-w-xl">
          <p className="font-medium mb-1">Tu cuenta todavía no está ligada a un vendedor.</p>
          <p>
            Para ver tu objetivo de venta, pídele a quien administra el personal que
            enlace tu cuenta con tu nombre en el catálogo de vendedores, desde
            <strong> Roles y Personal</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      {aviso && (
        <div className="bg-slate-800 text-white text-sm rounded px-3 py-2 inline-block">{aviso}</div>
      )}

      {errorCarga && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-900">
          {errorCarga}
        </div>
      )}

      {/* El alcance de esta pantalla sale de QUIÉN eres, no del selector de
          arriba — a propósito: así nadie ve el desempeño de otra tienda por
          cambiar un menú. Pero sin decirlo, "Objetivos del equipo" con el
          encabezado puesto en una tienda se lee como el equipo de esa tienda. */}
      {esJefatura && !sinSucursalElegida() && equipo.length > 0 && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          Esta pantalla muestra a todo tu personal, sin importar la tienda seleccionada arriba.
        </p>
      )}

      {/* ---------- Mi objetivo ---------- */}
      {tablero && (
        <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-700 flex items-center gap-2">
              <Target size={18} className="text-blue-600" />
              Objetivo de {tablero.vendedor_nombre}
            </h2>
            <button
              type="button"
              onClick={() => cargarTablero(verVendedorId)}
              className="text-slate-400 hover:text-slate-600"
              title="Actualizar"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {tablero.sin_meta ? (
            <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2">
              Sin objetivo asignado todavía. Llevas <strong>{pesos(tablero.vendido_mes)}</strong> vendidos
              este mes.
              {esJefatura && " Puedes fijar la meta abajo, en la tabla del equipo."}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                <span className="text-slate-500">
                  Meta del mes: <strong className="text-slate-800">{pesos(tablero.meta)}</strong>
                </span>
                <span className="text-slate-500">
                  Llevas: <strong className="text-slate-800">{pesos(tablero.vendido_mes)}</strong>
                </span>
                <span className="text-slate-500">
                  Te faltan: <strong className="text-slate-800">{pesos(tablero.faltante)}</strong>
                </span>
                <span className="text-slate-500">
                  Días que quedan: <strong className="text-slate-800">{tablero.dias_restantes_del_mes}</strong>
                </span>
              </div>
              {barra(tablero.porcentaje)}
              <p className="text-xs text-slate-500">{tablero.porcentaje}% de tu objetivo</p>
            </div>
          )}
        </section>
      )}

      {/* ---------- Tareas ---------- */}
      {tablero && (
        <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold text-slate-700 mb-3">Tareas para llegar a la meta</h2>

          {tablero.tareas.length === 0 ? (
            <p className="text-sm text-slate-500">
              No hay tareas pendientes. Aparecen solas cuando hay clientes que llevan tiempo sin
              comprar, o productos con demanda al alza en tu tienda.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tablero.tareas.map((t) => (
                <li key={t.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={
                        "inline-block text-[11px] px-1.5 py-0.5 rounded mr-2 align-middle " +
                        (t.tipo === "contactar_cliente"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-emerald-100 text-emerald-700")
                      }
                    >
                      {t.tipo === "contactar_cliente" ? "Cliente" : "Producto"}
                    </span>
                    <span className="text-sm text-slate-700">{t.descripcion}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => cerrarTarea(t.id, "hecha")}
                      className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50"
                      title="Ya la hice"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => cerrarTarea(t.id, "descartada")}
                      className="p-1.5 rounded text-slate-400 hover:bg-slate-100"
                      title="No aplica"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---------- Equipo (solo jefatura) ---------- */}
      {esJefatura && (
        <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            Objetivos del equipo
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 font-medium">Vendedor</th>
                  <th className="py-2 font-medium text-right">Meta</th>
                  <th className="py-2 font-medium text-right">Vendido</th>
                  <th className="py-2 font-medium text-right">Avance</th>
                  <th className="py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {equipo.map((v) => (
                  <tr key={v.vendedor_id} className="border-b border-slate-100">
                    <td className="py-2">{v.vendedor_nombre}</td>
                    <td className="py-2 text-right">
                      {editandoMeta?.vendedor_id === v.vendedor_id ? (
                        <input
                          type="number"
                          min="0"
                          autoFocus
                          value={editandoMeta.valor}
                          onChange={(e) => setEditandoMeta({ ...editandoMeta, valor: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") guardarMeta(v.vendedor_id, editandoMeta.valor);
                            if (e.key === "Escape") setEditandoMeta(null);
                          }}
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-right text-sm"
                        />
                      ) : (
                        <span className={v.sin_meta ? "text-slate-400" : ""}>
                          {v.sin_meta ? "sin objetivo" : pesos(v.meta)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">{pesos(v.vendido_mes)}</td>
                    <td className="py-2 text-right">
                      {v.sin_meta ? "—" : `${v.porcentaje}%`}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {editandoMeta?.vendedor_id === v.vendedor_id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => guardarMeta(v.vendedor_id, editandoMeta.valor)}
                            className="text-blue-600 hover:underline mr-3"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditandoMeta(null)}
                            className="text-slate-500 hover:underline"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditandoMeta({ vendedor_id: v.vendedor_id, valor: v.meta || "" })}
                            className="text-blue-600 hover:underline mr-3"
                          >
                            Fijar meta
                          </button>
                          <button
                            type="button"
                            disabled={pidiendoSugerencia === v.vendedor_id}
                            onClick={() => pedirSugerencia(v.vendedor_id)}
                            className="text-violet-600 hover:underline mr-3 disabled:opacity-40 disabled:no-underline"
                          >
                            {pidiendoSugerencia === v.vendedor_id ? "Calculando…" : "Sugerir meta"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setVerVendedorId(v.vendedor_id); cargarTablero(v.vendedor_id); }}
                            className="text-slate-600 hover:underline"
                          >
                            Ver tareas
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {equipo.length === 0 && (
            <p className="text-sm text-slate-500">
              {errorEquipo || "No hay vendedores en tu alcance."}
            </p>
          )}

          {sugerencia && (
            <div className="mt-4 border border-violet-200 bg-violet-50 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-violet-900 mb-1">
                    Sugerencia para {sugerencia.vendedor_nombre}
                    {sugerencia.sugerencia != null && (
                      <span className="ml-2 text-violet-700">{pesos(sugerencia.sugerencia)}</span>
                    )}
                  </p>
                  <p className="text-sm text-slate-700">{sugerencia.redaccion}</p>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {/* La cifra SIEMPRE sale del historial; solo el texto puede
                        venir de la IA. Decirlo evita que Victor crea que una IA
                        le está poniendo metas a su personal. */}
                    Calculada con {sugerencia.meses_de_historial} mes(es) de ventas reales · confianza{" "}
                    {sugerencia.confianza}
                    {sugerencia.redactado_por_ia ? " · explicación redactada por la IA" : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {sugerencia.sugerencia != null && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditandoMeta({ vendedor_id: sugerencia.vendedor_id, valor: sugerencia.sugerencia });
                        setSugerencia(null);
                      }}
                      className="text-sm bg-violet-600 text-white px-2.5 py-1 rounded hover:bg-violet-700"
                    >
                      Usar esta meta
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSugerencia(null)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
