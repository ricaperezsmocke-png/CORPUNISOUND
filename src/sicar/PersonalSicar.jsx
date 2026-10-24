import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { fechaHoraCorte } from "./cortesSicar.js";

const CAJA = "rounded-lg border border-slate-300 bg-white";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const CELDA = "border-b border-slate-200 px-3 py-2 align-top";
const NOTA_ROJA = "mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800";
const BTN = "rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50";
const BTN_PRIMARIO = "rounded-md border border-blue-700 bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50";
const CAMPO = "w-full rounded-md border border-slate-400 px-3 py-2 text-sm sm:w-64";
const HISTORIAL = "mt-2 space-y-1 text-xs text-slate-600";

function Historial({ cambios }) {
  if (!cambios.length) return <p className="text-xs text-slate-500">Sin cambios de nombre.</p>;
  return (
    <ul className={HISTORIAL}>
      {cambios.map((h, i) => (
        <li key={`${h.fecha}-${i}`}>
          {fechaHoraCorte(h.fecha)}: {h.nombre_anterior ? `"${h.nombre_anterior}"` : "sin nombre"} a "{h.nombre_nuevo}" (hecho por usuario {h.actor})
        </li>
      ))}
    </ul>
  );
}

export default function PersonalSicar({ puedeAsignar, tiendas }) {
  const [personal, setPersonal] = useState([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      // sucursal_id vacío: el encabezado no recorta; el alcance lo decide el servidor con el token.
      const respuesta = await apiFetch("/sicar/personal?sucursal_id=");
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || "No se pudo cargar el personal.");
      setPersonal(Array.isArray(cuerpo) ? cuerpo : []);
    } catch (e) {
      setError(e.message || "No se pudo cargar el personal.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (p) => {
    setGuardando(true);
    setErrorGuardar("");
    try {
      const ruta = `/sicar/personal/${encodeURIComponent(p.sucursal_id)}/${encodeURIComponent(p.usu_id)}?sucursal_id=`;
      const respuesta = await apiFetch(ruta, { method: "PUT", body: JSON.stringify({ nombre }) });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || "No se pudo guardar el nombre.");
      setEditando(null);
      await cargar();
    } catch (e) {
      setErrorGuardar(e.message || "No se pudo guardar el nombre.");
    } finally {
      setGuardando(false);
    }
  };

  const nombreTienda = (id) => tiendas.find((t) => String(t.id) === String(id))?.nombre || `Tienda ${id}`;

  return (
    <div>
      <p className="mb-2 text-sm text-slate-700">
        Usuarios de SICAR vistos en cortes o cobros. El nombre solo sirve para mostrarlos; el número de SICAR siempre se ve junto a él.
      </p>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      <div className={`${CAJA} overflow-x-auto`}>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className={ENCABEZADO}>Tienda</th>
              <th className={ENCABEZADO}>Usuario SICAR</th>
              <th className={ENCABEZADO}>Turnos</th>
              <th className={ENCABEZADO}>Último turno</th>
              <th className={ENCABEZADO}>Nombre asignado</th>
              <th className={ENCABEZADO}>Historial</th>
            </tr>
          </thead>
          <tbody>
            {personal.map((p) => {
              const llave = `${p.sucursal_id}-${p.usu_id}`;
              const abierto = editando === llave;
              return (
                <tr key={llave}>
                  <td className={CELDA}>{nombreTienda(p.sucursal_id)}</td>
                  <td className={CELDA}>SICAR {p.usu_id}</td>
                  <td className={CELDA}>{p.turnos}</td>
                  <td className={CELDA}>{fechaHoraCorte(p.ultimo)}</td>
                  <td className={CELDA}>
                    {abierto ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className={CAMPO}
                          aria-label={`Nombre para el usuario SICAR ${p.usu_id}`}
                          value={nombre}
                          maxLength={80}
                          onChange={(e) => setNombre(e.target.value)}
                        />
                        <button type="button" className={BTN_PRIMARIO} disabled={guardando} onClick={() => guardar(p)}>Guardar</button>
                        <button type="button" className={BTN} disabled={guardando} onClick={() => setEditando(null)}>Cancelar</button>
                        {errorGuardar && <p role="alert" className="w-full text-xs text-red-700">{errorGuardar}</p>}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{p.nombre || "Sin nombre"}</span>
                        {puedeAsignar && (
                          <button
                            type="button"
                            className={BTN}
                            onClick={() => { setEditando(llave); setNombre(p.nombre || ""); setErrorGuardar(""); }}
                          >
                            {p.nombre ? "Cambiar nombre" : "Asignar nombre"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={CELDA}><Historial cambios={p.historial || []} /></td>
                </tr>
              );
            })}
            {!cargando && personal.length === 0 && !error && (
              <tr><td className={CELDA} colSpan={6}>Todavía no hay usuarios de SICAR registrados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {cargando && <p className="mt-2 text-sm text-slate-500">Cargando…</p>}
    </div>
  );
}
