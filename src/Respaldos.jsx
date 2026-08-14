import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, X, ShieldAlert } from "lucide-react";
import { apiFetch } from "./api";

const PALABRA_CONFIRMACION = "RESTAURAR";

function formatearTamano(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Pantalla de vigilancia de los respaldos cifrados a Google Drive.
 *
 * Sigue la estructura de src/EstadoCuenta.jsx (encabezado + listas + modal).
 * No hay alcance por sucursal: un respaldo es de toda la empresa, así que a
 * propósito no se usa qSucursal/sucursalActiva en ninguna de las llamadas.
 */
export default function Respaldos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const veTodas = puede("ver_todas_las_sucursales");

  const [estado, setEstado] = useState(null);
  const [copias, setCopias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [respaldando, setRespaldando] = useState(false);

  // Modal de restauración
  const [modal, setModal] = useState(null); // la copia elegida, o null
  const [comparacion, setComparacion] = useState(null);
  const [errorComparacion, setErrorComparacion] = useState(null);
  const [clave, setClave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [restaurando, setRestaurando] = useState(false);
  const [errorModal, setErrorModal] = useState(null);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 4000); };

  const cargarEstado = useCallback(async () => {
    const r = await apiFetch("/respaldos/estado");
    if (r.ok) setEstado(await r.json());
  }, []);

  const cargarCopias = useCallback(async () => {
    const r = await apiFetch("/respaldos");
    if (r.ok) setCopias(await r.json());
  }, []);

  useEffect(() => {
    setCargando(true);
    Promise.all([cargarEstado(), cargarCopias()]).finally(() => setCargando(false));
  }, [cargarEstado, cargarCopias]);

  // El mismo par que exige cada ruta en el backend (Task 7): un botón visible
  // que rebota con 403, o uno escondido a quien sí puede usarlo, son las dos
  // mitades del mismo defecto.
  const puedeRespaldar = puede("ver_respaldos") && veTodas;
  const puedeRestaurar = puede("restaurar_respaldo") && veTodas;
  const enMantenimiento = !!estado?.mantenimiento?.activo;

  const respaldarAhora = async () => {
    setRespaldando(true);
    try {
      const r = await apiFetch("/respaldos/ahora", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("✅ Respaldo creado");
      cargarEstado();
      cargarCopias();
    } catch (err) {
      mostrarAviso("❌ " + err.message);
    } finally {
      setRespaldando(false);
    }
  };

  const abrirModal = async (copia) => {
    setModal(copia);
    setComparacion(null);
    setErrorComparacion(null);
    setErrorModal(null);
    setClave("");
    setConfirmacion("");
    const r = await apiFetch(`/respaldos/${copia.id}/comparar`);
    const data = await r.json();
    if (r.ok) setComparacion(data);
    else setErrorComparacion(data.error);
  };

  const cerrarModal = () => {
    // La clave nunca sobrevive al cierre del modal: no se guarda en ningún
    // estado persistente ni en localStorage, y aquí se borra explícitamente.
    setModal(null);
    setComparacion(null);
    setErrorComparacion(null);
    setClave("");
    setConfirmacion("");
    setErrorModal(null);
  };

  const restaurar = async (e) => {
    e.preventDefault();
    setRestaurando(true);
    setErrorModal(null);
    try {
      const r = await apiFetch(`/respaldos/${modal.id}/restaurar`, {
        method: "POST",
        body: JSON.stringify({ clave, confirmacion }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // Los usuarios y roles acaban de cambiar: no hay sesión que valga.
      window.alert(data.aviso);
      localStorage.removeItem("token");
      window.location.reload();
    } catch (err) {
      // Se queda abierto y conserva lo que Victor ya escribió (folio de
      // confirmación incluido) — salvo la clave, que se borra siempre.
      setErrorModal(err.message);
      setClave("");
      setRestaurando(false);
    }
  };

  const renderSemaforo = () => {
    if (!estado) return null;
    let color = "bg-emerald-50 border-emerald-200 text-emerald-800";
    let texto;
    if (estado.respaldo_configurado === false) {
      color = "bg-red-50 border-red-200 text-red-800";
      texto = "🔴 El sistema NO se está respaldando — falta configurar la llave en el servidor";
    } else if (estado.minutos_desde_ultimo === null) {
      color = "bg-red-50 border-red-200 text-red-800";
      texto = "🔴 Nunca se ha hecho un respaldo";
    } else if (estado.alerta) {
      color = "bg-red-50 border-red-200 text-red-800";
      const horas = Math.floor(estado.minutos_desde_ultimo / 60);
      texto = `🔴 Sin respaldar desde hace ${horas} horas`;
    } else {
      texto = `🟢 Último respaldo hace ${estado.minutos_desde_ultimo} minutos`;
    }
    return (
      <div className={`border rounded-lg px-4 py-3 text-sm font-medium ${color}`}>{texto}</div>
    );
  };

  const renderBotonRestaurar = (copia) => {
    if (!puedeRestaurar) return null;
    if (!estado?.restauracion_habilitada) {
      return <span className="text-xs text-slate-400">Restaurar está deshabilitado: falta configurar la clave en el servidor.</span>;
    }
    return (
      <button
        type="button"
        onClick={() => abrirModal(copia)}
        disabled={enMantenimiento}
        title={enMantenimiento ? "El sistema está restaurando otro respaldo en este momento" : "Restaurar"}
        className="text-xs border border-red-300 text-red-700 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Restaurar
      </button>
    );
  };

  const renderTabla = (lista, vacio) => (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#1a7fe8] text-white">
          <tr>
            <th className="py-2 px-3 text-left font-medium">Fecha</th>
            <th className="py-2 px-3 text-left font-medium">Hora</th>
            <th className="py-2 px-3 text-right font-medium">Tamaño</th>
            <th className="py-2 px-3 text-right font-medium">Ventas</th>
            <th className="py-2 px-3 text-right font-medium">Productos</th>
            <th className="py-2 px-3 text-right font-medium">Clientes</th>
            <th className="py-2 px-3 text-center font-medium">Verificado</th>
            <th className="py-2 px-3 text-center font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && (
            <tr><td colSpan={8} className="text-center text-slate-400 py-8">{vacio}</td></tr>
          )}
          {lista.map((c) => (
            <tr key={c.id} className="border-b border-slate-100">
              <td className="py-2 px-3">
                {c.fecha}
                {c.estado === "fallido" && (
                  <span className="ml-1.5 text-[10px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">Falló</span>
                )}
              </td>
              <td className="py-2 px-3">{c.hora_local}</td>
              <td className="py-2 px-3 text-right">{formatearTamano(c.bytes)}</td>
              <td className="py-2 px-3 text-right">{c.conteos?.ventas ?? "—"}</td>
              <td className="py-2 px-3 text-right">{c.conteos?.productos ?? "—"}</td>
              <td className="py-2 px-3 text-right">{c.conteos?.clientes ?? "—"}</td>
              <td className="py-2 px-3 text-center" title={c.verificado_en || ""}>
                {c.verificado_en ? "✓" : "—"}
              </td>
              <td className="py-2 px-3 text-center whitespace-nowrap">{renderBotonRestaurar(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const puntosDeRestauracion = copias.filter((c) => c.tipo !== "hora");
  const detallePorHora = copias.filter((c) => c.tipo === "hora");

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      {aviso && <div className="bg-slate-800 text-white text-xs px-4 py-2 shrink-0">{aviso}</div>}

      {enMantenimiento && (
        <div className="bg-amber-50 border-b border-amber-300 text-amber-800 text-xs px-4 py-2 shrink-0 flex items-center gap-1.5">
          <ShieldAlert size={14} className="shrink-0" />
          {estado.mantenimiento.motivo || "El sistema está en mantenimiento."}
        </div>
      )}

      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-center shrink-0">
        {renderSemaforo()}
        {puedeRespaldar && (
          <button
            type="button"
            onClick={respaldarAhora}
            disabled={respaldando || enMantenimiento}
            title={enMantenimiento ? "El sistema está restaurando un respaldo en este momento" : "Respaldar ahora"}
            className="ml-auto flex items-center gap-1.5 bg-[#1a7fe8] text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={15} className={respaldando ? "animate-spin" : ""} />
            {respaldando ? "Respaldando..." : "Respaldar ahora"}
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Cargando…</div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-6">
          <div>
            <h3 className="font-medium text-slate-700 mb-2">Puntos de restauración (30 días)</h3>
            {renderTabla(puntosDeRestauracion, "Sin puntos de restauración")}
          </div>
          <div>
            <h3 className="font-medium text-slate-700 mb-2">Detalle por hora (7 días)</h3>
            {renderTabla(detallePorHora, "Sin respaldos por hora")}
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Restaurar respaldo</h3>
              <button type="button" onClick={cerrarModal} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <form id="form-restaurar" onSubmit={restaurar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {errorComparacion && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{errorComparacion}</p>
              )}
              {!comparacion && !errorComparacion && (
                <p className="text-xs text-slate-500">Comparando con el estado actual…</p>
              )}
              {comparacion && (
                <p className="text-sm text-slate-700">
                  Vas a volver al estado del {comparacion.copia.fecha} {comparacion.copia.hora_local}. {comparacion.resumen}
                </p>
              )}

              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 font-medium">
                Al restaurar, todos los usuarios conectados tienen que volver a entrar. Si hay cajeras vendiendo, se les corta la venta.
              </p>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Clave de restauración *</label>
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Escribe {PALABRA_CONFIRMACION} para confirmar *</label>
                <input
                  required
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              {errorModal && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{errorModal}</p>
              )}
            </form>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button type="button" onClick={cerrarModal} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
              <button
                type="submit"
                form="form-restaurar"
                disabled={restaurando || enMantenimiento || confirmacion !== PALABRA_CONFIRMACION || !clave || !comparacion}
                className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {restaurando ? "Restaurando..." : "Restaurar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
