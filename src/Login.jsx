import React, { useState, useEffect } from "react";
import { Lock, User, Sparkles } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export default function Login({ onIngreso }) {
  const [necesitaSetup, setNecesitaSetup] = useState(null);
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/necesita-setup`)
      .then((r) => r.json())
      .then((d) => setNecesitaSetup(d.necesitaSetup))
      .catch(() => setError("No se pudo conectar con el backend (¿está corriendo en localhost:4000?)"));
  }, []);

  const enviarSetup = async (e) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await fetch(`${API}/auth/setup-inicial`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, usuario, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setNecesitaSetup(false);
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  };

  const enviarLogin = async (e) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localStorage.setItem("token", data.token);
      localStorage.setItem("usuario", JSON.stringify(data.usuario));
      onIngreso(data.usuario, data.token);
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  };

  return (
    <div className="w-full h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <div className="flex items-center gap-2 justify-center mb-6 text-emerald-700">
          <Sparkles size={22} />
          <span className="font-semibold text-lg">Sistema de Negocio</span>
        </div>

        {necesitaSetup === null && <p className="text-center text-slate-400 text-sm">Conectando con el backend...</p>}

        {necesitaSetup === true && (
          <form onSubmit={enviarSetup} className="flex flex-col gap-3">
            <p className="text-xs text-slate-500 bg-slate-50 rounded p-2">
              No hay personal registrado todavía — crea la primera cuenta de Administrador.
            </p>
            <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre"
              className="border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
            <input required value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario para iniciar sesión"
              className="border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (mínimo 6 caracteres)"
              className="border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <button disabled={cargando} className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white rounded py-2 font-semibold text-sm">
              {cargando ? "Creando..." : "Crear administrador"}
            </button>
          </form>
        )}

        {necesitaSetup === false && (
          <form onSubmit={enviarLogin} className="flex flex-col gap-3">
            <div className="relative">
              <User size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input required value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario"
                className="w-full border border-slate-300 rounded px-9 py-2 text-sm focus:outline-none focus:border-emerald-600" />
            </div>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña"
                className="w-full border border-slate-300 rounded px-9 py-2 text-sm focus:outline-none focus:border-emerald-600" />
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <button disabled={cargando} className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white rounded py-2 font-semibold text-sm">
              {cargando ? "Entrando..." : "Iniciar sesión"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
