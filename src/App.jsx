import { useState, useEffect } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import PuntoDeVenta from "./PuntoDeVenta.jsx";
import InventarioProductos from "./InventarioProductos.jsx";
import AdminRoles from "./AdminRoles.jsx";
import CRM from "./CRM.jsx";
import CorteCaja from "./CorteCaja.jsx";
import SelectorSucursal from "./SelectorSucursal.jsx";
import { apiFetch } from "./api";

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [vista, setVista] = useState("dashboard"); // "dashboard" | "pos" | "inventario" | "roles" | "crm"

  useEffect(() => {
    const guardado = localStorage.getItem("usuario");
    const token = localStorage.getItem("token");
    if (guardado && token) {
      setUsuario(JSON.parse(guardado));
      // Refresca la sesión contra el backend: si un administrador cambió el
      // rol o los permisos de este usuario después de que inició sesión, esto
      // lo recoge (con recargar la página) sin que tenga que cerrar sesión y
      // volver a entrar. Antes, permisos/rol quedaban congelados desde el
      // login y un cambio de permisos no surtía efecto hasta el siguiente
      // inicio de sesión.
      apiFetch("/auth/yo")
        .then((r) => (r.ok ? r.json() : null))
        .then((fresco) => {
          if (!fresco) return;
          localStorage.setItem("usuario", JSON.stringify(fresco));
          setUsuario(fresco);
          // Si cambió ver_todas, la sucursal activa guardada puede quedar
          // inconsistente (p.ej. "todas" para alguien que ya no ve todas).
          const sucursalGuardada = localStorage.getItem("sucursal_activa");
          const invalida = fresco.ver_todas ? false : sucursalGuardada === "todas";
          if (!sucursalGuardada || invalida) {
            localStorage.setItem("sucursal_activa", fresco.ver_todas ? "todas" : String(fresco.sucursal_id));
          }
        })
        .catch(() => {}); // sin conexión: seguimos con lo que había en localStorage
    }
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

  // El Dashboard trae su propio encabezado (usuario + "Salir"), así que ahí el
  // selector de sucursal se muestra dentro de ese encabezado (ver Dashboard.jsx)
  // en vez de una franja aparte, para no duplicar la barra superior.
  // El resto de los módulos no tiene ese contexto de usuario en su encabezado,
  // así que conservan la franja compartida para que el filtro de sucursal
  // siga siempre visible.
  const esDashboard = !["pos", "inventario", "roles", "crm", "corte"].includes(vista);

  return (
    <div className="w-full h-screen flex flex-col">
      {!esDashboard && (
        <div className="bg-uni-blue px-4 py-1.5 flex items-center justify-end shrink-0">
          <SelectorSucursal usuario={usuario} onCambio={() => window.location.reload()} />
        </div>
      )}
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
        {esDashboard && (
          <Dashboard onEntrarModulo={(id) => setVista(id)} usuario={usuario} onSalir={salir} />
        )}
      </div>
    </div>
  );
}

export default App;
