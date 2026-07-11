import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search, Edit3, Hash, Ban, Percent, FileCode, ClipboardList,
  X, Plus, Minus, Package, Truck, Users, FileMinus, Clock, RotateCcw,
  History, ChevronLeft, ChevronRight
} from "lucide-react";
import { apiFetch } from "./api";
import ArticuloCompra from "./ArticuloCompra";

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors">
      <Icono size={18} className="text-[#1a7fe8]" />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

function BotonLateral({ icono: Icono, etiqueta, atajo, onClick, color }) {
  return (
    <button onClick={onClick} className="w-full flex flex-col items-center gap-1 py-3 hover:bg-slate-100 border-b border-slate-200 transition-colors">
      <Icono size={22} className={color || "text-slate-600"} />
      <span className="text-[10px] leading-tight text-slate-600 text-center">{etiqueta}<br />({atajo})</span>
    </button>
  );
}

function Modal({ titulo, onCerrar, children, ancho = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto`}>
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold text-sm text-slate-700">{titulo}</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const RESULTADOS_POR_PAGINA = 8;

export default function RecepcionCompras({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [recepciones, setRecepciones] = useState([]);
  const [tab, setTab] = useState("nueva"); // "nueva" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);

  const [proveedorId, setProveedorId] = useState("");
  const [sucursalOrigenId, setSucursalOrigenId] = useState("");
  const [factura, setFactura] = useState("");
  const [comentario, setComentario] = useState("");
  const [renglones, setRenglones] = useState([]);
  const [filaSeleccionada, setFilaSeleccionada] = useState(null);

  const [codigoInput, setCodigoInput] = useState("");
  const codigoRef = useRef(null);

  // "buscar" | "articulo" | "cantidad" | "descuento" | "espera" | "importarXml"
  const [modal, setModal] = useState(null);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);
  const [productoParaArticulo, setProductoParaArticulo] = useState(null);
  const [valorTemporal, setValorTemporal] = useState("");
  const [enEspera, setEnEspera] = useState([]);
  const [xmlParseado, setXmlParseado] = useState(null); // resultado de importar-xml
  const [matchesXml, setMatchesXml] = useState({}); // { [indiceConcepto]: producto_id | null }
  const [cargandoXml, setCargandoXml] = useState(false);
  const [uuidCfdiActual, setUuidCfdiActual] = useState(null);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreProveedor = (id) => proveedores.find((p) => p.id === id)?.nombre || `Proveedor ${id}`;
  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const productoDe = (id) => productos.find((p) => p.id === id);

  const origenEfectivo = usuario?.ver_todas ? (sucursalOrigenId || "todas") : usuario?.sucursal_id;

  const cargarProductos = useCallback(async (origen) => {
    try {
      const r = await apiFetch(`/productos?sucursal_id=${origen || "todas"}`);
      setProductos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rSuc, rProv, rCat, rDep, rComp] = await Promise.all([
        apiFetch(`/sucursales`), apiFetch(`/proveedores`), apiFetch(`/categorias`), apiFetch(`/departamentos`), apiFetch(`/compras`)
      ]);
      setSucursales(await rSuc.json());
      setProveedores(await rProv.json());
      setCategorias(await rCat.json());
      setDepartamentos(await rDep.json());
      setRecepciones(await rComp.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);
  useEffect(() => { cargarProductos(origenEfectivo); }, [origenEfectivo, cargarProductos]);
  useEffect(() => { codigoRef.current?.focus(); }, [modal]);

  const crearProveedorRapido = async () => {
    const nombre = prompt("Nombre del nuevo proveedor:");
    if (!nombre || !nombre.trim()) return;
    const rfc = prompt("RFC (opcional):") || "";
    try {
      const r = await apiFetch(`/proveedores`, { method: "POST", body: JSON.stringify({ nombre, rfc }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setProveedores((prev) => [...prev, nuevo]);
      setProveedorId(nuevo.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const leerArchivoXml = (archivo) => {
    setCargandoXml(true);
    const lector = new FileReader();
    lector.onload = async (e) => {
      try {
        const r = await apiFetch(`/compras/importar-xml`, { method: "POST", body: JSON.stringify({ xml: e.target.result }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setXmlParseado(data);
        const sugeridos = {};
        data.conceptos.forEach((c, idx) => {
          const match = productos.find((p) => p.clave_sat && c.clave_sat && p.clave_sat === c.clave_sat);
          sugeridos[idx] = match ? match.id : null;
        });
        setMatchesXml(sugeridos);
        const proveedorExistente = proveedores.find((p) => p.rfc && p.rfc === data.emisor.rfc);
        if (proveedorExistente) setProveedorId(proveedorExistente.id);
      } catch (err) {
        mostrarAviso("❌ " + err.message);
        setModal(null);
      } finally {
        setCargandoXml(false);
      }
    };
    lector.readAsText(archivo);
  };

  const confirmarImportacionXml = () => {
    const nuevos = xmlParseado.conceptos
      .map((c, idx) => ({ concepto: c, producto_id: matchesXml[idx] }))
      .filter((x) => x.producto_id);
    if (nuevos.length === 0) return mostrarAviso("Vincula al menos un producto antes de continuar");

    setRenglones((prev) => {
      const copia = [...prev];
      nuevos.forEach(({ concepto, producto_id }) => {
        const idx = copia.findIndex((r) => r.producto_id === producto_id);
        const renglon = {
          producto_id,
          cantidad: concepto.cantidad,
          costo: concepto.valor_unitario,
          descuento_pesos: 0,
          descuento_porcentaje: 0,
          clave_sat: concepto.clave_sat,
          localizacion: productoDe(producto_id)?.localizacion || "",
          aplicaIva: concepto.aplica_iva,
          neto: true,
          precios: productoDe(producto_id)?.precios,
        };
        if (idx >= 0) copia[idx] = renglon; else copia.push(renglon);
      });
      return copia;
    });
    setUuidCfdiActual(xmlParseado.folioFiscal);
    mostrarAviso(`${nuevos.length} producto(s) agregado(s) desde la factura`);
    setXmlParseado(null);
    setMatchesXml({});
    setModal(null);
  };

  const abrirArticuloParaProducto = (producto) => {
    const existente = renglones.find((r) => r.producto_id === producto.id);
    setProductoParaArticulo({ producto, existente });
    setModal("articulo");
    setBusquedaTexto("");
  };

  const aceptarArticulo = (renglon) => {
    setRenglones((prev) => {
      const idx = prev.findIndex((r) => r.producto_id === renglon.producto_id);
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = renglon;
        return copia;
      }
      return [...prev, renglon];
    });
    setModal(null);
    setProductoParaArticulo(null);
  };

  const buscarPorCodigo = () => {
    const texto = codigoInput.trim();
    if (!texto) return;
    const encontrado = productos.find((p) => p.sku.toLowerCase() === texto.toLowerCase() || (p.codigo || "") === texto);
    if (encontrado) {
      abrirArticuloParaProducto(encontrado);
      setCodigoInput("");
    } else {
      setBusquedaTexto(texto);
      setModal("buscar");
    }
  };

  const quitarRenglon = (producto_id) => {
    setRenglones((prev) => prev.filter((r) => r.producto_id !== producto_id));
    setFilaSeleccionada(null);
  };

  const actualizarCantidadRapida = (producto_id, delta) => {
    setRenglones((prev) => prev.map((r) => r.producto_id === producto_id ? { ...r, cantidad: Math.max(1, Number(r.cantidad) + delta) } : r));
  };

  const limpiarFormulario = () => {
    setProveedorId(""); setSucursalOrigenId(""); setFactura(""); setComentario(""); setRenglones([]); setFilaSeleccionada(null);
    setUuidCfdiActual(null);
  };

  const registrarRecepcion = async () => {
    if (usuario?.ver_todas && !sucursalOrigenId) return mostrarAviso("Selecciona la sucursal que recibe");
    if (!proveedorId) return mostrarAviso("Selecciona un proveedor");
    if (renglones.length === 0) return mostrarAviso("Agrega al menos un producto");
    try {
      const payload = {
        proveedor_id: proveedorId,
        factura,
        comentario,
        sucursal_id: sucursalOrigenId,
        uuid_cfdi: uuidCfdiActual,
        renglones: renglones.map((r) => ({
          producto_id: r.producto_id, cantidad: r.cantidad, costo: r.costo,
          descuento_pesos: r.descuento_pesos, descuento_porcentaje: r.descuento_porcentaje,
          clave_sat: r.clave_sat, localizacion: r.localizacion,
          aplicaIva: r.aplicaIva, neto: r.neto, precios: r.precios,
        })),
      };
      const r = await apiFetch(`/compras?sucursal_id=todas`, { method: "POST", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Recepción registrada");
      limpiarFormulario();
      await Promise.all([cargarTodo(), cargarProductos(origenEfectivo)]);
      setTab("historial");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const ponerEnEspera = () => {
    if (renglones.length === 0) return mostrarAviso("No hay nada que poner en espera");
    setEnEspera((prev) => [...prev, { id: Date.now(), proveedorId, factura, comentario, renglones }]);
    limpiarFormulario();
    mostrarAviso("Recepción puesta en espera");
  };

  const recuperarEspera = (item) => {
    setProveedorId(item.proveedorId); setFactura(item.factura); setComentario(item.comentario); setRenglones(item.renglones);
    setEnEspera((prev) => prev.filter((e) => e.id !== item.id));
    setModal(null);
  };

  // ---------- Atajos de teclado ----------
  useEffect(() => {
    const manejador = (e) => {
      const dentroDeModal = modal !== null;
      if (e.key === "F2" && !dentroDeModal) { e.preventDefault(); setBusquedaTexto(""); setModal("buscar"); }
      else if (e.key === "F4" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault();
        const r = renglones[filaSeleccionada];
        const producto = productoDe(r.producto_id);
        if (producto) abrirArticuloParaProducto(producto);
      }
      else if (e.key === "F5" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault();
        setValorTemporal(String(renglones[filaSeleccionada].cantidad)); setModal("cantidad");
      }
      else if (e.key === "F6" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault(); quitarRenglon(renglones[filaSeleccionada].producto_id);
      }
      else if (e.key === "F7" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault();
        setValorTemporal(String(renglones[filaSeleccionada].descuento_porcentaje || 0)); setModal("descuento");
      }
      else if (e.key === "F8" && !dentroDeModal) { e.preventDefault(); setModal("importarXml"); }
      else if (e.key === "F10") { e.preventDefault(); mostrarAviso("Pedido — próximamente"); }
      else if (e.key === "Escape") { if (dentroDeModal) setModal(null); else registrarRecepcion(); }
      else if (e.altKey && !dentroDeModal) {
        const k = e.key.toLowerCase();
        if (k === "d") { e.preventDefault(); mostrarAviso("Tipo de documento — próximamente"); }
        else if (k === "p") { e.preventDefault(); document.getElementById("select-proveedor")?.focus(); }
        else if (k === "n") { e.preventDefault(); mostrarAviso("Devolución a proveedor — próximamente"); }
        else if (k === "e") { e.preventDefault(); ponerEnEspera(); }
        else if (k === "r") { e.preventDefault(); setModal("espera"); }
      }
    };
    window.addEventListener("keydown", manejador);
    return () => window.removeEventListener("keydown", manejador);
  }, [modal, filaSeleccionada, renglones, productos, proveedorId, sucursalOrigenId, factura, comentario]);

  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) => p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria, filtroDepartamento]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const totalDescuento = renglones.reduce((acc, r) => acc + (Number(r.descuento_pesos) || 0) * r.cantidad + (r.costo * r.cantidad * (Number(r.descuento_porcentaje) || 0) / 100), 0);
  const totalImporte = renglones.reduce((acc, r) => {
    const costoFinal = Math.round((r.costo - (r.descuento_pesos || 0)) * (1 - (r.descuento_porcentaje || 0) / 100) * 100) / 100;
    return acc + costoFinal * r.cantidad;
  }, 0);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm select-none">
      <div className="bg-white border-b border-slate-100 flex items-center justify-between shrink-0 px-2">
        <div className="flex">
          <button onClick={() => setTab("nueva")} className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === "nueva" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
            <Truck size={14} className="inline mr-1.5 -mt-0.5" /> Compras (F1)
          </button>
          <button onClick={() => setTab("historial")} className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === "historial" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
            <History size={14} className="inline mr-1.5 -mt-0.5" /> Historial ({recepciones.length})
          </button>
        </div>
      </div>

      {tab === "nueva" ? (
        cargando ? (
          <p className="text-center text-slate-400 py-16">Cargando...</p>
        ) : (
        <>
          <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
            <BotonBarra icono={Search} etiqueta="Buscar" atajo="F2" onClick={() => { setBusquedaTexto(""); setModal("buscar"); }} />
            <BotonBarra icono={Edit3} etiqueta="Editar" atajo="F4" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              const producto = productoDe(renglones[filaSeleccionada].producto_id);
              if (producto) abrirArticuloParaProducto(producto);
            }} />
            <BotonBarra icono={Hash} etiqueta="Cantidad" atajo="F5" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              setValorTemporal(String(renglones[filaSeleccionada].cantidad)); setModal("cantidad");
            }} />
            <BotonBarra icono={Ban} etiqueta="Remover" atajo="F6" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              quitarRenglon(renglones[filaSeleccionada].producto_id);
            }} />
            <BotonBarra icono={Percent} etiqueta="Desc." atajo="F7" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              setValorTemporal(String(renglones[filaSeleccionada].descuento_porcentaje || 0)); setModal("descuento");
            }} />
            <BotonBarra icono={FileCode} etiqueta="Imp. XML" atajo="F8" onClick={() => setModal("importarXml")} />
            <BotonBarra icono={ClipboardList} etiqueta="Pedido" atajo="F10" onClick={() => mostrarAviso("Pedido — próximamente")} />
          </div>

          <div className="flex flex-1 min-h-0">
            <div className="w-24 bg-white border-r border-slate-300 flex flex-col shrink-0 overflow-y-auto">
              <button onClick={registrarRecepcion} className="flex flex-col items-center gap-1 py-4 border-b border-slate-200 hover:bg-emerald-50">
                <div className="bg-emerald-600 text-white rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">OK</div>
                <span className="text-[10px] text-slate-600">Cerrar<br />(ESC)</span>
              </button>
              <BotonLateral icono={Users} etiqueta="Prov." atajo="Alt+P" color="text-blue-600" onClick={() => document.getElementById("select-proveedor")?.focus()} />
              <BotonLateral icono={Package} etiqueta="Doc" atajo="Alt+D" color="text-slate-400" onClick={() => mostrarAviso("Tipo de documento — próximamente")} />
              <BotonLateral icono={FileMinus} etiqueta="Dev Pro" atajo="Alt+N" color="text-red-400" onClick={() => mostrarAviso("Devolución a proveedor — próximamente")} />
              <BotonLateral icono={Clock} etiqueta="Espera" atajo="Alt+E" color="text-slate-500" onClick={ponerEnEspera} />
              <BotonLateral icono={RotateCcw} etiqueta="Rec." atajo="Alt+R" color="text-blue-500" onClick={() => setModal("espera")} />
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="p-3 border-b border-slate-200 bg-white">
                <div className="flex gap-2 items-center mb-2">
                  <Hash size={16} className="text-slate-400" />
                  <input
                    ref={codigoRef} value={codigoInput} onChange={(e) => setCodigoInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && buscarPorCodigo()}
                    placeholder="Escanea o escribe una clave y presiona Enter"
                    className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <label className="text-xs text-slate-500 flex items-center gap-1.5 border border-slate-300 rounded px-2 py-1.5">Neto <input type="checkbox" disabled className="opacity-50" /></label>
                  <span className="text-xs text-slate-500 border border-slate-300 rounded px-2 py-1.5 bg-slate-50">MXN</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Proveedor">
                    <div className="flex gap-1.5">
                      <select id="select-proveedor" className={inputCls} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                        <option value="">Selecciona...</option>
                        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <button onClick={crearProveedorRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo proveedor"><Plus size={14} /></button>
                    </div>
                  </Campo>
                  <Campo label="Factura / remisión">
                    <input className={inputCls} value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="ej: A-1024" />
                  </Campo>
                </div>
                {puede("ver_todas_las_sucursales") && (
                  <div className="mt-2">
                    <Campo label="Sucursal que recibe">
                      <select className={inputCls} value={sucursalOrigenId} onChange={(e) => setSucursalOrigenId(e.target.value)}>
                        <option value="">Selecciona...</option>
                        {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </Campo>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1a7fe8] text-white sticky top-0">
                    <tr>
                      <th className="py-2 px-2 text-left font-medium">Cant</th>
                      <th className="py-2 px-2 text-left font-medium">Descripción</th>
                      <th className="py-2 px-2 text-center font-medium w-16">Factor</th>
                      <th className="py-2 px-2 text-center font-medium w-16">Exist.</th>
                      <th className="py-2 px-2 text-right font-medium w-24">$ Desc</th>
                      <th className="py-2 px-2 text-right font-medium w-24">Precio U.</th>
                      <th className="py-2 px-2 text-right font-medium w-28">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renglones.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-slate-400 py-16">Sin productos — presiona F2 o escanea un código para agregar</td></tr>
                    )}
                    {renglones.map((r, idx) => {
                      const producto = productoDe(r.producto_id);
                      const costoFinal = Math.round((r.costo - (r.descuento_pesos || 0)) * (1 - (r.descuento_porcentaje || 0) / 100) * 100) / 100;
                      const importe = costoFinal * r.cantidad;
                      const seleccionada = filaSeleccionada === idx;
                      return (
                        <tr key={r.producto_id} onClick={() => setFilaSeleccionada(idx)} className={`border-b border-slate-100 cursor-pointer ${seleccionada ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); actualizarCantidadRapida(r.producto_id, -1); }} className="text-slate-400 hover:text-slate-700"><Minus size={13} /></button>
                              <span className="w-8 text-center">{r.cantidad}</span>
                              <button onClick={(e) => { e.stopPropagation(); actualizarCantidadRapida(r.producto_id, 1); }} className="text-slate-400 hover:text-slate-700"><Plus size={13} /></button>
                            </div>
                          </td>
                          <td className="py-2 px-2">{producto ? producto.nombre : `Producto ${r.producto_id}`}</td>
                          <td className="py-2 px-2 text-center text-slate-500">{producto?.factor ?? 1}</td>
                          <td className="py-2 px-2 text-center text-slate-500">{producto?.existencia ?? "—"}</td>
                          <td className="py-2 px-2 text-right text-slate-500">{r.descuento_pesos ? `$${Number(r.descuento_pesos).toFixed(2)}` : r.descuento_porcentaje ? `${r.descuento_porcentaje}%` : "-"}</td>
                          <td className="py-2 px-2 text-right">${costoFinal.toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-medium">${importe.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex items-center justify-between text-xs shrink-0 text-slate-600">
                <span className="text-red-400">Devoluciones Pro: <b>$0.00</b></span>
                <span className="text-red-400">Descuento: <b>${totalDescuento.toFixed(2)}</b></span>
              </div>
              <div className="px-4 py-3 flex items-center justify-end gap-3 shrink-0 border-t border-slate-100" style={{ background: "linear-gradient(90deg, #1262b8 0%, #1a7fe8 100%)" }}>
                <span className="text-sm text-blue-100">Total:</span>
                <span className="text-2xl font-bold text-white">${totalImporte.toFixed(2)} MXN</span>
              </div>
            </div>
          </div>
        </>
        )
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Proveedor</th>
                <th className="py-2 px-3 text-left font-medium">Factura</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-center font-medium">Productos</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-10">Cargando...</td></tr>
              )}
              {!cargando && recepciones.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin recepciones registradas</td></tr>
              )}
              {recepciones.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{nombreProveedor(c.proveedor_id)}</td>
                  <td className="py-2 px-3">{c.factura || "—"}</td>
                  <td className="py-2 px-3">{nombreSucursal(c.sucursal_id)}</td>
                  <td className="py-2 px-3 text-center">{c.renglones.length}</td>
                  <td className="py-2 px-3 text-slate-500">{new Date(c.fecha).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modal === "buscar" && (
        <Modal titulo="Buscar producto (F2)" onCerrar={() => setModal(null)} ancho="max-w-3xl">
          <input
            autoFocus value={busquedaTexto}
            onChange={(e) => { setBusquedaTexto(e.target.value); setPaginaBusqueda(1); }}
            placeholder="Clave, descripción o código de barras..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
            <select value={filtroDepartamento} onChange={(e) => { setFiltroDepartamento(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los departamentos</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-center font-medium w-20">Exist.</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Costo</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => abrirArticuloParaProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-600">{p.existencia}</td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.costo || 0).toFixed(2)}</td>
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

      {modal === "articulo" && productoParaArticulo && (
        <ArticuloCompra
          producto={productoParaArticulo.producto}
          renglonExistente={productoParaArticulo.existente}
          onCancelar={() => { setModal(null); setProductoParaArticulo(null); }}
          onAceptar={aceptarArticulo}
        />
      )}

      {modal === "cantidad" && filaSeleccionada !== null && (
        <Modal titulo="Cambiar cantidad (F5)" onCerrar={() => setModal(null)}>
          <input
            autoFocus type="number" value={valorTemporal} onChange={(e) => setValorTemporal(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-lg text-right mb-4 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              const producto_id = renglones[filaSeleccionada].producto_id;
              const nueva = Number(valorTemporal) || 1;
              setRenglones((prev) => prev.map((r) => r.producto_id === producto_id ? { ...r, cantidad: Math.max(1, nueva) } : r));
              setModal(null);
            }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium"
          >Aplicar</button>
        </Modal>
      )}

      {modal === "descuento" && filaSeleccionada !== null && (
        <Modal titulo="Cambiar descuento % (F7)" onCerrar={() => setModal(null)}>
          <div className="flex items-center gap-2 mb-4">
            <input autoFocus type="number" value={valorTemporal} onChange={(e) => setValorTemporal(e.target.value)} className="flex-1 border border-slate-300 rounded px-3 py-2 text-lg text-right focus:outline-none focus:border-blue-500" />
            <span className="text-lg text-slate-500">%</span>
          </div>
          <button
            onClick={() => {
              const producto_id = renglones[filaSeleccionada].producto_id;
              const nuevo = Math.min(100, Math.max(0, Number(valorTemporal) || 0));
              setRenglones((prev) => prev.map((r) => r.producto_id === producto_id ? { ...r, descuento_porcentaje: nuevo } : r));
              setModal(null);
            }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium"
          >Aplicar</button>
        </Modal>
      )}

      {modal === "espera" && (
        <Modal titulo="Recepciones en espera (Alt+R)" onCerrar={() => setModal(null)}>
          {enEspera.length === 0 && <p className="text-slate-400 text-center py-8">No hay recepciones en espera</p>}
          <div className="divide-y divide-slate-100">
            {enEspera.map((item) => (
              <button key={item.id} onClick={() => recuperarEspera(item)} className="w-full text-left py-2.5 px-2 hover:bg-slate-50 flex justify-between items-center">
                <div>
                  <div className="font-medium">{nombreProveedor(item.proveedorId) || "Sin proveedor"} — {item.factura || "s/factura"}</div>
                  <div className="text-xs text-slate-400">{item.renglones.length} productos</div>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {modal === "importarXml" && (
        <Modal titulo="Importar factura XML (F8)" onCerrar={() => { setModal(null); setXmlParseado(null); }} ancho="max-w-3xl">
          {!xmlParseado ? (
            <div className="text-center py-10">
              <input
                type="file" accept=".xml"
                onChange={(e) => e.target.files[0] && leerArchivoXml(e.target.files[0])}
                className="mb-3"
              />
              {cargandoXml && <p className="text-slate-400 text-sm">Leyendo factura...</p>}
              <p className="text-xs text-slate-400 mt-2">Selecciona el archivo XML (CFDI 4.0) que te mandó tu proveedor.</p>
            </div>
          ) : (
            <div>
              <div className="bg-slate-50 rounded p-3 mb-3 text-sm">
                <div><b>Proveedor (RFC):</b> {xmlParseado.emisor.rfc} — {xmlParseado.emisor.nombre}</div>
                {!proveedores.some((p) => p.rfc === xmlParseado.emisor.rfc) && (
                  <button onClick={async () => {
                    const r = await apiFetch(`/proveedores`, { method: "POST", body: JSON.stringify({ nombre: xmlParseado.emisor.nombre, rfc: xmlParseado.emisor.rfc }) });
                    const nuevo = await r.json();
                    setProveedores((prev) => [...prev, nuevo]);
                    setProveedorId(nuevo.id);
                  }} className="text-xs text-blue-700 hover:underline mt-1">
                    + Dar de alta este proveedor
                  </button>
                )}
              </div>
              <table className="w-full text-sm border border-slate-200 rounded overflow-hidden mb-3">
                <thead className="bg-[#1a7fe8] text-white">
                  <tr>
                    <th className="py-2 px-2 text-left font-medium">Descripción (factura)</th>
                    <th className="py-2 px-2 text-center font-medium w-16">Cant.</th>
                    <th className="py-2 px-2 text-right font-medium w-24">Costo</th>
                    <th className="py-2 px-2 text-left font-medium">Producto en tu catálogo</th>
                  </tr>
                </thead>
                <tbody>
                  {xmlParseado.conceptos.map((c, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-2 px-2">{c.descripcion}<div className="text-[10px] text-slate-400">Clave SAT: {c.clave_sat}</div></td>
                      <td className="py-2 px-2 text-center">{c.cantidad}</td>
                      <td className="py-2 px-2 text-right">${c.valor_unitario.toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <select
                          className={inputCls}
                          value={matchesXml[idx] ?? ""}
                          onChange={(e) => setMatchesXml((prev) => ({ ...prev, [idx]: e.target.value ? Number(e.target.value) : null }))}
                        >
                          <option value="">Sin vincular — se ignora</option>
                          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2">
                <button onClick={() => { setXmlParseado(null); setMatchesXml({}); }} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={confirmarImportacionXml} className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Agregar a la recepción</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
