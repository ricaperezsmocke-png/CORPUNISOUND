import React, { useState, useEffect, useCallback } from "react";
import { Plus, Check, X, UserPlus } from "lucide-react";
import { apiFetch } from "./api";

const pesos = (n) =>
  Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

/**
 * Catálogo de vendedores — quién vende en cada tienda.
 *
 * Vive como pestaña dentro de Roles y Personal porque es lo mismo que se
 * administra ahí: la gente que trabaja. Es distinto de "Personal", que son las
 * cuentas para entrar al sistema — una persona puede tener cuenta sin ser
 * vendedora (un gerente), y hasta que no exista aquí no puede tener objetivo
 * de venta.
 *
 * NO hay botón de borrar, y es a propósito: cada venta guarda el id de su
 * vendedor y los reportes resuelven el nombre por ahí. Borrar dejaría las
 * ventas históricas sin nombre para siempre. Se desactiva.
 *
 * `alCambiarVendedores` avisa al padre (Roles y Personal) de que su copia de
 * la lista quedó vieja. Es un aviso, NO los datos: esta pantalla pide
 * `/vendedores/catalogo`, que trae el registro completo con `cuenta_ligada` y
 * la meta — datos que el padre no debe tener para un rol sin jefatura. Que
 * los vuelva a pedir él por su cuenta, a la ruta recortada que ya usa.
 */
export default function CatalogoVendedores({ permisos, mostrarAviso, alCambiarVendedores }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  const [vendedores, setVendedores] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [verInactivos, setVerInactivos] = useState(false);
  const [modal, setModal] = useState(null); // null | "nuevo" | vendedor a editar
  const [form, setForm] = useState({ nombre: "", sucursal_id: "", meta_mensual: "" });
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [rv, rs] = await Promise.all([
        apiFetch(`/vendedores/catalogo${verInactivos ? "?incluir_inactivos=1" : ""}`),
        apiFetch("/sucursales"),
      ]);
      if (rv.ok) setVendedores(await rv.json());
      if (rs.ok) setSucursales(await rs.json());
    } finally {
      setCargando(false);
    }
  }, [verInactivos]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    setForm({ nombre: "", sucursal_id: "", meta_mensual: "" });
    setErrorModal(null);
    setModal("nuevo");
  };

  const abrirEditar = (v) => {
    setForm({ nombre: v.nombre, sucursal_id: String(v.sucursal_id), meta_mensual: v.meta_mensual || "" });
    setErrorModal(null);
    setModal(v);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) return setErrorModal("Escribe el nombre del vendedor");
    if (!form.sucursal_id) return setErrorModal("Elige la sucursal donde vende");
    setGuardando(true);
    setErrorModal(null);
    try {
      const esNuevo = modal === "nuevo";
      const r = await apiFetch(esNuevo ? "/vendedores" : `/vendedores/${modal.id}`, {
        method: esNuevo ? "POST" : "PUT",
        body: JSON.stringify({
          nombre: form.nombre,
          sucursal_id: form.sucursal_id,
          meta_mensual: form.meta_mensual === "" ? 0 : form.meta_mensual,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      setModal(null);
      mostrarAviso(esNuevo ? "Vendedor dado de alta" : "Vendedor actualizado");
      cargar();
      alCambiarVendedores?.();
    } catch (e) {
      setErrorModal(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async (v) => {
    const r = await apiFetch(`/vendedores/${v.id}/desactivar`, { method: "PUT" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return mostrarAviso("❌ " + (data.error || "No se pudo desactivar"));
    mostrarAviso(`${v.nombre} ya no aparece como vendedor activo`);
    cargar();
    alCambiarVendedores?.();
  };

  const reactivar = async (v) => {
    const r = await apiFetch(`/vendedores/${v.id}`, { method: "PUT", body: JSON.stringify({ activo: true }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return mostrarAviso("❌ " + (data.error || "No se pudo reactivar"));
    mostrarAviso(`${v.nombre} vuelve a estar activo`);
    cargar();
    alCambiarVendedores?.();
  };

  const nombreSucursal = (id) => sucursales.find((s) => s.id === Number(id))?.nombre || `Sucursal ${id}`;

  if (!puede("administrar_vendedores")) {
    return (
      <div className="flex-1 p-6">
        <p className="text-sm text-slate-500">No tienes permiso para administrar el catálogo de vendedores.</p>
      </div>
    );
  }

  if (cargando) return <p className="text-center text-slate-400 py-16">Cargando...</p>;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-xs text-slate-500 max-w-2xl">
          Quién vende en cada tienda. Una persona tiene que estar aquí para poder tener objetivo de
          venta; después se liga con su cuenta desde la pestaña Personal.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
            Ver inactivos
          </label>
          <button
            type="button"
            onClick={abrirNuevo}
            className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white text-sm px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5"
          >
            <Plus size={15} /> Dar de alta vendedor
          </button>
        </div>
      </div>

      <table className="w-full text-sm neu rounded-xl overflow-hidden">
        <thead className="bg-[#1a7fe8] text-white">
          <tr>
            <th className="py-2 px-3 text-left font-medium">Nombre</th>
            <th className="py-2 px-3 text-left font-medium">Sucursal</th>
            <th className="py-2 px-3 text-right font-medium">Meta mensual</th>
            <th className="py-2 px-3 text-left font-medium">Cuenta ligada</th>
            <th className="py-2 px-3 text-right font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {vendedores.length === 0 && (
            <tr><td colSpan={5} className="text-center text-slate-400 py-10">
              Todavía no hay vendedores dados de alta.
            </td></tr>
          )}
          {vendedores.map((v) => (
            <tr key={v.id} className={`border-b border-slate-100 ${v.activo ? "" : "bg-slate-50 text-slate-400"}`}>
              <td className="py-2 px-3">
                {v.nombre}
                {!v.activo && <span className="ml-2 text-[11px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">inactivo</span>}
              </td>
              <td className="py-2 px-3">{nombreSucursal(v.sucursal_id)}</td>
              <td className="py-2 px-3 text-right">
                {v.meta_mensual ? pesos(v.meta_mensual) : <span className="text-slate-400">sin meta</span>}
              </td>
              <td className="py-2 px-3">
                {v.cuenta_ligada
                  ? <span className="text-emerald-700">{v.cuenta_ligada}</span>
                  : <span className="text-slate-400">sin cuenta</span>}
              </td>
              <td className="py-2 px-3 text-right whitespace-nowrap">
                <button type="button" onClick={() => abrirEditar(v)} className="text-blue-600 hover:underline mr-3">
                  Editar
                </button>
                {v.activo ? (
                  <button type="button" onClick={() => desactivar(v)} className="text-slate-500 hover:underline">
                    Desactivar
                  </button>
                ) : (
                  <button type="button" onClick={() => reactivar(v)} className="text-emerald-600 hover:underline">
                    Reactivar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[11px] text-slate-400 mt-3 max-w-2xl">
        Los vendedores no se borran, se desactivan: cada venta guarda quién la hizo, y borrarlos
        dejaría tus reportes históricos sin ese nombre.
      </p>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
          <div className="neu-panel rounded-2xl shadow-2xl w-full max-w-sm max-h-[92vh] flex flex-col overflow-hidden animate-panel-in">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2">
                <UserPlus size={16} className="text-blue-600" />
                {modal === "nuevo" ? "Dar de alta vendedor" : `Editar ${modal.nombre}`}
              </h3>
              <button type="button" onClick={() => setModal(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Nombre completo</label>
                <input
                  autoFocus
                  className="w-full neu-campo rounded-lg px-2.5 py-1.5 text-sm"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Sucursal donde vende</label>
                <select
                  className="w-full neu-campo rounded-lg px-2.5 py-1.5 text-sm"
                  value={form.sucursal_id}
                  onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}
                >
                  <option value="">Selecciona una sucursal</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
                {modal !== "nuevo" && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    Cambiar la sucursal cambia qué ventas le cuentan para su meta.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">
                  Meta mensual <span className="text-slate-400">(opcional)</span>
                </label>
                <input
                  type="number" min="0"
                  className="w-full neu-campo rounded-lg px-2.5 py-1.5 text-sm"
                  value={form.meta_mensual}
                  onChange={(e) => setForm({ ...form, meta_mensual: e.target.value })}
                  placeholder="Puedes dejarla en blanco y fijarla después"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  También puedes fijarla luego desde Mi Objetivo de Venta, con la sugerencia
                  calculada de su historial.
                </p>
              </div>

              {errorModal && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{errorModal}</p>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white px-4 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40"
              >
                <Check size={15} /> {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
