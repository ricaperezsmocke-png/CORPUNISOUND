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
import Supervision from "./supervision/Supervision.jsx";
import ExistenciasSicar from "./sicar/ExistenciasSicar.jsx";
import CortesSicar from "./sicar/CortesSicar.jsx";
import { apiFetch } from "./api";
import { vistaApagada } from "./menuCategorias.js";

const MODULOS = [
  "pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "garantias", "gastos", "reportes", "estado_cuenta",
  "respaldos", "gerencia_ventas", "radar_demanda", "configuracion", "supervision", "existencias_sicar", "cortes_sicar",
];

async function seleccionarCajaPredeterminada() {
  localStorage.removeItem("caja_activa");
  if (localStorage.getItem("sucursal_activa") === "todas") return;
  try {
    const respuesta = await apiFetch("/cajas");
    if (!respuesta.ok) return;
    const cajas = await respuesta.json();
    const predeterminada = Array.isArray(cajas) && cajas.find((caja) => caja.predeterminada);
    if (predeterminada) localStorage.setItem("caja_activa", String(predeterminada.id));
  } catch (_) { /* SelectorCaja vuelve a intentarlo y muestra el error en el encabezado. */ }
}

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [vista, setVista] = useState("dashboard");
  // Menú deslizable en celular. En PC no se usa: la barra queda fija con
  // lg:translate-x-0 pase lo que pase aquí.
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Interruptores de pantallas de caja. Si no se pueden leer, se dejan como están (encendidas): el
  // servidor es quien de verdad bloquea, esto solo esconde del menú.
  const [pantallas, setPantallas] = useState(null);
  useEffect(() => {
    if (!usuario) return;
    apiFetch("/configuracion/pantallas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.pantallas) setPantallas(d.pantallas); })
      .catch(() => {});
  }, [usuario, vista]);

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
    seleccionarCajaPredeterminada();
    setUsuario(u);
  };

  const salir = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    localStorage.removeItem("sucursal_activa");
    localStorage.removeItem("caja_activa");
    setUsuario(null);
    setVista("dashboard");
  };

  if (cargandoSesion) return null;
  if (!usuario) return <Login onIngreso={manejarIngreso} />;

  const esDashboard = !MODULOS.includes(vista);

  return (
    <div className="w-full h-pantalla flex bg-background">
      <BarraLateral
        usuario={usuario}
        pantallas={pantallas}
        vista={vista}
        onEntrarModulo={(id) => setVista(id)}
        abierta={menuAbierto}
        onCerrar={() => setMenuAbierto(false)}
      />

      {/* Capa oscura detrás del menú abierto en celular, mismo tono que ya
          usan los modales del sistema (bg-black/40). Tocarla lo cierra. En
          PC no se dibuja nunca (lg:hidden). */}
      {menuAbierto && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMenuAbierto(false)}
          aria-hidden="true"
        />
      )}

      {/* min-w-0 es obligatorio: sin él, una tabla ancha estira el flex y
          empuja la barra fuera de la pantalla. */}
      <div className="flex-1 min-w-0 flex flex-col">
        <EncabezadoModulo
          vista={vista}
          usuario={usuario}
          onSalir={salir}
          onAbrirMenu={() => setMenuAbierto(true)}
          menuAbierto={menuAbierto}
        />

        <div className="flex-1 min-h-0 overflow-auto">
        {vistaApagada(vista, pantallas, usuario) ? (
          <p role="status" className="m-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {vistaApagada(vista, pantallas, usuario)}
          </p>
        ) : <>
        {vista === "pos" && (
          <PuntoDeVenta onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "inventario" && (
          <InventarioProductos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "traspasos" && (
          <Traspasos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "existencias_sicar" && <ExistenciasSicar />}
        {vista === "cortes_sicar" && <CortesSicar permisos={usuario.permisos} />}
        {vista === "garantias" && (
          <Garantias onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} pantallas={pantallas} />
        )}
        {vista === "gastos" && (
          <Gastos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "estado_cuenta" && (
          <EstadoCuenta onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} pantallas={pantallas} />
        )}
        {vista === "roles" && (
          <AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "crm" && (
          <CRM onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
        {vista === "corte" && pantallas?.corte_caja === false && (
          <p role="status" className="mx-6 mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Corte de Caja está apagado para las tiendas. Aquí solo se puede cortar MercadoLibre: elígela en el encabezado.
          </p>
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
        {vista === "supervision" && <Supervision permisos={usuario.permisos} usuario={usuario} />}
        {vista === "radar_demanda" && (
          <RadarDemanda permisos={usuario.permisos} />
        )}
        {vista === "configuracion" && (
          <Configuracion
            onVolverAVenta={() => setVista("pos")}
            onVolverInicio={() => setVista("dashboard")}
            permisos={usuario.permisos}
            onPantallas={setPantallas}
          />
        )}
        {esDashboard && (
          <Dashboard usuario={usuario} />
        )}
        </>}
        </div>
      </div>
    </div>
  );
}

export default App;
