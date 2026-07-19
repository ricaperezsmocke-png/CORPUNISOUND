import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Edit3, RefreshCw, Trash2, Copy, Share2, Download,
  Search, ShieldCheck, UserPlus, X, Check, MapPin, ShieldAlert,
  Link, CheckCircle, AlertTriangle, Upload, FileText
} from "lucide-react";
import { apiFetch } from "./api";

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick, tono = "slate" }) {
  const tonos = { slate: "text-[#1a7fe8]", verde: "text-emerald-600", rojo: "text-red-500" };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors"
    >
      <Icono size={18} className={tonos[tono]} />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

const MOTIVO_TEXTO = {
  sucursal_no_coincide: "Sucursal seleccionada no coincide",
  ubicacion_no_coincide: "Ubicación no coincide",
  sin_permiso_ubicacion: "Sin permiso de ubicación",
};

const CATEGORIAS_DOCUMENTO = [
  { id: "curriculum", etiqueta: "Curriculum" },
  { id: "acta_nacimiento", etiqueta: "Acta de Nacimiento" },
  { id: "comprobante_domicilio", etiqueta: "Comprobante de Domicilio" },
  { id: "ine", etiqueta: "INE" },
  { id: "contrato", etiqueta: "Contrato" },
];
const TIPOS_ARCHIVO_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

function UbicacionesTiendas({ mostrarAviso }) {
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState({}); // { [id]: { lat, lng } }

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/sucursales");
      const data = await r.json();
      setSucursales(data.filter((s) => !s.sin_ubicacion));
    } catch { /* silencioso */ }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const valoresDe = (s) => editando[s.id] || { lat: s.lat ?? "", lng: s.lng ?? "" };

  const actualizarCampo = (id, valoresActuales, campo, valor) => {
    setEditando((prev) => ({ ...prev, [id]: { ...valoresActuales, [campo]: valor } }));
  };

  const usarMiUbicacion = (id) => {
    if (!navigator.geolocation) return mostrarAviso("❌ Tu navegador no soporta geolocalización");
    navigator.geolocation.getCurrentPosition(
      (pos) => setEditando((prev) => ({ ...prev, [id]: { lat: pos.coords.latitude, lng: pos.coords.longitude } })),
      () => mostrarAviso("❌ No se pudo obtener tu ubicación"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const guardar = async (id) => {
    const valores = editando[id];
    if (!valores) return mostrarAviso("No hay cambios que guardar para esta tienda");
    try {
      const r = await apiFetch(`/sucursales/${id}/ubicacion`, { method: "PUT", body: JSON.stringify(valores) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Ubicación guardada");
      await cargar();
      setEditando((prev) => { const copia = { ...prev }; delete copia[id]; return copia; });
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  if (cargando) return <p className="text-center text-slate-400 py-16">Cargando...</p>;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <p className="text-xs text-slate-500 mb-4 max-w-xl">
        Captura la ubicación de cada tienda para activar la validación por GPS en el login.
        Mientras una tienda no tenga ubicación configurada, el login de su personal no valida GPS.
      </p>
      <div className="flex flex-col gap-3 max-w-xl">
        {sucursales.map((s) => {
          const valores = valoresDe(s);
          return (
            <div key={s.id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="font-semibold mb-2">{s.nombre}</div>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Latitud</label>
                  <input
                    type="number" step="any" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                    value={valores.lat} onChange={(e) => actualizarCampo(s.id, valores, "lat", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Longitud</label>
                  <input
                    type="number" step="any" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                    value={valores.lng} onChange={(e) => actualizarCampo(s.id, valores, "lng", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => usarMiUbicacion(s.id)} className="text-xs border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">
                  Usar mi ubicación actual
                </button>
                <button onClick={() => guardar(s.id)} className="text-xs bg-blue-700 hover:bg-blue-800 text-white rounded px-3 py-1.5 font-semibold">
                  Guardar
                </button>
              </div>
              {s.lat != null && s.lng != null ? (
                <p className="text-[11px] text-emerald-600 mt-2">Configurada: {s.lat}, {s.lng}</p>
              ) : (
                <p className="text-[11px] text-amber-600 mt-2">Sin configurar — el login de esta tienda no valida ubicación todavía</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntentosBloqueados() {
  const [intentos, setIntentos] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const r = await apiFetch("/intentos-bloqueados");
        if (r.ok) setIntentos(await r.json());
      } catch { /* silencioso */ }
      finally { setCargando(false); }
    })();
  }, []);

  if (cargando) return <p className="text-center text-slate-400 py-16">Cargando...</p>;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-[#1a7fe8] text-white">
          <tr>
            <th className="py-2 px-3 text-left font-medium">Usuario</th>
            <th className="py-2 px-3 text-left font-medium">Dijo ser</th>
            <th className="py-2 px-3 text-left font-medium">Motivo</th>
            <th className="py-2 px-3 text-center font-medium">Distancia</th>
            <th className="py-2 px-3 text-left font-medium">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {intentos.length === 0 && (
            <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin intentos bloqueados registrados</td></tr>
          )}
          {intentos.map((i) => (
            <tr key={i.id} className="border-b border-slate-100">
              <td className="py-2 px-3">{i.usuario}</td>
              <td className="py-2 px-3">{i.sucursal_dijo_nombre}</td>
              <td className="py-2 px-3">{MOTIVO_TEXTO[i.motivo] || i.motivo}</td>
              <td className="py-2 px-3 text-center text-slate-500">{i.distancia_metros != null ? `${Math.round(i.distancia_metros)} m` : "—"}</td>
              <td className="py-2 px-3 text-slate-500">{new Date(i.fecha).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminRoles({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [vistaAdmin, setVistaAdmin] = useState("roles"); // "roles" | "ubicaciones" | "bloqueados"
  const [roles, setRoles] = useState([]);
  const [rolActivoId, setRolActivoId] = useState(null);
  const [catalogo, setCatalogo] = useState({ permisos: [], modulos: [] });
  const [usuarios, setUsuarios] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [estadoDrive, setEstadoDrive] = useState(null);
  const [vistaRoles, setVistaRoles] = useState("roles"); // "roles" | "personal"
  const [busquedaPermiso, setBusquedaPermiso] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [modalPersonal, setModalPersonal] = useState(false);
  const [formPersonal, setFormPersonal] = useState({ nombre: "", usuario: "", password: "", rol_id: "", sucursal_id: "" });
  const [personaEditando, setPersonaEditando] = useState(null); // usuario seleccionado o null
  const [formEditarPersonal, setFormEditarPersonal] = useState({ nombre: "", rol_id: "", password: "", sucursal_id: "" });
  const [tabPersonaEditando, setTabPersonaEditando] = useState("datos"); // "datos" | "documentos"
  const [documentosPersona, setDocumentosPersona] = useState([]);
  const [cargandoDocumentos, setCargandoDocumentos] = useState(false);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2200); };

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rRoles, rCatalogo, rUsuarios, rSucursales, rDrive] = await Promise.all([
        apiFetch("/roles"),
        apiFetch("/permisos-catalogo"),
        apiFetch("/usuarios"),
        apiFetch("/sucursales"),
        apiFetch("/drive/estado"),
      ]);
      if (!rRoles.ok) throw new Error("No se pudieron cargar los roles");
      const roles = await rRoles.json();
      setRoles(roles);
      setRolActivoId((prev) => prev ?? roles[0]?.id ?? null);
      if (rCatalogo.ok) setCatalogo(await rCatalogo.json());
      if (rUsuarios.ok) setUsuarios(await rUsuarios.json());
      if (rSucursales.ok) setSucursales(await rSucursales.json());
      if (rDrive.ok) setEstadoDrive(await rDrive.json());
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene permiso para administrar roles.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "conectado") {
      mostrarAviso("✅ Google Drive conectado correctamente");
      window.history.replaceState({}, "", window.location.pathname);
      cargarTodo();
    } else if (params.get("drive") === "error") {
      mostrarAviso("❌ Error al conectar Google Drive: " + (params.get("msg") || "desconocido"));
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const nombreRol = (id) => roles.find((r) => r.id === id)?.nombre || "Rol desconocido";
  const nombreSucursalPersonal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;

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
    if (!formPersonal.nombre || !formPersonal.usuario || !formPersonal.password || !formPersonal.rol_id || !formPersonal.sucursal_id) {
      return mostrarAviso("Completa nombre, usuario, contraseña, rol y sucursal");
    }
    try {
      const r = await apiFetch("/usuarios", { method: "POST", body: JSON.stringify(formPersonal) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal agregado");
      setModalPersonal(false);
      setFormPersonal({ nombre: "", usuario: "", password: "", rol_id: "", sucursal_id: "" });
      cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirEditarPersonal = (u) => {
    setPersonaEditando(u);
    setFormEditarPersonal({ nombre: u.nombre, rol_id: u.rol_id, password: "", sucursal_id: u.sucursal_id });
    setTabPersonaEditando("datos");
    setDocumentosPersona([]);
  };

  const guardarEdicionPersonal = async () => {
    if (!formEditarPersonal.nombre.trim()) return mostrarAviso("El nombre no puede quedar vacío");
    if (!formEditarPersonal.rol_id) return mostrarAviso("Selecciona un rol");
    if (!formEditarPersonal.sucursal_id) return mostrarAviso("Selecciona una sucursal");
    try {
      const payload = { nombre: formEditarPersonal.nombre, rol_id: formEditarPersonal.rol_id, sucursal_id: formEditarPersonal.sucursal_id };
      if (formEditarPersonal.password) payload.password = formEditarPersonal.password;
      const r = await apiFetch(`/usuarios/${personaEditando.id}`, { method: "PUT", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal actualizado");
      setPersonaEditando(null);
      await cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const alternarActivoPersonal = async () => {
    try {
      const r = await apiFetch(`/usuarios/${personaEditando.id}`, { method: "PUT", body: JSON.stringify({ activo: !personaEditando.activo }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(personaEditando.activo ? "Personal desactivado" : "Personal activado");
      setPersonaEditando(null);
      await cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const eliminarPersonal = async () => {
    if (!confirm(`¿Eliminar a "${personaEditando.nombre}" del sistema? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await apiFetch(`/usuarios/${personaEditando.id}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal eliminado");
      setPersonaEditando(null);
      await cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const cargarDocumentosPersona = useCallback(async (usuarioId) => {
    setCargandoDocumentos(true);
    try {
      const r = await apiFetch(`/usuarios/${usuarioId}/documentos`);
      if (r.ok) setDocumentosPersona(await r.json());
    } catch { /* silencioso */ }
    finally { setCargandoDocumentos(false); }
  }, []);

  const subirDocumentoPersona = async (categoria, archivo) => {
    if (!TIPOS_ARCHIVO_PERMITIDOS.includes(archivo.type)) {
      return mostrarAviso("❌ Solo se permiten archivos PDF, JPG o PNG");
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
    }
    try {
      const contenido_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch(`/usuarios/${personaEditando.id}/documentos`, {
        method: "POST",
        body: JSON.stringify({ categoria, nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Documento subido");
      await cargarDocumentosPersona(personaEditando.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const eliminarDocumentoPersona = async (documentoId) => {
    if (!confirm("¿Eliminar este documento? También se borra de Google Drive.")) return;
    try {
      const r = await apiFetch(`/usuarios/${personaEditando.id}/documentos/${documentoId}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Documento eliminado");
      await cargarDocumentosPersona(personaEditando.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const conectarDrive = async () => {
    const r = await apiFetch("/drive/auth-url");
    if (!r.ok) { const d = await r.json(); return mostrarAviso("❌ " + d.error); }
    const { url } = await r.json();
    window.location.href = url;
  };

  useEffect(() => {
    if (personaEditando && tabPersonaEditando === "documentos") {
      cargarDocumentosPersona(personaEditando.id);
    }
  }, [personaEditando, tabPersonaEditando, cargarDocumentosPersona]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex items-center overflow-x-auto shrink-0">
        <button
          onClick={() => setVistaAdmin("roles")}
          className={`px-4 py-3 text-sm font-medium border-b-2 ${vistaAdmin === "roles" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
        >
          <ShieldCheck size={14} className="inline mr-1.5 -mt-0.5" /> Roles y Personal
        </button>
        {puede("administrar_roles") && (
          <button
            onClick={() => setVistaAdmin("ubicaciones")}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${vistaAdmin === "ubicaciones" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            <MapPin size={14} className="inline mr-1.5 -mt-0.5" /> Ubicaciones de Tiendas
          </button>
        )}
        {puede("administrar_roles") && (
          <button
            onClick={() => setVistaAdmin("bloqueados")}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${vistaAdmin === "bloqueados" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            <ShieldAlert size={14} className="inline mr-1.5 -mt-0.5" /> Intentos Bloqueados
          </button>
        )}
      </div>

      {vistaAdmin === "roles" && (
        <>
          <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
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

          {puede("conectar_cuenta_drive") && estadoDrive && (
            <div className="bg-white border-b border-slate-100 flex items-center gap-2 px-4 py-2 shrink-0">
              <span className="text-xs text-slate-500">Google Drive (expedientes de personal):</span>
              {estadoDrive?.conectado ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  <CheckCircle size={12} /> Conectado
                </span>
              ) : !estadoDrive?.configurado ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <AlertTriangle size={12} /> GOOGLE_CLIENT_ID no configurado en el backend
                </span>
              ) : (
                <button onClick={conectarDrive} className="flex items-center gap-1.5 text-xs bg-blue-700 hover:bg-blue-800 text-white rounded px-3 py-1.5 font-medium">
                  <Link size={12} /> Conectar Google Drive
                </button>
              )}
            </div>
          )}

          {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2">{error}</div>}

          <div className="bg-white border-b border-slate-100 flex items-center gap-1 px-4 shrink-0">
            <button
              onClick={() => setVistaRoles("roles")}
              className={`px-3 py-2 text-xs font-medium border-b-2 ${vistaRoles === "roles" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
            >
              Roles
            </button>
            <button
              onClick={() => setVistaRoles("personal")}
              className={`px-3 py-2 text-xs font-medium border-b-2 ${vistaRoles === "personal" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
            >
              Personal ({usuarios.length})
            </button>
          </div>

          {vistaRoles === "personal" ? (
            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-[#1a7fe8] text-white">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium">Nombre</th>
                    <th className="py-2 px-3 text-left font-medium">Usuario</th>
                    <th className="py-2 px-3 text-left font-medium">Rol</th>
                    <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                    <th className="py-2 px-3 text-center font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin personal registrado</td></tr>
                  )}
                  {usuarios.map((u) => (
                    <tr key={u.id} onClick={() => abrirEditarPersonal(u)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                      <td className="py-2 px-3">{u.nombre}</td>
                      <td className="py-2 px-3 text-slate-500">{u.usuario}</td>
                      <td className="py-2 px-3">{nombreRol(u.rol_id)}</td>
                      <td className="py-2 px-3 text-slate-500">{nombreSucursalPersonal(u.sucursal_id)}</td>
                      <td className="py-2 px-3 text-center">
                        {u.activo ? (
                          <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Activo</span>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">Inactivo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
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
            </>
          )}
        </>
      )}

      {vistaAdmin === "ubicaciones" && puede("administrar_roles") && <UbicacionesTiendas mostrarAviso={mostrarAviso} />}
      {vistaAdmin === "bloqueados" && puede("administrar_roles") && <IntentosBloqueados />}

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modalPersonal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-700">Dar de alta personal</h3>
              <button onClick={() => setModalPersonal(false)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
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
              <div>
                <label className="text-xs text-slate-500 block mb-1">Sucursal</label>
                <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.sucursal_id} onChange={(e) => setFormPersonal({ ...formPersonal, sucursal_id: e.target.value })}>
                  <option value="">Selecciona una sucursal</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <button onClick={guardarPersonal} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors">
                <Check size={15} /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {personaEditando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-sm text-slate-700">Editar personal — {personaEditando.nombre}</h3>
              <button onClick={() => setPersonaEditando(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>

            <div className="flex border-b border-slate-100 shrink-0">
              <button
                onClick={() => setTabPersonaEditando("datos")}
                className={`px-4 py-2 text-xs font-medium border-b-2 ${tabPersonaEditando === "datos" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
              >
                Datos
              </button>
              {puede("gestionar_expedientes") && (
                <button
                  onClick={() => setTabPersonaEditando("documentos")}
                  className={`px-4 py-2 text-xs font-medium border-b-2 ${tabPersonaEditando === "documentos" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
                >
                  Documentos
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {tabPersonaEditando === "datos" ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Nombre completo</label>
                    <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.nombre} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, nombre: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Rol</label>
                    <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.rol_id} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, rol_id: e.target.value })}>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Sucursal</label>
                    <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.sucursal_id} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, sucursal_id: e.target.value })}>
                      {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Nueva contraseña (opcional — déjalo en blanco para no cambiarla)</label>
                    <input type="password" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.password} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
                  </div>
                  <button onClick={guardarEdicionPersonal} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors">
                    <Check size={15} /> Guardar cambios
                  </button>
                  {usuario?.id !== personaEditando.id && (
                    <div className="flex gap-2">
                      <button onClick={alternarActivoPersonal} className="flex-1 border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 rounded-lg font-semibold text-sm transition-colors">
                        {personaEditando.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button onClick={eliminarPersonal} className="flex-1 border border-red-300 hover:bg-red-50 text-red-600 py-2 rounded-lg font-semibold text-sm transition-colors">
                        Eliminar
                      </button>
                    </div>
                  )}
                  {usuario?.id === personaEditando.id && (
                    <p className="text-[11px] text-slate-400 text-center">No puedes desactivarte o eliminarte a ti mismo mientras tienes la sesión abierta.</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {!estadoDrive?.conectado ? (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      Conecta Google Drive en la parte de arriba de Roles y Personal para poder subir documentos.
                    </p>
                  ) : cargandoDocumentos ? (
                    <p className="text-center text-slate-400 py-8 text-sm">Cargando...</p>
                  ) : (
                    CATEGORIAS_DOCUMENTO.map((cat) => {
                      const archivos = documentosPersona.filter((d) => d.categoria === cat.id);
                      return (
                        <div key={cat.id} className="border border-slate-200 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-slate-600">{cat.etiqueta}</span>
                            <label className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 cursor-pointer font-medium">
                              <Upload size={13} /> Subir
                              <input
                                type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                                onChange={(e) => { if (e.target.files[0]) subirDocumentoPersona(cat.id, e.target.files[0]); e.target.value = ""; }}
                              />
                            </label>
                          </div>
                          {archivos.length === 0 ? (
                            <p className="text-[11px] text-slate-400">Sin archivos subidos</p>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {archivos.map((d) => (
                                <li key={d.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5">
                                  <a href={d.drive_link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-blue-700 hover:underline truncate">
                                    <FileText size={12} /> {d.nombre_archivo}
                                  </a>
                                  <button onClick={() => eliminarDocumentoPersona(d.id)} className="text-slate-400 hover:text-red-600 shrink-0 ml-2">
                                    <Trash2 size={13} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
