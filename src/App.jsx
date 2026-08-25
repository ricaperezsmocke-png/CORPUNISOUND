import { useState, useEffect } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import PuntoDeVenta from "./PuntoDeVenta.jsx";
import InventarioProductos from "./InventarioProductos.jsx";
import Traspasos from "./Traspasos.jsx";
import Garantias from "./Garantias.jsx";
import AdminRoles from "./AdminRoles.jsx";
import Gastos from "./Gastos.jsx";
import EstadoCuenta from "./EstadoCuenta.jsx";
import CRM from "./CRM.jsx";
import CorteCaja from "./CorteCaja.jsx";
import MercadoLibre from "./MercadoLibre.jsx";
import Reportes from "./Reportes.jsx";
import Respaldos from "./Respaldos.jsx";
import GerenciaVentas from "./GerenciaVentas.jsx";
import EncabezadoModulo from "./EncabezadoModulo.jsx";
import RadarDemanda from "./radar-demanda/RadarDemanda.jsx";
import BarraLateral from "./BarraLateral.jsx";
import Configuracion from "./Configuracion.jsx";
import { apiFetch } from "./api";

const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "garantias", "gastos", "reportes", "estado_cuenta", "respaldos", "gerencia_ventas", "radar_demanda", "configuracion"];

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
    <div className="w-full h-screen flex bg-background">
      <BarraLateral
        usuario={usuario}
        vista={vista}
        onEntrarModulo={(id) => setVista(id)}
        onSalir={salir}
      />

      {/* min-w-0 es obligatorio: sin él, una tabla ancha estira el flex y
          empuja la barra fuera de la pantalla. */}
      <div className="flex-1 min-w-0 flex flex-col">
        <EncabezadoModulo vista={vista} usuario={usuario} onSalir={salir} />

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
        {vista === "garantias" && (
          <Garantias onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "gastos" && (
          <Gastos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "estado_cuenta" && (
          <EstadoCuenta onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
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
        {vista === "respaldos" && (
          <Respaldos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "gerencia_ventas" && (
          <GerenciaVentas onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "radar_demanda" && (
          <RadarDemanda permisos={usuario.permisos} />
        )}
        {vista === "configuracion" && (
          <Configuracion
            onVolverAVenta={() => setVista("pos")}
            onVolverInicio={() => setVista("dashboard")}
            permisos={usuario.permisos}
          />
        )}
        {esDashboard && (
          <Dashboard usuario={usuario} />
        )}
        </div>
      </div>
    </div>
  );
}

export default App;
