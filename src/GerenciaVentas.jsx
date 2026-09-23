import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "./api";
import CapturaVendedor from "./objetivos/CapturaVendedor";
import ActividadesVendedor from "./objetivos/ActividadesVendedor";
import RepartoGerente from "./objetivos/RepartoGerente";
import ActividadesGerente from "./objetivos/ActividadesGerente";
import { Campo, HistorialMetas, Modal } from "./objetivos/DialogosObjetivos";
import { cuentaMalLigada, finDelMes, hoyLocal, leer, mesActual } from "./objetivos/datos";

export default function GerenciaVentas({ permisos = [], usuario }) {
  const esJefatura = permisos.includes("editar_objetivos_venta");
  const veTodas = permisos.includes("ver_todas_las_sucursales") || usuario?.ver_todas;
  const [mes, setMes] = useState(mesActual());
  const [sucursalId, setSucursalId] = useState(veTodas ? "" : String(usuario?.sucursal_id || ""));
  const [sucursales, setSucursales] = useState([]);
  const [misTiendas, setMisTiendas] = useState([]);
  const [miVendedorId, setMiVendedorId] = useState(null);
  const [identificado, setIdentificado] = useState(false);
  const [equipo, setEquipo] = useState([]);
  const [objetivos, setObjetivos] = useState(null);
  const [capturas, setCapturas] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [errorInicial, setErrorInicial] = useState("");
  const [exito, setExito] = useState("");
  const [fecha, setFecha] = useState(hoyLocal());
  const [monto, setMonto] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [editando, setEditando] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [sugerencia, setSugerencia] = useState(null);
  const [baja, setBaja] = useState(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([
      apiFetch("/gerente-ventas/mi/vendedor").then((r) => leer(r, "No se pudo identificar tu vendedor")),
      esJefatura ? apiFetch("/vendedores").then((r) => leer(r, "No se pudo cargar el equipo")) : Promise.resolve([]),
      veTodas ? apiFetch("/sucursales").then((r) => leer(r, "No se pudieron cargar las sucursales")) : Promise.resolve([]),
    ]).then(([mio, lista, tiendas]) => {
      if (!vigente) return;
      setMiVendedorId(mio.vendedor_id);
      setEquipo(lista);
      setSucursales(tiendas);
      setIdentificado(true);
      if (veTodas && tiendas.length) setSucursalId((actual) => actual || String(tiendas[0].id));
    }).catch((e) => {
      if (!vigente) return;
      setErrorInicial(e.message);
      setCargando(false);
    });
    return () => { vigente = false; };
  }, [esJefatura, veTodas]);

  useEffect(() => {
    if (!identificado || miVendedorId == null || !mes) {
      setMisTiendas([]);
      return;
    }
    let vigente = true;
    apiFetch(`/objetivos/mis-tiendas/${mes}`)
      .then((r) => leer(r, "No se pudieron cargar tus tiendas del mes"))
      .then((tiendas) => {
        if (!vigente) return;
        setMisTiendas(tiendas);
        if (new Set(tiendas.map((t) => Number(t.sucursal_id))).size > 1) {
          const predeterminada = tiendas.find((t) => Number(t.sucursal_id) === Number(usuario?.sucursal_id)) || tiendas[0];
          setSucursalId(String(predeterminada.sucursal_id));
        }
      })
      .catch((e) => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [identificado, miVendedorId, mes, usuario?.sucursal_id]);

  const cargar = useCallback(async ({ silenciosa = false } = {}) => {
    if (!identificado || !sucursalId || !mes || (!esJefatura && miVendedorId == null)) {
      setCargando(false);
      setObjetivos(null);
      setCapturas(null);
      return;
    }
    setError("");
    if (!silenciosa) {
      setCargando(true);
      setHistorial(null);
      setSugerencia(null);
      setEditando(null);
      setCorrigiendo(null);
    }
    try {
      const estado = await apiFetch(`/objetivos/${mes}/${sucursalId}`)
        .then((r) => leer(r, "No se pudieron cargar los objetivos"));
      setObjetivos(estado);
      if (miVendedorId != null) {
        try {
          setCapturas(await apiFetch(`/objetivos/${mes}/${sucursalId}/capturas/${miVendedorId}`)
            .then((r) => leer(r, "No se pudieron cargar tus capturas")));
        } catch (e) {
          setCapturas(null);
          setError(e.status === 404 ? `${cuentaMalLigada} (${e.message})` : e.message);
        }
      } else {
        setCapturas(null);
      }
    } catch (e) {
      setError(e.status === 404 && miVendedorId != null ? `${cuentaMalLigada} (${e.message})` : e.message);
      if (!silenciosa) {
        setObjetivos(null);
        setCapturas(null);
      }
    } finally {
      if (!silenciosa) setCargando(false);
    }
  }, [mes, sucursalId, miVendedorId, identificado, esJefatura]);
  useEffect(() => { cargar(); }, [cargar]);

  const ejecutar = async (accion, mensaje, opcionesRecarga) => {
    setError("");
    setExito("");
    try {
      await accion();
      setExito(mensaje);
      await cargar(opcionesRecarga);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const capturar = (valor) => ejecutar(async () => {
    if (!objetivos || objetivos.cerrado) throw new Error("Este mes no está disponible para capturar.");
    if (!fecha || fecha.slice(0, 7) !== mes || fecha > hoyLocal()) {
      throw new Error("Elige una fecha del mes seleccionado que no sea futura.");
    }
    await apiFetch("/objetivos/captura", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta", mes, fecha, sucursal_id: Number(sucursalId), vendedor_id: miVendedorId, monto: Number(valor),
      }),
    }).then((r) => leer(r, "No se pudo guardar la captura"));
    setMonto("");
    // Misma regla que al cambiar de mes: hoy solo si el mes elegido es el actual.
    setFecha(mes === mesActual() ? hoyLocal() : `${mes}-01`);
  }, Number(valor) === 0 ? `Se registró que no vendiste nada el ${fecha}.` : `Venta del ${fecha} registrada.`);

  const corregir = () => ejecutar(async () => {
    // El motivo explica el cambio y queda junto a la nueva versión de la captura.
    await apiFetch(`/objetivos/captura/${corrigiendo.id}/corregir`, {
      method: "POST",
      body: JSON.stringify({ monto: Number(corrigiendo.monto), motivo: corrigiendo.motivo }),
    }).then((r) => leer(r, "No se pudo corregir la captura"));
    setCorrigiendo(null);
  }, "Captura corregida; la versión anterior quedó en el historial.");

  const agregar = (vendedorId, desde) => ejecutar(async () => {
    await apiFetch("/objetivos/plantilla", {
      method: "POST",
      body: JSON.stringify({
        mes, sucursal_id: Number(sucursalId), vendedor_id: Number(vendedorId), desde: desde || undefined,
      }),
    }).then((r) => leer(r, "No se pudo agregar a la plantilla"));
  }, "Persona agregada a la plantilla del mes.");

  const darDeBaja = () => ejecutar(async () => {
    await apiFetch(`/objetivos/plantilla/${baja.id}/baja`, {
      method: "POST",
      body: JSON.stringify({ hasta: baja.hasta, motivo: baja.motivo }),
    }).then((r) => leer(r, "No se pudo dar de baja a la persona"));
    setBaja(null);
  }, "La baja quedó registrada en la plantilla del mes.");

  const guardarMeta = () => ejecutar(async () => {
    await apiFetch("/objetivos", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta", mes, sucursal_id: Number(sucursalId), vendedor_id: editando.vendedor_id,
        monto: Number(editando.monto), motivo: editando.existente ? editando.motivo : undefined,
      }),
    }).then((r) => leer(r, "No se pudo guardar la meta"));
    if (editando.vendedor_id == null) setSugerencia(null);
    setEditando(null);
  }, "Meta guardada.", { silenciosa: true });

  const leerHistorial = (id) => apiFetch(`/objetivos/${mes}/${sucursalId}/historial/${id == null ? "tienda" : id}`)
    .then((r) => leer(r, "No se pudo cargar el historial"));

  const editarMeta = async (id, valor) => {
    setError("");
    try {
      // Una meta existente puede valer cero; el monto no indica si hay una versión anterior.
      const versiones = await leerHistorial(id);
      setEditando({ vendedor_id: id, monto: valor, motivo: "", existente: versiones.length > 0 });
    } catch (e) {
      setError(e.message);
    }
  };

  const abrirHistorial = async (id) => {
    setError("");
    try {
      setHistorial({ vendedor_id: id, datos: await leerHistorial(id) });
    } catch (e) {
      setError(e.message);
    }
  };

  const pedirSugerencia = async () => {
    setError("");
    try {
      setSugerencia(await apiFetch(`/objetivos/${mes}/${sucursalId}/sugerencia`)
        .then((r) => leer(r, "No se pudo calcular el reparto sugerido")));
    } catch (e) {
      setError(e.message);
    }
  };

  const nombres = new Map(equipo.map((v) => [Number(v.id), v.nombre]));
  const nombre = (id) => nombres.get(Number(id)) || `Vendedor #${id}`;
  const tiendasDisponibles = [...misTiendas.reduce((porSucursal, tienda) => {
    const id = Number(tienda.sucursal_id);
    const existente = porSucursal.get(id) || { ...tienda, periodos: [] };
    existente.periodos.push(`${tienda.desde} a ${tienda.hasta || "fin de mes"}`);
    porSucursal.set(id, existente);
    return porSucursal;
  }, new Map()).values()];

  return (
    <div className="p-4 space-y-4 overflow-y-auto min-w-0 max-w-full">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm text-slate-600">
          Mes
          <input type="month" value={mes} onChange={(e) => {
            const elegido = e.target.value;
            setMes(elegido);
            setFecha(elegido === mesActual() ? hoyLocal() : `${elegido}-01`);
            setMonto("");
          }} className="block neu-campo rounded-lg px-3 py-2 mt-1" />
        </label>
        {veTodas && (
          <label className="text-sm text-slate-600">
            Sucursal
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
              className="block neu-campo rounded-lg px-3 py-2 mt-1">
              <option value="">Selecciona una sucursal</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        )}
        {tiendasDisponibles.length > 1 && (
          <label className="text-sm text-slate-600">
            Tienda
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
              className="block neu-campo rounded-lg px-3 py-2 mt-1">
              {tiendasDisponibles.map((tienda) => (
                <option key={tienda.sucursal_id} value={tienda.sucursal_id}>
                  {tienda.sucursal_nombre} ({tienda.periodos.join(", ")})
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => cargar()} className="px-3 py-2 text-sm text-slate-600 flex gap-2 items-center">
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      {(errorInicial || error) && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">
          {errorInicial || error}
        </div>
      )}
      {exito && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">{exito}</div>}
      {identificado && miVendedorId == null && !esJefatura && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm">
          Tu cuenta no tiene un vendedor ligado. Pídele a quien administra el personal que la ligue desde Roles y Personal.
        </div>
      )}
      {objetivos?.cerrado && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm">
          Este mes está cerrado. Ya no se pueden capturar ventas ni cambiar metas.
        </div>
      )}
      {cargando ? <p className="text-sm text-slate-500">Cargando objetivos…</p> : (
        <>
          {miVendedorId != null && objetivos && capturas && (
            <CapturaVendedor mes={mes} objetivos={objetivos} capturas={capturas} vendedorId={miVendedorId}
              fecha={fecha} setFecha={setFecha} monto={monto} setMonto={setMonto} capturar={capturar} corregir={setCorrigiendo} />
          )}
          {miVendedorId != null && objetivos && capturas && (
            <ActividadesVendedor key={`${mes}/${sucursalId}/${miVendedorId}`} mes={mes} sucursalId={sucursalId}
              vendedorId={miVendedorId} objetivos={objetivos} />
          )}
          {esJefatura && objetivos && (veTodas || Number(sucursalId) === Number(usuario?.sucursal_id)) && (
            <>
              <RepartoGerente key={`${mes}/${sucursalId}`} mes={mes} sucursalId={sucursalId}
                objetivos={objetivos} equipo={equipo} nombre={nombre} agregar={agregar} editar={editarMeta}
                historial={abrirHistorial} sugerencia={sugerencia} pedirSugerencia={pedirSugerencia}
                darBaja={setBaja} />
              <ActividadesGerente key={`actividades/${mes}/${sucursalId}`} mes={mes} sucursalId={sucursalId}
                objetivos={objetivos} nombre={nombre} actualizar={cargar} />
            </>
          )}
        </>
      )}
      {corrigiendo && objetivos && !objetivos.cerrado && (
        <Modal titulo="Corregir captura" cerrar={() => setCorrigiendo(null)} guardar={corregir}
          deshabilitado={corrigiendo.monto === "" || !corrigiendo.motivo.trim()}>
          <Campo etiqueta="Monto correcto" tipo="number" valor={corrigiendo.monto}
            cambiar={(valor) => setCorrigiendo({ ...corrigiendo, monto: valor })} />
          <Campo etiqueta="Motivo obligatorio" valor={corrigiendo.motivo}
            cambiar={(motivo) => setCorrigiendo({ ...corrigiendo, motivo })} area />
        </Modal>
      )}
      {editando && objetivos && !objetivos.cerrado && (
        <Modal titulo={editando.vendedor_id == null ? "Meta de la tienda" : `Meta de ${nombre(editando.vendedor_id)}`}
          cerrar={() => setEditando(null)} guardar={guardarMeta}
          deshabilitado={editando.monto === "" || (editando.existente && !editando.motivo.trim())}>
          <Campo etiqueta="Monto" tipo="number" valor={editando.monto}
            cambiar={(valor) => setEditando({ ...editando, monto: valor })} />
          {editando.existente && (
            <Campo etiqueta="Motivo obligatorio" valor={editando.motivo}
              cambiar={(motivo) => setEditando({ ...editando, motivo })} area />
          )}
        </Modal>
      )}
      {baja && objetivos && !objetivos.cerrado && (
        <Modal titulo={`Dar de baja a ${nombre(baja.vendedor_id)}`}
          cerrar={() => setBaja(null)} guardar={darDeBaja}
          deshabilitado={!baja.hasta || !baja.motivo.trim()}>
          <Campo etiqueta="Último día en la plantilla" tipo="date" valor={baja.hasta}
            min={baja.desde} max={finDelMes(mes)}
            cambiar={(hasta) => setBaja({ ...baja, hasta })} />
          <Campo etiqueta="Motivo obligatorio" valor={baja.motivo}
            cambiar={(motivo) => setBaja({ ...baja, motivo })} area />
        </Modal>
      )}
      {historial && <HistorialMetas historial={historial} nombre={nombre} cerrar={() => setHistorial(null)} />}
    </div>
  );
}
