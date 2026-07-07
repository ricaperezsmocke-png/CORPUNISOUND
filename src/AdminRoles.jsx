import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Edit3, RefreshCw, Trash2, Copy, Share2, Download,
  Search, ShieldCheck, UserPlus, X, Check
} from "lucide-react";
import { apiFetch } from "./api";

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick, tono = "slate" }) {
  const tonos = { slate: "text-slate-700", verde: "text-emerald-600", rojo: "text-red-600" };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-300 hover:bg-slate-200 transition-colors"
    >
      <Icono size={20} className={tonos[tono]} />
      <span className="text-[11px] font-medium text-slate-700 whitespace-nowrap">{etiqueta} ({atajo})</span>
    </button>
  );
}

export default function AdminRoles({ onVolver, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [roles, setRoles] = useState([]);
  const [rolActivoId, setRolActivoId] = useState(null);
  const [catalogo, setCatalogo] = useState({ permisos: [], modulos: [] });
  const [usuarios, setUsuarios] = useState([]);
  const [busquedaPermiso, setBusquedaPermiso] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [modalPersonal, setModalPersonal] = useState(false);
  const [formPersonal, setFormPersonal] = useState({ nombre: "", usuario: "", password: "", rol_id: "" });

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2200); };

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rRoles, rCatalogo, rUsuarios] = await Promise.all([
        apiFetch("/roles"),
        apiFetch("/permisos-catalogo"),
        apiFetch("/usuarios"),
      ]);
      if (!rRoles.ok) throw new Error("No se pudieron cargar los roles");
      const roles = await rRoles.json();
      setRoles(roles);
      setRolActivoId((prev) => prev ?? roles[0]?.id ?? null);
      if (rCatalogo.ok) setCatalogo(await rCatalogo.json());
      if (rUsuarios.ok) setUsuarios(await rUsuarios.json());
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene permiso para administrar roles.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const rolActivo = roles.find((r) => r.id === rolActivoId) || null;

  const permisosFiltrados = useMemo(() => {
    const t = busquedaPermiso.trim().toLowerCase();
    if (!t) return catalogo.permisos;
    return catalogo.permisos.filter((p) => p.etiqueta.toLowerCase().includes(t));
  }, [catalogo.permisos, busquedaPermiso]);

  const permisosPorModulo = useMemo(() => {
    const grupos = {};
    permisosFiltrados.forEach((p) => {
      grupos[p.modulo] = grupos[p.modulo] || [];
      grupos[p.modulo].push(p);
    });
    return grupos;
  }, [permisosFiltrados]);

  const nombreModulo = (id) => catalogo.modulos.find((m) => m.id === id)?.nombre || id;

  const guardarCambiosRol = async (rolId, cambios) => {
    setRoles((prev) => prev.map((r) => (r.id === rolId ? { ...r, ...cambios } : r)));
    try {
      const r = await apiFetch(`/roles/${rolId}`, { method: "PUT", body: JSON.stringify(cambios) });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
      cargarTodo();
    }
  };

  const alternarPermiso = (clave) => {
    if (!puede("administrar_roles")) return mostrarAviso("No tienes permiso para modificar roles");
    if (!rolActivo) return;
    const tiene = rolActivo.permisos.includes(clave);
    const nuevos = tiene ? rolActivo.permisos.filter((p) => p !== clave) : [...rolActivo.permisos, clave];
    guardarCambiosRol(rolActivo.id, { permisos: nuevos });
  };

  const alternarModulo = (moduloId) => {
    if (!puede("administrar_roles")) return mostrarAviso("No tienes permiso para modificar roles");
    if (!rolActivo) return;
    const tiene = rolActivo.modulos.includes(moduloId);
    const nuevos = tiene ? rolActivo.modulos.filter((m) => m !== moduloId) : [...rolActivo.modulos, moduloId];
    guardarCambiosRol(rolActivo.id, { modulos: nuevos });
  };

  const agregarRol = async () => {
    const nombre = prompt("Nombre del nuevo rol:");
    if (!nombre) return;
    try {
      const r = await apiFetch("/roles", { method: "POST", body: JSON.stringify({ nombre, permisos: [], modulos: [] }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      await cargarTodo();
      setRolActivoId(nuevo.id);
      mostrarAviso("Rol creado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const editarNombreRol = async () => {
    if (!rolActivo) return mostrarAviso("Selecciona un rol primero");
    const nombre = prompt("Nuevo nombre del rol:", rolActivo.nombre);
    if (!nombre) return;
    guardarCambiosRol(rolActivo.id, { nombre });
  };

  const eliminarRolActivo = async () => {
    if (!rolActivo) return mostrarAviso("Selecciona un rol primero");
    if (!confirm(`¿Eliminar el rol "${rolActivo.nombre}"? Esto falla si hay personal asignado a él.`)) return;
    try {
      const r = await apiFetch(`/roles/${rolActivo.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error);
      setRolActivoId(null);
      await cargarTodo();
      mostrarAviso("Rol eliminado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const clonarRolActivo = async () => {
    if (!rolActivo) return mostrarAviso("Selecciona un rol primero");
    try {
      const r = await apiFetch(`/roles/${rolActivo.id}/clonar`, { method: "POST", body: JSON.stringify({}) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      await cargarTodo();
      setRolActivoId(nuevo.id);
      mostrarAviso("Rol clonado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const guardarPersonal = async () => {
    if (!formPersonal.nombre || !formPersonal.usuario || !formPersonal.password || !formPersonal.rol_id) {
      return mostrarAviso("Completa nombre, usuario, contraseña y rol");
    }
    try {
      const r = await apiFetch("/usuarios", { method: "POST", body: JSON.stringify(formPersonal) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal agregado");
      setModalPersonal(false);
      setFormPersonal({ nombre: "", usuario: "", password: "", rol_id: "" });
      cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-blue-700 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div>
          <div className="font-semibold text-sm flex items-center gap-2"><ShieldCheck size={16} /> Roles y Personal</div>
          <div className="text-[11px] text-blue-200">Configuración — quién puede hacer qué en cada módulo</div>
        </div>
        {onVolver && (
          <button onClick={onVolver} className="bg-blue-800 hover:bg-blue-900 px-3 py-1.5 rounded text-[11px] font-medium">← Inicio</button>
        )}
      </div>

      <div className="bg-slate-100 border-b border-slate-300 flex overflow-x-auto shrink-0">
        {puede("administrar_roles") && <BotonBarra icono={Plus} etiqueta="Agregar" atajo="F3" tono="verde" onClick={agregarRol} />}
        {puede("administrar_roles") && <BotonBarra icono={Edit3} etiqueta="Editar" atajo="F4" onClick={editarNombreRol} />}
        <BotonBarra icono={RefreshCw} etiqueta="Recargar" atajo="F5" onClick={cargarTodo} />
        {puede("administrar_roles") && <BotonBarra icono={Trash2} etiqueta="Eliminar" atajo="F6" tono="rojo" onClick={eliminarRolActivo} />}
        <BotonBarra icono={Share2} etiqueta="Compartir" atajo="F7" onClick={() => mostrarAviso("Compartir configuración — próximamente")} />
        <BotonBarra icono={Download} etiqueta="Descargar" atajo="F8" onClick={() => mostrarAviso("Exportar configuración — próximamente")} />
        {puede("administrar_roles") && <BotonBarra icono={Copy} etiqueta="Clonar" atajo="F9" onClick={clonarRolActivo} />}
        <div className="ml-auto flex items-center pr-3">
          {puede("dar_alta_personal") && (
            <button onClick={() => setModalPersonal(true)} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded">
              <UserPlus size={14} /> Dar de alta personal
            </button>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2">{error}</div>}

      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 shrink-0">
        <ShieldCheck size={16} className="text-blue-700" />
        <span className="text-slate-500">Rol:</span>
        <select
          value={rolActivoId || ""}
          onChange={(e) => setRolActivoId(Number(e.target.value))}
          className="border border-slate-300 rounded px-3 py-1.5 font-medium text-blue-700 min-w-[200px]"
        >
          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        {rolActivo && (
          <span className="text-xs text-slate-400 ml-2">
            {usuarios.filter((u) => u.rol_id === rolActivo.id).length} persona(s) con este rol
          </span>
        )}
      </div>

      {cargando ? (
        <p className="text-center text-slate-400 py-16">Cargando...</p>
      ) : !rolActivo ? (
        <p className="text-center text-slate-400 py-16">No hay roles todavía — usa "Agregar" para crear el primero</p>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="bg-white border-b border-slate-200 px-4 py-4">
            <div className="text-xs font-semibold text-slate-500 mb-3">Módulos habilitados para este rol</div>
            <div className="flex flex-wrap gap-3">
              {catalogo.modulos.map((m) => {
                const activo = rolActivo.modulos.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => alternarModulo(m.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      activo ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${activo ? "bg-emerald-500" : "bg-slate-300"}`} />
                    {m.nombre}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Search size={16} className="text-slate-400" />
              <input
                value={busquedaPermiso}
                onChange={(e) => setBusquedaPermiso(e.target.value)}
                placeholder="Buscar permiso..."
                className="border border-slate-300 rounded px-3 py-1.5 text-sm flex-1 max-w-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            {Object.entries(permisosPorModulo).map(([moduloId, permisos]) => (
              <div key={moduloId} className="mb-5">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{nombreModulo(moduloId)}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {permisos.map((p) => {
                    const activo = rolActivo.permisos.includes(p.clave);
                    return (
                      <label
                        key={p.clave}
                        className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 cursor-pointer text-sm ${
                          activo ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <input type="checkbox" checked={activo} onChange={() => alternarPermiso(p.clave)} className="mt-0.5" />
                        <span className={activo ? "text-emerald-800" : "text-slate-600"}>
                          {p.etiqueta}
                          {!p.implementado && (
                            <span className="block text-[10px] text-amber-600 mt-0.5">Módulo aún no construido — el permiso queda guardado para cuando exista</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modalPersonal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
            <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Dar de alta personal</h3>
              <button onClick={() => setModalPersonal(false)} className="hover:bg-blue-800 rounded p-1"><X size={18} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Nombre completo</label>
                <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.nombre} onChange={(e) => setFormPersonal({ ...formPersonal, nombre: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Usuario (para iniciar sesión)</label>
                <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.usuario} onChange={(e) => setFormPersonal({ ...formPersonal, usuario: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Contraseña (mínimo 6 caracteres)</label>
                <input type="password" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.password} onChange={(e) => setFormPersonal({ ...formPersonal, password: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Rol</label>
                <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.rol_id} onChange={(e) => setFormPersonal({ ...formPersonal, rol_id: e.target.value })}>
                  <option value="">Selecciona un rol</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </div>
              <button onClick={guardarPersonal} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold flex items-center justify-center gap-1.5">
                <Check size={15} /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
