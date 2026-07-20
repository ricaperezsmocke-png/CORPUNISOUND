import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  LayoutGrid, Search, Settings, FileBarChart, PieChart, Wrench,
  Tag, Edit3, Hash, Ban, Percent, Lock, Gauge, DollarSign, CheckSquare,
  FileText, User, Users, Zap, ClipboardList, FileMinus,
  Clock, RotateCcw, Layers, Cloud, Info, UserCircle2, ShoppingCart,
  Printer, Mail, X, Plus, Minus, Package, UserPlus, MapPin,
  ChevronLeft, ChevronRight, Sparkles, SlidersHorizontal
} from "lucide-react";

import { apiFetch } from "./api";
import ConsultasVentas from "./ConsultasVentas.jsx";
import Configuracion from "./Configuracion.jsx";

const VENDEDORES = [
  { id: 1, nombre: "Ana López" },
  { id: 2, nombre: "Carlos Ruiz" },
];

const TIPOS_DOCUMENTO = ["Ticket", "Factura", "Nota de Venta", "Factura CFDI", "Remisión"];

const CLIENTE_VACIO_FORM = {
  clave: "", representante: "", nombre: "", rfc: "XAXX010101000", email: "",
  telefono: "", celular: "", sujeto_credito: false, precio_lista: 1,
  dias_credito: 0, limite_credito: 0, monedero: 0,
};

const hoyFmt = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

// ============================================================
// PIEZAS REUTILIZABLES
// ============================================================
function BotonBarra({ icono: Icono, etiqueta, atajo, onClick, activo }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors ${activo ? "bg-blue-50" : ""}`}
    >
      <Icono size={18} className="text-[#1a7fe8]" />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

function BotonLateral({ icono: Icono, etiqueta, atajo, onClick, color }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-col items-center gap-1 py-3 hover:bg-slate-100 border-b border-slate-200 transition-colors"
    >
      <Icono size={22} className={color || "text-slate-600"} />
      <span className="text-[10px] leading-tight text-slate-600 text-center">{etiqueta}<br />({atajo})</span>
    </button>
  );
}

function Modal({ titulo, onCerrar, children, ancho = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto animate-panel-in`}>
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold text-sm text-slate-700">{titulo}</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
function Campo({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function PuntoDeVenta({ onVolver, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [vista, setVista] = useState("venta"); // "venta" | "consultas" | "configuracion"
  const [config, setConfig] = useState(null);
  const [vendedorConfirmado, setVendedorConfirmado] = useState(false);
  const [productos, setProductos] = useState([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [errorProductos, setErrorProductos] = useState(null);

  const [clientes, setClientes] = useState([{ id: 0, nombre: "Público en General", tipo: "menudeo", credito_disponible: 0 }]);

  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [proveedores, setProveedores] = useState([]);

  const [carrito, setCarrito] = useState([]);
  const [codigoInput, setCodigoInput] = useState("");
  const [filaSeleccionada, setFilaSeleccionada] = useState(null);
  const [tipoDoc, setTipoDoc] = useState("Ticket");
  const [cliente, setCliente] = useState({ id: 0, nombre: "Público en General", tipo: "menudeo", credito_disponible: 0 });
  const [vendedor, setVendedor] = useState(VENDEDORES[0]);
  const [esCotizacion, setEsCotizacion] = useState(false);
  const [folio, setFolio] = useState(1024);
  const [enEspera, setEnEspera] = useState([]);
  const [aviso, setAviso] = useState(null);

  // "buscar" | "precio" | "cantidad" | "descuento" | "cliente" | "clienteForm" | "vendedor" | "cobro" | "espera" | "rapido"
  const [modal, setModal] = useState(null);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [soloPromos, setSoloPromos] = useState(false);
  const [sinUtilidad, setSinUtilidad] = useState(false);
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);
  const RESULTADOS_POR_PAGINA = 8;

  const [valorTemporal, setValorTemporal] = useState("");
  const [efectivoRecibido, setEfectivoRecibido] = useState("");

  const [condicionesPago, setCondicionesPago] = useState([]);
  const [condicionSeleccionada, setCondicionSeleccionada] = useState(null);

  const [formCliente, setFormCliente] = useState(CLIENTE_VACIO_FORM);

  const [rapidoDescripcion, setRapidoDescripcion] = useState("");
  const [rapidoCantidad, setRapidoCantidad] = useState(1);
  const [rapidoPrecio, setRapidoPrecio] = useState("");
  const [rapidoMotivo, setRapidoMotivo] = useState("");

  const inputCodigoRef = useRef(null);

  const mostrarAviso = (texto) => {
    setAviso(texto);
    setTimeout(() => setAviso(null), 2500);
  };

  // ---------- Carga de catálogo, clientes, categorías y condiciones de pago ----------
  const cargarProductos = useCallback(async () => {
    setCargandoProductos(true);
    setErrorProductos(null);
    try {
      const r = await apiFetch(`/productos`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setProductos(await r.json());
    } catch (e) {
      setErrorProductos("No se pudo cargar el catálogo (¿está corriendo el backend en localhost:4000?)");
    } finally {
      setCargandoProductos(false);
    }
  }, []);

  const cargarClientes = useCallback(async () => {
    try {
      const r = await apiFetch(`/clientes`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setClientes(data);
    } catch { /* se queda con Público en General por defecto */ }
  }, []);

  const cargarCategorias = useCallback(async () => {
    try {
      const r = await apiFetch(`/categorias`);
      if (r.ok) setCategorias(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarDepartamentos = useCallback(async () => {
    try {
      const r = await apiFetch(`/departamentos`);
      if (r.ok) setDepartamentos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarProveedores = useCallback(async () => {
    try {
      const r = await apiFetch(`/proveedores`);
      if (r.ok) setProveedores(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarCondicionesPago = useCallback(async () => {
    try {
      const r = await apiFetch(`/condiciones-pago?sucursal_id=1`);
      if (r.ok) {
        const data = await r.json();
        setCondicionesPago(data);
        // Se conserva CUÁL forma de pago estaba elegida, pero con los datos
        // frescos del backend (si el % cambió en Configuración, aquí se
        // actualiza — antes se quedaba con la copia vieja en memoria).
        setCondicionSeleccionada((prev) => {
          const actualizada = prev ? data.find((c) => c.id === prev.id) : null;
          return actualizada ?? data.find((c) => c.nombre === "EFECTIVO") ?? data[0] ?? null;
        });
      }
    } catch { /* silencioso */ }
  }, []);

  const cargarConfiguracion = useCallback(async () => {
    try {
      const r = await apiFetch(`/configuracion`);
      if (!r.ok) return;
      const data = await r.json();
      setConfig(data);
      setTipoDoc((actual) => (actual === "Ticket" ? data.documento_por_defecto || "Ticket" : actual));
    } catch { /* si falla, se usan los valores por defecto ya establecidos */ }
  }, []);

  useEffect(() => { cargarProductos(); cargarClientes(); cargarCategorias(); cargarDepartamentos(); cargarProveedores(); cargarCondicionesPago(); cargarConfiguracion(); }, [cargarProductos, cargarClientes, cargarCategorias, cargarDepartamentos, cargarProveedores, cargarCondicionesPago, cargarConfiguracion]);

  // Consultas de Ventas y Configuración viven dentro de este mismo componente
  // (solo cambian de "vista", no se remonta la página) — si desde ahí se
  // cancela una venta o cambia algo (el % de descuento por forma de pago,
  // el interruptor de descuentos, el documento por defecto...), hay que
  // refrescar TODO lo que este componente tenía cargado en memoria al
  // volver a la pantalla de venta, o se quedaría con valores viejos hasta
  // recargar el navegador.
  useEffect(() => {
    if (vista === "venta") {
      cargarProductos();
      cargarCondicionesPago();
      cargarConfiguracion();
    }
  }, [vista, cargarProductos, cargarCondicionesPago, cargarConfiguracion]);

  // ---------- Cálculos de totales ----------
  const subtotal = carrito.reduce((acc, f) => acc + f.cantidad * f.precioUnitario, 0);
  const descuentoTotal = carrito.reduce((acc, f) => acc + (f.cantidad * f.precioUnitario * f.descuentoPct) / 100, 0);
  const total = subtotal - descuentoTotal;
  const piezas = carrito.reduce((acc, f) => acc + f.cantidad, 0);

  const descuentoPagoHabilitado = config ? config.descuentos_pago_habilitado !== false : true;
  const descuentoPago = descuentoPagoHabilitado && condicionSeleccionada?.activo ? (condicionSeleccionada.descuento_pct || 0) : 0;
  const totalConCondicion = Math.round(total * (1 - descuentoPago / 100) * 100) / 100;
  const permiteCambioEnCualquierPago = config?.permitir_cambio_en_todas_las_formas_de_pago;
  const mostrarCampoEfectivo = condicionSeleccionada?.nombre === "EFECTIVO" || permiteCambioEnCualquierPago;
  const cambio = mostrarCampoEfectivo && efectivoRecibido !== ""
    ? Math.max(0, Number(efectivoRecibido) - totalConCondicion) : 0;

  // ---------- Operaciones de carrito ----------
  const agregarProducto = useCallback((producto, cantidad = 1) => {
    if (config && !config.permitir_ventas_sin_existencia) {
      if (Number(producto.existencia) <= 0) {
        mostrarAviso(`"${producto.nombre}" no tiene existencia disponible`);
        return;
      }
    }
    setCarrito((prev) => {
      const idx = prev.findIndex((f) => f.producto_id === producto.id);
      const cantidadActualEnCarrito = idx >= 0 ? prev[idx].cantidad : 0;
      const cantidadFinal = cantidadActualEnCarrito + cantidad;
      if (config && !config.permitir_ventas_sin_existencia && cantidadFinal > Number(producto.existencia)) {
        mostrarAviso(`Solo hay ${producto.existencia} de "${producto.nombre}" disponibles`);
        return prev;
      }
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: cantidadFinal };
        return copia;
      }
      return [
        ...prev,
        {
          producto_id: producto.id,
          descripcion: producto.nombre,
          cantidad,
          precioUnitario: producto.precio_venta,
          descuentoPct: 0,
          existencia: producto.existencia,
          esRapido: false,
        },
      ];
    });
  }, [config]);

  const agregarProductoRapido = () => {
    if (!rapidoDescripcion.trim()) return mostrarAviso("Escribe una descripción");
    const precio = Number(rapidoPrecio);
    if (!precio || precio <= 0) return mostrarAviso("Escribe un precio válido");
    setCarrito((prev) => [
      ...prev,
      {
        producto_id: null,
        descripcion: `${rapidoDescripcion.trim()} (pieza especial)`,
        cantidad: Number(rapidoCantidad) || 1,
        precioUnitario: precio,
        descuentoPct: 0,
        existencia: null,
        esRapido: true,
        motivo: rapidoMotivo || "Pieza especial / rezagado, no dado de alta en inventario",
      },
    ]);
    setRapidoDescripcion(""); setRapidoCantidad(1); setRapidoPrecio(""); setRapidoMotivo("");
    setModal(null);
    mostrarAviso("Producto rápido agregado — no afecta el inventario");
  };

  const buscarPorCodigo = () => {
    const texto = codigoInput.trim();
    if (!texto) return;
    const encontrado = productos.find((p) => p.codigo === texto || p.sku.toLowerCase() === texto.toLowerCase());
    if (encontrado) {
      agregarProducto(encontrado);
      setCodigoInput("");
    } else {
      setBusquedaTexto(texto);
      setModal("buscar");
    }
  };

  const removerFila = (idx) => setCarrito((prev) => prev.filter((_, i) => i !== idx));

  const actualizarCantidad = (idx, nuevaCantidad) => {
    if (nuevaCantidad <= 0) return removerFila(idx);
    setCarrito((prev) => {
      const fila = prev[idx];
      if (fila && !fila.esRapido && config && !config.permitir_ventas_sin_existencia) {
        const disponible = Number(fila.existencia);
        if (nuevaCantidad > disponible) {
          mostrarAviso(`Solo hay ${disponible} de "${fila.descripcion}" disponibles`);
          return prev;
        }
      }
      return prev.map((f, i) => (i === idx ? { ...f, cantidad: nuevaCantidad } : f));
    });
  };

  const actualizarPrecio = (idx, nuevoPrecio) => {
    setCarrito((prev) => prev.map((f, i) => (i === idx ? { ...f, precioUnitario: nuevoPrecio } : f)));
  };

  const actualizarDescuento = (idx, pct) => {
    setCarrito((prev) => prev.map((f, i) => (i === idx ? { ...f, descuentoPct: Math.min(100, Math.max(0, pct)) } : f)));
  };

  const limpiarTicket = () => {
    setCarrito([]);
    setCliente(clientes.find((c) => c.id === 0) || clientes[0]);
    setFilaSeleccionada(null);
    setEsCotizacion(false);
    setEfectivoRecibido("");
    setVendedorConfirmado(false);
  };

  const ponerEnEspera = () => {
    if (carrito.length === 0) return mostrarAviso("No hay nada que poner en espera");
    setEnEspera((prev) => [...prev, { id: Date.now(), cliente, carrito, folio }]);
    limpiarTicket();
    setFolio((f) => f + 1);
    mostrarAviso("Ticket puesto en espera");
  };

  const recuperarEspera = (item) => {
    setCarrito(item.carrito);
    setCliente(item.cliente);
    setEnEspera((prev) => prev.filter((e) => e.id !== item.id));
    setModal(null);
  };

  const confirmarCobro = async () => {
    if (config?.solicitar_vendedor_al_cerrar_venta && !vendedorConfirmado) {
      setModal("vendedor");
      return mostrarAviso("Selecciona el vendedor antes de cerrar la venta");
    }
    if (!esCotizacion && mostrarCampoEfectivo && Number(efectivoRecibido) < totalConCondicion) {
      return mostrarAviso("El efectivo recibido es menor al total");
    }

    let folioReal = folio;

    if (!esCotizacion) {
      try {
        const r = await apiFetch("/ventas", {
          method: "POST",
          body: JSON.stringify({
            cliente_id: cliente.id,
            vendedor_id: vendedor.id,
            sucursal_id: 1,
            tipo_documento: tipoDoc,
            metodo_pago: condicionSeleccionada?.nombre || "EFECTIVO",
            subtotal,
            descuento: descuentoTotal,
            total: totalConCondicion,
            lineas: carrito.map((f) => ({
              producto_id: f.esRapido ? null : f.producto_id,
              descripcion: f.esRapido ? f.descripcion : undefined,
              cantidad: f.cantidad,
              precio_unitario: f.precioUnitario,
              descuento_pct: f.descuentoPct,
            })),
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "No se pudo registrar la venta");
        folioReal = data.id;
        cargarProductos();
      } catch (e) {
        mostrarAviso("❌ No se pudo cerrar la venta: " + e.message);
        return;
      }
    }

    mostrarAviso(`${esCotizacion ? "Cotización guardada" : "Venta cerrada — ticket enviado a impresión"} — Folio ${folioReal}`);
    setFolio(folioReal + 1);
    limpiarTicket();
    setModal(null);
    setEfectivoRecibido("");
  };

  // ---------- Clientes ----------
  const guardarNuevoCliente = async () => {
    if (!formCliente.nombre.trim()) return mostrarAviso("El nombre del cliente es obligatorio");
    try {
      const r = await apiFetch(`/clientes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formCliente)
      });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      await cargarClientes();
      setCliente(nuevo);
      setFormCliente(CLIENTE_VACIO_FORM);
      setModal(null);
      mostrarAviso("Cliente agregado");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  // ---------- Atajos de teclado ----------
  useEffect(() => {
    const manejador = (e) => {
      const dentroDeModal = modal !== null;

      if (e.key === "F2" && puede("buscar_articulos")) { e.preventDefault(); setModal("buscar"); }
      else if (e.key === "F3" && filaSeleccionada !== null && puede("cambiar_numero_precio")) { e.preventDefault(); setValorTemporal(String(carrito[filaSeleccionada]?.precioUnitario ?? "")); setModal("precio"); }
      else if (e.key === "F4" && filaSeleccionada !== null) { e.preventDefault(); setValorTemporal(String(carrito[filaSeleccionada]?.cantidad ?? "")); setModal("cantidad"); }
      else if (e.key === "F5" && filaSeleccionada !== null) { e.preventDefault(); setValorTemporal(String(carrito[filaSeleccionada]?.cantidad ?? "")); setModal("cantidad"); }
      else if (e.key === "F6" && filaSeleccionada !== null) { e.preventDefault(); removerFila(filaSeleccionada); setFilaSeleccionada(null); }
      else if (e.key === "F7" && filaSeleccionada !== null && puede("aplicar_descuentos_articulos_venta")) { e.preventDefault(); setValorTemporal(String(carrito[filaSeleccionada]?.descuentoPct ?? "0")); setModal("descuento"); }
      else if (e.key === "F8" && puede("abrir_cajon_dinero")) { e.preventDefault(); mostrarAviso("Abriendo cajón de dinero..."); }
      else if (e.key === "F9") { e.preventDefault(); mostrarAviso("Esperando lectura de báscula..."); }
      else if (e.key === "F10" && puede("cerrar_venta")) { e.preventDefault(); if (carrito.length) setModal("cobro"); else mostrarAviso("El ticket está vacío"); }
      else if (e.key === "F12" && puede("cerrar_venta")) { e.preventDefault(); if (carrito.length) setModal("cobro"); else mostrarAviso("El ticket está vacío"); }
      else if (e.key === "Escape") { if (dentroDeModal) setModal(null); else if (carrito.length && puede("cerrar_venta")) setModal("cobro"); }
      else if (e.key === "Enter" && !dentroDeModal && config?.cerrar_venta_con_enter && document.activeElement === document.body) {
        if (carrito.length && puede("cerrar_venta")) { e.preventDefault(); setModal("cobro"); }
      }
      else if (e.altKey && !dentroDeModal) {
        const k = e.key.toLowerCase();
        if (k === "d" && puede("cambiar_tipo_documento")) { e.preventDefault(); setTipoDoc((t) => TIPOS_DOCUMENTO[(TIPOS_DOCUMENTO.indexOf(t) + 1) % TIPOS_DOCUMENTO.length]); }
        else if (k === "c" && puede("cambiar_cliente")) { e.preventDefault(); setModal("cliente"); }
        else if (k === "v" && puede("cambiar_vendedor")) { e.preventDefault(); setModal("vendedor"); }
        else if (k === "a" && puede("agregar_articulo_rapido")) { e.preventDefault(); setModal("rapido"); }
        else if (k === "t" && puede("cargar_cotizacion")) { e.preventDefault(); setEsCotizacion((v) => !v); mostrarAviso(esCotizacion ? "Modo venta normal" : "Modo cotización: no descuenta inventario"); }
        else if (k === "n" && puede("agregar_nota_credito_venta")) { e.preventDefault(); mostrarAviso("Nota de crédito — requiere folio de venta previo"); }
        else if (k === "e" && puede("poner_ticket_en_espera")) { e.preventDefault(); ponerEnEspera(); }
        else if (k === "r") { e.preventDefault(); setModal("espera"); }
        else if (k === "y") { e.preventDefault(); mostrarAviso("Carga masiva — próximamente"); }
      }
    };
    window.addEventListener("keydown", manejador);
    return () => window.removeEventListener("keydown", manejador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, filaSeleccionada, carrito, esCotizacion, config]);

  useEffect(() => { inputCodigoRef.current?.focus(); }, [modal]);

  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroProveedor) lista = lista.filter((p) => String(p.proveedor_id) === filtroProveedor);
    if (soloPromos) lista = lista.filter((p) => p.promocion);
    if (sinUtilidad) lista = lista.filter((p) => Number(p.precio_venta) <= Number(p.costo));
    return lista;
  }, [productos, busquedaTexto, filtroDepartamento, filtroCategoria, filtroProveedor, soloPromos, sinUtilidad]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  if (vista === "consultas") {
    return <ConsultasVentas onVolverAVenta={() => setVista("venta")} onVolverInicio={onVolver} permisos={permisos} />;
  }
  if (vista === "configuracion") {
    return <Configuracion onVolverAVenta={() => setVista("venta")} onVolverInicio={onVolver} permisos={permisos} />;
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm select-none">
      {/* ===== TABS INTERNOS ===== */}
      <div className="bg-white border-b border-slate-100 flex items-center justify-between shrink-0 px-2">
        <div className="flex">
          {[
            { icono: LayoutGrid, texto: "Operaciones", accion: null },
            { icono: Search, texto: "Consultas", accion: "consultas" },
            { icono: Wrench, texto: "Configuración", accion: "configuracion" },
          ].map(({ icono: Icono, texto, accion }) => (
            <button
              key={texto}
              onClick={() => {
                if (accion === "consultas") {
                  if (!puede("ver_lista_ventas")) return mostrarAviso("Sin permiso para Consultas");
                  setVista("consultas");
                } else if (accion === "configuracion") {
                  if (!puede("editar_configuracion_pos")) return mostrarAviso("Sin permiso para Configuración");
                  setVista("configuracion");
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-[#1a7fe8] border-b-2 border-transparent hover:border-[#1a7fe8] transition-colors"
            >
              <Icono size={14} />{texto}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pr-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><Package size={12} /> Caja 1</span>
          <button onClick={() => mostrarAviso("Sincronizado con la nube")} className="hover:text-[#1a7fe8] flex items-center gap-1"><Cloud size={13} /> Nube</button>
        </div>
      </div>

      {/* ===== BARRA DE HERRAMIENTAS F2-F12 ===== */}
      <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
        {puede("buscar_articulos") && <BotonBarra icono={Search} etiqueta="Buscar" atajo="F2" onClick={() => setModal("buscar")} />}
        {puede("cambiar_numero_precio") && <BotonBarra icono={Tag} etiqueta="Precio" atajo="F3" onClick={() => {
          if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila del ticket primero");
          setValorTemporal(String(carrito[filaSeleccionada].precioUnitario)); setModal("precio");
        }} />}
        <BotonBarra icono={Edit3} etiqueta="Editar" atajo="F4" onClick={() => {
          if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila del ticket primero");
          setValorTemporal(String(carrito[filaSeleccionada].cantidad)); setModal("cantidad");
        }} />
        <BotonBarra icono={Hash} etiqueta="Cantidad" atajo="F5" onClick={() => {
          if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila del ticket primero");
          setValorTemporal(String(carrito[filaSeleccionada].cantidad)); setModal("cantidad");
        }} />
        <BotonBarra icono={Ban} etiqueta="Remover" atajo="F6" onClick={() => {
          if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila del ticket primero");
          removerFila(filaSeleccionada); setFilaSeleccionada(null);
        }} />
        {puede("aplicar_descuentos_articulos_venta") && <BotonBarra icono={Percent} etiqueta="Desc." atajo="F7" onClick={() => {
          if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila del ticket primero");
          setValorTemporal(String(carrito[filaSeleccionada].descuentoPct)); setModal("descuento");
        }} />}
        {puede("abrir_cajon_dinero") && <BotonBarra icono={Lock} etiqueta="Cajón" atajo="F8" onClick={() => mostrarAviso("Abriendo cajón de dinero...")} />}
        <BotonBarra icono={Gauge} etiqueta="Báscula" atajo="F9" onClick={() => mostrarAviso("Esperando lectura de báscula...")} />
        {puede("cerrar_venta") && <BotonBarra icono={DollarSign} etiqueta="Importe" atajo="F10" onClick={() => (carrito.length ? setModal("cobro") : mostrarAviso("El ticket está vacío"))} />}
        {puede("cerrar_venta") && <BotonBarra icono={CheckSquare} etiqueta="Check" atajo="F12" onClick={() => (carrito.length ? setModal("cobro") : mostrarAviso("El ticket está vacío"))} />}
      </div>

      {errorProductos && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{errorProductos}</div>
      )}

      {/* ===== CUERPO: SIDEBAR + CONTENIDO ===== */}
      <div className="flex flex-1 min-h-0">
        {/* -------- SIDEBAR IZQUIERDO -------- */}
        <div className="w-24 bg-white border-r border-slate-300 flex flex-col shrink-0 overflow-y-auto">
          {puede("cerrar_venta") && (
            <button
              onClick={() => (carrito.length ? setModal("cobro") : mostrarAviso("El ticket está vacío"))}
              className="flex flex-col items-center gap-1 py-4 border-b border-slate-200 hover:bg-emerald-50"
            >
              <div className="bg-emerald-600 text-white rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">OK</div>
              <span className="text-[10px] text-slate-600">Cerrar<br />(ESC)</span>
            </button>
          )}
          {puede("cancelar_ticket") && (
            <button
              onClick={() => (carrito.length ? (confirm("¿Cancelar este ticket? Se perderán los productos agregados.") && limpiarTicket()) : mostrarAviso("El ticket ya está vacío"))}
              className="flex flex-col items-center gap-1 py-3 border-b border-slate-200 hover:bg-red-50"
            >
              <X size={20} className="text-red-500" />
              <span className="text-[10px] text-slate-600">Cancelar<br />ticket</span>
            </button>
          )}
          {puede("cambiar_tipo_documento") && <BotonLateral icono={FileText} etiqueta="Doc" atajo="Alt+D" color="text-blue-600" onClick={() => setTipoDoc((t) => TIPOS_DOCUMENTO[(TIPOS_DOCUMENTO.indexOf(t) + 1) % TIPOS_DOCUMENTO.length])} />}
          {puede("cambiar_cliente") && <BotonLateral icono={User} etiqueta="Cliente" atajo="Alt+C" color="text-blue-600" onClick={() => setModal("cliente")} />}
          {puede("cambiar_vendedor") && <BotonLateral icono={Users} etiqueta="Vend." atajo="Alt+V" color="text-blue-600" onClick={() => setModal("vendedor")} />}
          {puede("agregar_articulo_rapido") && <BotonLateral icono={Zap} etiqueta="A. Ráp" atajo="Alt+A" color="text-amber-500" onClick={() => setModal("rapido")} />}
          {puede("cargar_cotizacion") && <BotonLateral icono={ClipboardList} etiqueta="Cotiz." atajo="Alt+T" color={esCotizacion ? "text-red-600" : "text-red-400"} onClick={() => setEsCotizacion((v) => !v)} />}
          {puede("agregar_nota_credito_venta") && <BotonLateral icono={FileMinus} etiqueta="Nota Cr." atajo="Alt+N" color="text-red-500" onClick={() => mostrarAviso("Nota de crédito — requiere folio de venta previo")} />}
          {puede("poner_ticket_en_espera") && <BotonLateral icono={Clock} etiqueta="Espera" atajo="Alt+E" color="text-slate-500" onClick={ponerEnEspera} />}
          <BotonLateral icono={RotateCcw} etiqueta="Rec." atajo="Alt+R" color="text-blue-500" onClick={() => setModal("espera")} />
          <BotonLateral icono={Layers} etiqueta="Masiva" atajo="Alt+Y" color="text-slate-500" onClick={() => mostrarAviso("Carga masiva — próximamente")} />
        </div>

        {/* -------- CONTENIDO CENTRAL -------- */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Encabezado del ticket */}
          <div className="p-3 border-b border-slate-200 bg-white">
            <div className="flex gap-3">
              <div className="w-20 h-20 bg-slate-200 rounded flex items-center justify-center shrink-0">
                <Package size={28} className="text-slate-400" />
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <Hash size={16} className="text-slate-400" />
                  <input
                    ref={inputCodigoRef}
                    value={codigoInput}
                    onChange={(e) => setCodigoInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && buscarPorCodigo()}
                    placeholder="Escanea o escribe un código de barras / SKU y presiona Enter"
                    className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button onClick={buscarPorCodigo} className="bg-slate-200 hover:bg-slate-300 p-2 rounded"><Search size={16} /></button>
                  <button onClick={() => mostrarAviso("Enviando a impresora...")} className="bg-slate-200 hover:bg-slate-300 p-2 rounded"><Printer size={16} /></button>
                  <span className="text-xs text-slate-400 ml-auto">{hoyFmt()}</span>
                </div>
                <div className="flex gap-2 items-center text-sm">
                  <button onClick={() => setTipoDoc((t) => TIPOS_DOCUMENTO[(TIPOS_DOCUMENTO.indexOf(t) + 1) % TIPOS_DOCUMENTO.length])} className="text-blue-700 font-semibold border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50">
                    {tipoDoc}
                  </button>
                  {esCotizacion && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">COTIZACIÓN</span>}
                  <span className="text-slate-400 text-xs ml-auto">Folio: {folio}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <User size={16} className="text-slate-400" />
                  <button onClick={() => setModal("cliente")} className="flex-1 text-left border border-slate-300 rounded px-3 py-1.5 text-blue-700 font-medium hover:bg-slate-50">
                    {cliente.nombre}
                  </button>
                  <Users size={16} className="text-slate-400" />
                  <button onClick={() => setModal("vendedor")} className="border border-slate-300 rounded px-3 py-1.5 text-blue-700 font-medium hover:bg-slate-50">
                    {vendedor.nombre}
                  </button>
                  <span className="text-xs text-slate-500 border border-slate-300 rounded px-2 py-1.5 bg-slate-50">MXN</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tabla del ticket */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-2 text-left font-medium">Cant</th>
                  <th className="py-2 px-2 text-left font-medium">Descripción</th>
                  <th className="py-2 px-2 text-center font-medium w-24">Exis.</th>
                  <th className="py-2 px-2 text-center font-medium w-20">% Desc</th>
                  <th className="py-2 px-2 text-right font-medium w-24">Precio U.</th>
                  <th className="py-2 px-2 text-right font-medium w-28">Importe</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {carrito.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-16">
                      Ticket vacío — escanea un código o presiona <span className="font-semibold">F2</span> para buscar productos
                    </td>
                  </tr>
                )}
                {carrito.map((fila, idx) => {
                  const importe = fila.cantidad * fila.precioUnitario * (1 - fila.descuentoPct / 100);
                  const seleccionada = filaSeleccionada === idx;
                  return (
                    <tr
                      key={idx}
                      onClick={() => setFilaSeleccionada(idx)}
                      className={`border-b border-slate-100 cursor-pointer ${seleccionada ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); actualizarCantidad(idx, fila.cantidad - 1); }} className="text-slate-400 hover:text-slate-700"><Minus size={13} /></button>
                          <span className="w-8 text-center">{fila.cantidad}</span>
                          <button onClick={(e) => { e.stopPropagation(); actualizarCantidad(idx, fila.cantidad + 1); }} className="text-slate-400 hover:text-slate-700"><Plus size={13} /></button>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        {fila.descripcion}
                        {fila.esRapido && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">RÁPIDO</span>}
                      </td>
                      <td className="py-2 px-2 text-center text-slate-500">{fila.esRapido ? "—" : fila.existencia}</td>
                      <td className="py-2 px-2 text-center text-slate-500">{fila.descuentoPct > 0 ? `${fila.descuentoPct}%` : "-"}</td>
                      <td className="py-2 px-2 text-right">${fila.precioUnitario.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-medium">${importe.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center">
                        <button onClick={(e) => { e.stopPropagation(); removerFila(idx); }} className="text-red-400 hover:text-red-600">
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Barra de totales */}
          <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex items-center justify-between text-xs shrink-0 text-slate-600">
            <div className="flex gap-6">
              <span>Piezas: <b>{piezas}</b></span>
              <span className="text-red-400">Notas de Créd: <b>$0.00</b></span>
              <span className="text-red-400">Promociones: <b>$0.00</b></span>
            </div>
            <div className="flex gap-6">
              <span>Monedero: <b>${Number(cliente.monedero || 0).toFixed(2)}</b></span>
              <span className="text-red-400">Descuento: <b>${descuentoTotal.toFixed(2)}</b></span>
              <span>Retenciones: <b>$0.00</b></span>
            </div>
          </div>
          <div className="px-4 py-3 flex items-center justify-end gap-3 shrink-0 border-t border-slate-100" style={{ background: "linear-gradient(90deg, #1262b8 0%, #1a7fe8 100%)" }}>
            <span className="text-sm text-blue-100">Total:</span>
            <span className="text-2xl font-bold text-white">${total.toFixed(2)} MXN</span>
          </div>

          {/* Pie de estado */}
          <div className="bg-slate-100 border-t border-slate-300 px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
            <div className="flex gap-4">
              <button onClick={() => mostrarAviso("Sistema activado")} className="hover:text-slate-800">Activar</button>
              <span>Tim (0)</span>
              <button onClick={() => mostrarAviso("Saldos de caja consultados")} className="hover:text-slate-800">Saldos</button>
              <button onClick={() => mostrarAviso("Impresora lista")} className="hover:text-slate-800 flex items-center gap-1"><Printer size={12} /> Impresora</button>
              <button onClick={() => mostrarAviso("Enviando ticket por correo...")} className="hover:text-slate-800 flex items-center gap-1"><Mail size={12} /> eMail</button>
            </div>
            <span>Vendedor: {vendedor.nombre}</span>
          </div>
        </div>
      </div>

      {/* ===== AVISO FLOTANTE ===== */}
      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">
          {aviso}
        </div>
      )}

      {/* ===== MODAL: BUSCAR ARTÍCULO (estilo SICAR) ===== */}
      {modal === "buscar" && (
        <Modal titulo="Buscar Artículo (F2)" onCerrar={() => setModal(null)} ancho="max-w-3xl">
          <input
            autoFocus
            value={busquedaTexto}
            onChange={(e) => { setBusquedaTexto(e.target.value); setPaginaBusqueda(1); }}
            placeholder="Clave, descripción o código de barras..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={soloPromos} onChange={(e) => { setSoloPromos(e.target.checked); setPaginaBusqueda(1); }} /> Solo Promos
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={sinUtilidad} onChange={(e) => { setSinUtilidad(e.target.checked); setPaginaBusqueda(1); }} /> Sin Utilidad
            </label>
            <select value={filtroDepartamento} onChange={(e) => { setFiltroDepartamento(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los departamentos</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtroProveedor} onChange={(e) => { setFiltroProveedor(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-left font-medium w-28">Localización</th>
                  <th className="py-2 px-3 text-center font-medium w-20">Exist.</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Precio</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => { agregarProducto(p); setModal(null); setBusquedaTexto(""); }}
                    className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        {p.sku}
                        {p.promocion && <span className="bg-amber-100 text-amber-700 px-1 rounded flex items-center gap-0.5"><Sparkles size={9} /> Promo</span>}
                      </div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className="py-2 px-3 text-slate-500 flex items-center gap-1"><MapPin size={12} />{p.ubicacion || "-"}</td>
                    <td className={`py-2 px-3 text-center ${p.existencia < p.existencia_minima ? "text-red-600 font-semibold" : "text-slate-600"}`}>{p.existencia}</td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.precio_venta).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-center gap-3 mt-3">
            <button disabled={paginaBusqueda <= 1} onClick={() => setPaginaBusqueda((p) => p - 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-500">Página {paginaBusqueda} de {totalPaginas}</span>
            <button disabled={paginaBusqueda >= totalPaginas} onClick={() => setPaginaBusqueda((p) => p + 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </Modal>
      )}

      {/* ===== MODAL: PRODUCTO RÁPIDO (Alt+A) ===== */}
      {modal === "rapido" && (
        <Modal titulo="Agregar producto rápido (Alt+A)" onCerrar={() => setModal(null)}>
          <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
            Para piezas especiales o rezagados que NO se van a dar de alta en el catálogo.
            Esta línea no descuenta ni afecta el inventario.
          </p>
          <Campo label="Descripción" className="mb-3">
            <input autoFocus className={inputCls} value={rapidoDescripcion} onChange={(e) => setRapidoDescripcion(e.target.value)} placeholder="ej: Pieza suelta de fábrica" />
          </Campo>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Campo label="Cantidad">
              <input type="number" className={inputCls} value={rapidoCantidad} onChange={(e) => setRapidoCantidad(e.target.value)} min="1" />
            </Campo>
            <Campo label="Precio">
              <input type="number" className={inputCls} value={rapidoPrecio} onChange={(e) => setRapidoPrecio(e.target.value)} placeholder="0.00" />
            </Campo>
          </div>
          <Campo label="Motivo / nota (opcional)" className="mb-4">
            <input className={inputCls} value={rapidoMotivo} onChange={(e) => setRapidoMotivo(e.target.value)} placeholder="ej: Rezagado de fábrica, lote 4" />
          </Campo>
          <button onClick={agregarProductoRapido} className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded font-semibold">Agregar al ticket</button>
        </Modal>
      )}

      {modal === "precio" && filaSeleccionada !== null && (
        <Modal titulo="Cambiar precio (F3)" onCerrar={() => setModal(null)}>
          <p className="text-sm text-slate-500 mb-2">{carrito[filaSeleccionada].descripcion}</p>
          <input
            autoFocus type="number" value={valorTemporal}
            onChange={(e) => setValorTemporal(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-lg text-right mb-4 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => { actualizarPrecio(filaSeleccionada, Number(valorTemporal) || 0); setModal(null); }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium transition-colors"
          >Aplicar</button>
        </Modal>
      )}

      {modal === "cantidad" && filaSeleccionada !== null && (
        <Modal titulo="Cambiar cantidad (F4 / F5)" onCerrar={() => setModal(null)}>
          <p className="text-sm text-slate-500 mb-2">{carrito[filaSeleccionada].descripcion}</p>
          <input
            autoFocus type="number" value={valorTemporal}
            onChange={(e) => setValorTemporal(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-lg text-right mb-4 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => { actualizarCantidad(filaSeleccionada, Number(valorTemporal) || 0); setModal(null); }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium transition-colors"
          >Aplicar</button>
        </Modal>
      )}

      {modal === "descuento" && filaSeleccionada !== null && (
        <Modal titulo="Aplicar descuento (F7)" onCerrar={() => setModal(null)}>
          <p className="text-sm text-slate-500 mb-2">{carrito[filaSeleccionada].descripcion}</p>
          <div className="flex items-center gap-2 mb-4">
            <input
              autoFocus type="number" value={valorTemporal}
              onChange={(e) => setValorTemporal(e.target.value)}
              className="flex-1 border border-slate-300 rounded px-3 py-2 text-lg text-right focus:outline-none focus:border-blue-500"
            />
            <span className="text-lg text-slate-500">%</span>
          </div>
          <button
            onClick={() => { actualizarDescuento(filaSeleccionada, Number(valorTemporal) || 0); setModal(null); }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium transition-colors"
          >Aplicar</button>
        </Modal>
      )}

      {/* ===== MODAL: SELECCIONAR CLIENTE ===== */}
      {modal === "cliente" && (
        <Modal titulo="Seleccionar cliente (Alt+C)" onCerrar={() => setModal(null)} ancho="max-w-lg">
          <button
            onClick={() => { setFormCliente(CLIENTE_VACIO_FORM); setModal("clienteForm"); }}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-blue-300 text-blue-700 rounded-lg py-2.5 mb-3 hover:bg-blue-50 font-medium"
          >
            <UserPlus size={16} /> Nuevo cliente
          </button>
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {clientes.map((c) => (
              <button
                key={c.id}
                onClick={() => { setCliente(c); setModal(null); }}
                className={`w-full text-left py-2.5 px-2 hover:bg-slate-50 flex justify-between items-center ${cliente.id === c.id ? "text-blue-700 font-semibold" : ""}`}
              >
                <div>
                  {c.nombre}
                  {c.sujeto_credito && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">crédito</span>}
                </div>
                <span className="text-xs text-slate-400 capitalize">{c.tipo}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ===== MODAL: DATOS DE CLIENTE (alta) ===== */}
      {modal === "clienteForm" && (
        <Modal titulo="Datos de Cliente — Nuevo" onCerrar={() => setModal("cliente")} ancho="max-w-2xl">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Campo label="Clave"><input className={inputCls} value={formCliente.clave} onChange={(e) => setFormCliente({ ...formCliente, clave: e.target.value })} /></Campo>
            <Campo label="RFC"><input className={inputCls} value={formCliente.rfc} onChange={(e) => setFormCliente({ ...formCliente, rfc: e.target.value })} /></Campo>
          </div>
          <Campo label="Nombre" className="mb-3">
            <input autoFocus className={inputCls} value={formCliente.nombre} onChange={(e) => setFormCliente({ ...formCliente, nombre: e.target.value, representante: formCliente.representante || e.target.value })} placeholder="Nombre o razón social" />
          </Campo>
          <Campo label="Representante" className="mb-3">
            <input className={inputCls} value={formCliente.representante} onChange={(e) => setFormCliente({ ...formCliente, representante: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Campo label="Teléfono"><input className={inputCls} value={formCliente.telefono} onChange={(e) => setFormCliente({ ...formCliente, telefono: e.target.value })} /></Campo>
            <Campo label="Celular"><input className={inputCls} value={formCliente.celular} onChange={(e) => setFormCliente({ ...formCliente, celular: e.target.value })} /></Campo>
          </div>
          <Campo label="eMail" className="mb-3">
            <input className={inputCls} value={formCliente.email} onChange={(e) => setFormCliente({ ...formCliente, email: e.target.value })} />
          </Campo>
          <div className="border-t border-slate-200 pt-3 mb-3">
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" checked={formCliente.sujeto_credito} onChange={(e) => setFormCliente({ ...formCliente, sujeto_credito: e.target.checked })} />
              Es sujeto de crédito
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Campo label="Precio (lista 1-4)"><input type="number" min="1" max="4" className={inputCls} value={formCliente.precio_lista} onChange={(e) => setFormCliente({ ...formCliente, precio_lista: e.target.value })} /></Campo>
              <Campo label="Días crédito"><input type="number" className={inputCls} value={formCliente.dias_credito} onChange={(e) => setFormCliente({ ...formCliente, dias_credito: e.target.value })} disabled={!formCliente.sujeto_credito} /></Campo>
              <Campo label="Límite de crédito"><input type="number" className={inputCls} value={formCliente.limite_credito} onChange={(e) => setFormCliente({ ...formCliente, limite_credito: e.target.value })} disabled={!formCliente.sujeto_credito} /></Campo>
            </div>
          </div>
          <button onClick={guardarNuevoCliente} className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2.5 rounded-lg font-semibold transition-colors">Aceptar</button>
        </Modal>
      )}

      {modal === "vendedor" && (
        <Modal titulo="Seleccionar vendedor (Alt+V)" onCerrar={() => setModal(null)}>
          <div className="divide-y divide-slate-100">
            {VENDEDORES.map((v) => (
              <button
                key={v.id}
                onClick={() => { setVendedor(v); setVendedorConfirmado(true); setModal(null); }}
                className={`w-full text-left py-2.5 px-2 hover:bg-slate-50 ${vendedor.id === v.id ? "text-blue-700 font-semibold" : ""}`}
              >
                {v.nombre}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {modal === "espera" && (
        <Modal titulo="Tickets en espera (Alt+R)" onCerrar={() => setModal(null)}>
          {enEspera.length === 0 && <p className="text-slate-400 text-center py-8">No hay tickets en espera</p>}
          <div className="divide-y divide-slate-100">
            {enEspera.map((item) => (
              <button
                key={item.id}
                onClick={() => recuperarEspera(item)}
                className="w-full text-left py-2.5 px-2 hover:bg-slate-50 flex justify-between items-center"
              >
                <div>
                  <div className="font-medium">Folio {item.folio} — {item.cliente.nombre}</div>
                  <div className="text-xs text-slate-400">{item.carrito.length} productos</div>
                </div>
                <span className="text-blue-700 font-semibold">
                  ${item.carrito.reduce((a, f) => a + f.cantidad * f.precioUnitario * (1 - f.descuentoPct / 100), 0).toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ===== MODAL: COBRAR — condiciones por forma de pago ===== */}
      {modal === "cobro" && (
        <Modal titulo={esCotizacion ? "Guardar cotización (F10 / F12)" : "Condiciones por forma de pago"} onCerrar={() => setModal(null)} ancho="max-w-xl">
          {esCotizacion ? (
            <>
              <div className="text-center mb-4">
                <div className="text-xs text-slate-400">Total a cotizar</div>
                <div className="text-3xl font-bold text-slate-800">${total.toFixed(2)} MXN</div>
              </div>
              <button onClick={confirmarCobro} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded font-semibold">Guardar cotización</button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">Sucursal Centro — descuentos configurables por forma de pago</span>
                {puede("editar_configuracion_pos") && (
                  <button onClick={() => { setModal(null); setVista("configuracion"); }} className="text-xs text-blue-700 flex items-center gap-1 hover:underline">
                    <SlidersHorizontal size={12} /> Editar en Configuración
                  </button>
                )}
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-[#1a7fe8] text-white">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium">Nombre</th>
                      <th className="py-2 px-3 text-right font-medium">Total</th>
                      <th className="py-2 px-3 text-center font-medium">Condición</th>
                      <th className="py-2 px-3 text-right font-medium">Nuevo Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {condicionesPago.map((c) => {
                      const activoEfectivo = descuentoPagoHabilitado && c.activo;
                      const nuevoTotal = Math.round(total * (1 - (activoEfectivo ? c.descuento_pct : 0) / 100) * 100) / 100;
                      const seleccionada = condicionSeleccionada?.id === c.id;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => setCondicionSeleccionada(c)}
                          className={`border-b border-slate-100 last:border-0 cursor-pointer ${seleccionada ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                        >
                          <td className={`py-2 px-3 font-medium ${seleccionada ? "text-emerald-700" : ""}`}>{c.nombre}</td>
                          <td className="py-2 px-3 text-right text-slate-500">${total.toFixed(2)}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={activoEfectivo && c.descuento_pct > 0 ? "text-emerald-700 font-medium" : "text-slate-400"}>
                              {!descuentoPagoHabilitado ? "descuentos deshabilitados" : c.activo ? `${c.descuento_pct.toFixed(2)}% desc.` : "deshabilitado"}
                            </span>
                          </td>
                          <td className={`py-2 px-3 text-right font-semibold ${seleccionada ? "text-emerald-700" : ""}`}>${nuevoTotal.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <>
                <div className="text-center mb-3">
                  <div className="text-xs text-slate-400">Total a cobrar ({condicionSeleccionada?.nombre || "—"})</div>
                  <div className="text-3xl font-bold text-slate-800">${totalConCondicion.toFixed(2)} MXN</div>
                </div>
                {mostrarCampoEfectivo && (
                  <div className="mb-3">
                    <label className="text-xs text-slate-500">Efectivo recibido</label>
                    <input
                      type="number" value={efectivoRecibido}
                      onChange={(e) => setEfectivoRecibido(e.target.value)}
                      className="w-full border border-slate-300 rounded px-3 py-2 text-lg text-right focus:outline-none focus:border-blue-500"
                    />
                    {efectivoRecibido !== "" && (
                      <div className="text-right text-sm text-emerald-700 font-semibold mt-1">Cambio: ${cambio.toFixed(2)}</div>
                    )}
                  </div>
                )}
                <button onClick={confirmarCobro} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded font-semibold">
                  Confirmar cobro
                </button>
              </>
            </>
          )}
        </Modal>
      )}

    </div>
  );
}
