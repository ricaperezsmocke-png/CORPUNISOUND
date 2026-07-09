import React, { useState, useEffect } from "react";
import { Lock, User, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function obtenerUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export default function Login({ onIngreso }) {
  const [necesitaSetup, setNecesitaSetup] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState("");
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/necesita-setup`)
      .then((r) => r.json())
      .then((d) => setNecesitaSetup(d.necesitaSetup))
      .catch(() => setError("No se pudo conectar con el backend"));
    fetch(`${API}/sucursales`)
      .then((r) => r.json())
      .then((d) => setSucursales(d.filter((s) => s.ciudad !== "Online")))
      .catch(() => {});
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
      const { lat, lng } = await obtenerUbicacion();
      const r = await fetch(`${API}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password, sucursal_id_seleccionada: sucursalSeleccionada || null, lat, lng })
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
    <div
      className="w-full h-screen flex items-center justify-center"
      style={{ background: "linear-gradient(135deg, #1a7fe8 0%, #0f4c8a 100%)" }}
    >
      <Card className="w-full max-w-sm shadow-2xl border-0">
        <CardHeader className="items-center pb-2 pt-8">
          <img src="/logo-unisound.jpg" alt="Unisound" className="w-48 object-contain mb-2" />
          <p className="text-sm text-muted-foreground font-medium">Sistema de Gestión Empresarial</p>
        </CardHeader>

        <CardContent className="px-8 pb-2">
          {necesitaSetup === null && (
            <p className="text-center text-muted-foreground text-sm py-4">Conectando con el servidor...</p>
          )}

          {necesitaSetup === true && (
            <form onSubmit={enviarSetup} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground bg-muted rounded-lg p-3 text-center">
                No hay personal registrado — crea la primera cuenta de Administrador.
              </p>
              <Input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
              <Input required value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" />
              <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (mínimo 6 caracteres)" />
              {error && <p className="text-destructive text-xs text-center">{error}</p>}
              <Button type="submit" disabled={cargando} className="w-full mt-1" style={{ backgroundColor: "#1a7fe8" }}>
                {cargando ? "Creando..." : "Crear administrador"}
              </Button>
            </form>
          )}

          {necesitaSetup === false && (
            <form onSubmit={enviarLogin} className="flex flex-col gap-3">
              <div className="relative">
                <User size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                <Input required value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" className="pl-9" />
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="pl-9" />
              </div>
              <div className="relative">
                <MapPin size={16} className="absolute left-3 top-2.5 text-muted-foreground z-10" />
                <select
                  value={sucursalSeleccionada}
                  onChange={(e) => setSucursalSeleccionada(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">Selecciona tu sucursal (si aplica)</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              {error && <p className="text-destructive text-xs text-center">{error}</p>}
              <Button type="submit" disabled={cargando} className="w-full mt-1" style={{ backgroundColor: "#1a7fe8" }}>
                {cargando ? "Entrando..." : "Iniciar sesión"}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="justify-center pb-6 pt-2">
          <p className="text-xs text-muted-foreground">Instrumentos Musicales / Sonido / Accesorios</p>
        </CardFooter>
      </Card>
    </div>
  );
}
