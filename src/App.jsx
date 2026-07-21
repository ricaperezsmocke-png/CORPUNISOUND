import { useState, useEffect } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import PuntoDeVenta from "./PuntoDeVenta.jsx";
import InventarioProductos from "./InventarioProductos.jsx";
import Traspasos from "./Traspasos.jsx";
import AdminRoles from "./AdminRoles.jsx";
import CRM from "./CRM.jsx";
import CorteCaja from "./CorteCaja.jsx";
import MercadoLibre from "./MercadoLibre.jsx";
import Reportes from "./Reportes.jsx";
import EncabezadoModulo from "./EncabezadoModulo.jsx";
import { apiFetch } from "./api";

const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "reportes"];

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [vista, setVista] = useState("dashboard");

  useEffect(() => {
    const guardado = localStorage.getItem("usuario");
    const token = localStorage.getItem("token");
    if (guardado && token) {
      setUsuario(JSON.parse(guardado));
      apiFetch("/auth/yo")
        .then((r) => (r.ok ? r.json() : null))
        .then((fresco) => {
          if (!fresco) return;
          localStorage.setItem("usuario", JSON.stringify(fresco));
          setUsuario(fresco);
          const sucursalGuardada = localStorage.getItem("sucursal_activa");
          const invalida = fresco.ver_todas ? false : sucursalGuardada === "todas";
          if (!sucursalGuardada || invalida) {
            localStorage.setItem("sucursal_activa", fresco.ver_todas ? "todas" : String(fresco.sucursal_id));
          }
        })
        .catch(() => {});
    }
    setCargandoSesion(false);
  }, []);

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
  if (!usuario) return <Login onIngreso={manejarIngreso} />;

  const esDashboard = !MODULOS.includes(vista);

  return (
    <div className="w-full h-screen flex flex-col">
      {!esDashboard && (
        <EncabezadoModulo
          vista={vista}
          usuario={usuario}
          onVolver={() => setVista("dashboard")}
          onSalir={salir}
        />
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {vista === "pos" && (
          <PuntoDeVenta onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "inventario" && (
          <InventarioProductos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "traspasos" && (
          <Traspasos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "roles" && (
          <AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "crm" && (
          <CRM onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "corte" && (
          <CorteCaja
            onVolverInicio={() => setVista("dashboard")}
            onVolverAVenta={() => setVista("dashboard")}
            permisos={usuario.permisos}
          />
        )}
        {vista === "ml" && (
          <MercadoLibre onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "reportes" && (
          <Reportes onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {esDashboard && (
          <Dashboard onEntrarModulo={(id) => setVista(id)} usuario={usuario} onSalir={salir} />
        )}
      </div>
    </div>
  );
}

export default App;
