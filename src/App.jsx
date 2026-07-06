import { useState, useEffect } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import PuntoDeVenta from "./PuntoDeVenta.jsx";
import InventarioProductos from "./InventarioProductos.jsx";
import AdminRoles from "./AdminRoles.jsx";
import CRM from "./CRM.jsx";
import CorteCaja from "./CorteCaja.jsx";

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [vista, setVista] = useState("dashboard"); // "dashboard" | "pos" | "inventario" | "roles" | "crm"

  useEffect(() => {
    const guardado = localStorage.getItem("usuario");
    const token = localStorage.getItem("token");
    if (guardado && token) setUsuario(JSON.parse(guardado));
    setCargandoSesion(false);
  }, []);

  const salir = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    setUsuario(null);
    setVista("dashboard");
  };

  if (cargandoSesion) return null;

  if (!usuario) {
    return <Login onIngreso={(u) => setUsuario(u)} />;
  }

  if (vista === "pos") {
    return <PuntoDeVenta onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />;
  }
  if (vista === "inventario") {
    return <InventarioProductos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />;
  }
  if (vista === "roles") {
    return <AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />;
  }
  if (vista === "crm") {
    return <CRM onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />;
  }
  if (vista === "corte") {
    return <CorteCaja onVolverInicio={() => setVista("dashboard")} onVolverAVenta={() => setVista("dashboard")} permisos={usuario.permisos} />;
  }
  return <Dashboard onEntrarModulo={(id) => setVista(id)} usuario={usuario} onSalir={salir} />;
}

export default App;
