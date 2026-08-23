import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, DollarSign, Ban } from "lucide-react";
import { apiFetch, sinSucursalElegida } from "./api";
import { pedirLista } from "./cargaSegura";
import ModalConfirmar from "./ModalConfirmar";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

/**
 * Sufijo "?sucursal_id=" con la sucursal del PROPIO registro. Si el registro
 * no trae el campo devuelve "" y queda el comportamiento por omisión de
 * apiFetch (la sucursal del encabezado): nunca se manda "undefined" en la URL,
 * que alcanceSucursal leería como NaN y degradaría a "todas", ensanchando el
 * alcance en silencio para quien tiene ver_todas_las_sucursales.
 * Mismo patrón que qSucursalCliente en src/CRM.jsx.
 */
const qSucursal = (registro) => (registro && registro.sucursal_id != null ? `?sucursal_id=${registro.sucursal_id}` : "");

export default function ModalApartados({ onCerrar, carrito, cliente, vendedor, condicionesPago, permisos, onApartadoCreado }) {
  // Confirmacion dentro de la app: { titulo, mensaje, textoConfirmar, peligro, alConfirmar }
  const [confirmacion, setConfirmacion] = useState(null);

  const puede = (clave) => !permisos || permisos.includes(clave);
  // Con el encabezado en "Todas" no se puede apartar: el apartado reserva
  // producto de UNA tienda y el sistema no sabría de cuál descontarlo.
  // La lista de abajo sí se puede consultar (es solo lectura).
  const sinSucursal = sinSucursalElegida();
  const [tab, setTab] = useState("nuevo");
  const [apartados, setApartados] = useState([]);
  const [errorApartados, setErrorApartados] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const [anticipoMonto, setAnticipoMonto] = useState("");
  const [anticipoForma, setAnticipoForma] = useState("EFECTIVO");
  const [guardando, setGuardando] = useState(false);
  const [abonando, setAbonando] = useState(false);

  const [abonoActivoId, setAbonoActivoId] = useState(null);
  const [abonoMonto, setAbonoMonto] = useState("");
  const [abonoForma, setAbonoForma] = useState("EFECTIVO");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const total = carrito.reduce((acc, f) => acc + f.cantidad * f.precioUnitario * (1 - (f.descuentoPct || 0) / 100), 0);
  const formasPago = condicionesPago.filter((c) => c.nombre !== "CRÉDITO");

  // Un apartado es mercancía ya separada y dinero ya cobrado a medias. Si la
  // lista no carga y se queda vacía, la pantalla dice "No hay apartados" y la
  // cajera le contesta al cliente que no tiene nada apartado — con su anticipo
  // ya pagado.
  const cargarApartados = useCallback(async () => {
    setCargando(true);
    try {
      const { datos, error } = await pedirLista(() => apiFetch("/apartados"), "los apartados");
      setApartados(datos);
      setErrorApartados(error);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { if (tab === "lista") cargarApartados(); }, [tab, cargarApartados]);

  const crearApartado = async () => {
    if (sinSucursal) return mostrarAviso("Elige una sucursal en el encabezado para poder apartar");
    if (carrito.length === 0) return mostrarAviso("El ticket está vacío");
    if (cliente.id === 0) return mostrarAviso("Selecciona un cliente real (botón Cliente) antes de apartar");
    const monto = Number(anticipoMonto);
    if (!monto || monto <= 0) return mostrarAviso("Captura un anticipo mayor a $0");
    if (monto > total) return mostrarAviso("El anticipo no puede ser mayor al total");

    setGuardando(true);
    try {
      const r = await apiFetch("/apartados", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: cliente.id,
          vendedor_id: vendedor?.id,
          anticipo_monto: monto,
          anticipo_forma_pago: anticipoForma,
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
      if (!r.ok) throw new Error(data.error || "No se pudo crear el apartado");
      mostrarAviso(`Apartado creado — Folio ${data.id}`);
      setAnticipoMonto("");
      onApartadoCreado();
      setTab("lista");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setGuardando(false);
    }
  };

  const abrirAbono = (apartado) => {
    setAbonoActivoId(apartado.id);
    setAbonoMonto("");
    setAbonoForma("EFECTIVO");
  };

  /**
   * Candado contra el doble clic. En `useRef` y no en `useState` porque React
   * agrupa las actualizaciones de estado: dos clics simultáneos leerían ambos
   * `false` y la operación saldría dos veces. El ref cambia de inmediato.
   * El estado de al lado solo apaga el botón y lo dice en pantalla.
   */
  const abonoEnCurso = useRef(false);

  const confirmarAbono = async (apartado) => {
    const monto = Number(abonoMonto);
    if (!monto || monto <= 0) return mostrarAviso("Captura un monto mayor a $0");
    // Un abono duplicado acredita al cliente el doble de lo que pagó, y el
    // corte del turno espera en el cajón un dinero que nunca entró.
    if (abonoEnCurso.current) return;
    abonoEnCurso.current = true;
    setAbonando(true);
    try {
      // sucursal_id explícito (el del propio apartado): si se omite, apiFetch
      // inyecta la sucursal_activa del encabezado global (ver src/api.js) y el
      // guard de alcance responde "Apartado no encontrado" en cuanto la lista
      // deje de coincidir con ese selector. No amplía el alcance de nadie: sin
      // ver_todas_las_sucursales el backend ignora el parámetro y usa la
      // sucursal del token.
      const r = await apiFetch(`/apartados/${apartado.id}/abonos${qSucursal(apartado)}`, {
        method: "POST",
        body: JSON.stringify({ monto, forma_pago: abonoForma }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo registrar el abono");
      mostrarAviso(data.estatus === "cerrada" ? "Abono registrado — apartado liquidado ✅" : "Abono registrado");
      setAbonoActivoId(null);
      cargarApartados();
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      abonoEnCurso.current = false;
      setAbonando(false);
    }
  };

  const cancelar = (apartado) => setConfirmacion({
    titulo: `Cancelar apartado #${apartado.id}`,
    mensaje: "El producto regresa a existencia y lo ya pagado se abona al monedero del cliente.",
    textoConfirmar: "Sí, cancelar el apartado",
    textoCancelar: "No, dejarlo",
    peligro: true,
    alConfirmar: () => cancelarConfirmado(apartado),
  });

  const cancelarConfirmado = async (apartado) => {
    try {
      // Mismo motivo que en confirmarAbono: sucursal_id del propio apartado
      // para que el guard no lo dé por inexistente.
      const r = await apiFetch(`/apartados/${apartado.id}/cancelar${qSucursal(apartado)}`, {
        method: "PUT",
        body: JSON.stringify({ motivo: "Cancelado desde el POS" }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      mostrarAviso("Apartado cancelado");
      cargarApartados();
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-panel-in">
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm text-slate-700">Apartados</h3>
          <button type="button" onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-slate-200 flex shrink-0">
          <button type="button" onClick={() => setTab("nuevo")} className={`px-4 py-2 text-sm border-b-2 ${tab === "nuevo" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>Nuevo Apartado</button>
          <button type="button" onClick={() => setTab("lista")} className={`px-4 py-2 text-sm border-b-2 ${tab === "lista" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>Lista de Apartados</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "nuevo" ? (
            <div className="flex flex-col gap-3 max-w-md">
              <div className="text-sm text-slate-600">
                <p><b>Cliente:</b> {cliente.nombre}</p>
                <p><b>Productos en el carrito:</b> {carrito.length}</p>
                <p><b>Total:</b> ${total.toFixed(2)}</p>
              </div>
              {sinSucursal && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2">
                  Estás viendo <b>todas las sucursales</b>. Elige una sucursal arriba, en el selector del
                  encabezado, para poder apartar: el producto se reserva de la existencia de una tienda.
                </p>
              )}
              {cliente.id === 0 && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  Selecciona un cliente real (botón "Cliente" en el POS) antes de apartar — no puede ser Público en General.
                </p>
              )}
              {carrito.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  El ticket está vacío — agrega productos antes de apartar.
                </p>
              )}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Anticipo</label>
                <input type="number" min="0" step="0.01" value={anticipoMonto} onChange={(e) => setAnticipoMonto(e.target.value)} className={inputCls} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Forma de pago del anticipo</label>
                <select value={anticipoForma} onChange={(e) => setAnticipoForma(e.target.value)} className={inputCls}>
                  {formasPago.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select>
              </div>
              <p className="text-xs text-slate-500">El límite para liquidar es de 60 días. Si no se completa, el producto regresa a existencia y lo ya pagado se abona al monedero del cliente.</p>
              <button
                type="button"
                onClick={crearApartado}
                disabled={guardando || sinSucursal || cliente.id === 0 || carrito.length === 0}
                className="bg-[#1a7fe8] hover:bg-[#1262b8] disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded font-semibold"
              >
                {guardando ? "Guardando..." : "Crear Apartado"}
              </button>
            </div>
          ) : cargando ? (
            <p className="text-center text-slate-400 py-16">Consultando...</p>
          ) : apartados.length === 0 ? (
            errorApartados ? (
              <p className="text-center text-red-700 py-16 px-4">
                ⚠ {errorApartados}<br />
                <b>No le digas al cliente que no tiene nada apartado sin volver a intentar.</b>
              </p>
            ) : (
              <p className="text-center text-slate-400 py-16">No hay apartados vigentes</p>
            )
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Folio</th>
                  <th className="py-2 px-3 text-left font-medium">Cliente</th>
                  <th className="py-2 px-3 text-right font-medium">Total</th>
                  <th className="py-2 px-3 text-right font-medium">Saldo</th>
                  <th className="py-2 px-3 text-center font-medium">Días Restantes</th>
                  {puede("gestionar_apartados") && <th className="py-2 px-3 text-center font-medium">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {apartados.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 px-3 font-medium">{a.id}</td>
                      <td className="py-2 px-3">{a.cliente_nombre}</td>
                      <td className="py-2 px-3 text-right">${Number(a.total).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-medium">${Number(a.saldo_pendiente).toFixed(2)}</td>
                      <td className={`py-2 px-3 text-center ${a.dias_restantes <= 7 ? "text-amber-600 font-semibold" : ""}`}>{a.dias_restantes}</td>
                      {puede("gestionar_apartados") && (
                        <td className="py-2 px-3 text-center">
                          <div className="flex gap-1 justify-center">
                            <button type="button" onClick={() => abrirAbono(a)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Abonar"><DollarSign size={16} /></button>
                            <button type="button" onClick={() => cancelar(a)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Cancelar"><Ban size={16} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {abonoActivoId === a.id && (
                      <tr className="bg-blue-50">
                        <td colSpan={6} className="p-3">
                          <div className="flex gap-2 items-end flex-wrap">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Monto del abono</label>
                              <input type="number" min="0" max={a.saldo_pendiente} step="0.01" value={abonoMonto} onChange={(e) => setAbonoMonto(e.target.value)} className={inputCls + " w-32"} />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Forma de pago</label>
                              <select value={abonoForma} onChange={(e) => setAbonoForma(e.target.value)} className={inputCls}>
                                {formasPago.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                              </select>
                            </div>
                            <button type="button" onClick={() => confirmarAbono(a)} disabled={abonando} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">{abonando ? "Registrando…" : "Confirmar"}</button>
                            <button type="button" onClick={() => setAbonoActivoId(null)} className="text-slate-500 text-sm px-2">Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {aviso && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
        )}
      </div>
      {confirmacion && (
        <ModalConfirmar
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoConfirmar={confirmacion.textoConfirmar}
          peligro={confirmacion.peligro}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => {
            const accion = confirmacion.alConfirmar;
            setConfirmacion(null);
            accion();
          }}
        />
      )}
    </div>
  );
}
