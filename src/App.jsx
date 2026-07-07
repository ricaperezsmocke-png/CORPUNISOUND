import { useState, useEffect } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import PuntoDeVenta from "./PuntoDeVenta.jsx";
import InventarioProductos from "./InventarioProductos.jsx";
import AdminRoles from "./AdminRoles.jsx";
import CRM from "./CRM.jsx";
import CorteCaja from "./CorteCaja.jsx";
import SelectorSucursal from "./SelectorSucursal.jsx";

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

  // Al recibir la sesión del login (objeto `usuario` con ver_todas y sucursal_id),
  // fijamos la sucursal activa: "todas" para vista global, o su propia sucursal
  // para el resto (queda amarrado).
  const manejarIngreso = (u) => {
    localStorage.setItem("sucursal_activa", u.ver_todas ? "todas" : String(u.sucursal_id));
    setUsuario(u);
  };

  const salir = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    localStorage.removeItem("sucursal_activa");
    setUsuario(null);
    setVista("dashboard");
  };

  if (cargandoSesion) return null;

  if (!usuario) {
    return <Login onIngreso={manejarIngreso} />;
  }

  // Franja superior con el selector de sucursal (o etiqueta fija si el usuario
  // está amarrado a una sola). Se muestra sobre cualquier vista para que el
  // filtro esté siempre visible y disponible, sin duplicar el encabezado
  // propio de cada módulo.
  return (
    <div className="w-full h-screen flex flex-col">
      <div className="bg-slate-800 px-4 py-1.5 flex items-center justify-end shrink-0">
        <SelectorSucursal usuario={usuario} onCambio={() => window.location.reload()} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {vista === "pos" && (
          <PuntoDeVenta onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "inventario" && (
          <InventarioProductos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "roles" && (
          <AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "crm" && (
          <CRM onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "corte" && (
          <CorteCaja onVolverInicio={() => setVista("dashboard")} onVolverAVenta={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {!["pos", "inventario", "roles", "crm", "corte"].includes(vista) && (
          <Dashboard onEntrarModulo={(id) => setVista(id)} usuario={usuario} onSalir={salir} />
        )}
      </div>
    </div>
  );
}

export default App;
