/**
 * cajas.js — Las dos cajas fijas de cada sucursal del Punto de Venta.
 *
 * No es un catálogo administrable: al arrancar se garantiza una caja
 * Administrativa y una Fiscal por sucursal. La marca `predeterminada` es
 * explícita porque también decide quién absorbe los registros históricos
 * que todavía no tienen caja_id.
 */

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function normalizarCajas(DB) {
  if (!Array.isArray(DB.pos.cajas)) DB.pos.cajas = [];
  return DB.pos.cajas;
}

function cajasDeSucursal(DB, sucursalId) {
  return normalizarCajas(DB).filter((c) => c.sucursal_id === Number(sucursalId));
}

/**
 * La ÚNICA definición de "esta sucursal tiene sus cajas en orden".
 *
 * Se consulta desde dos lugares que reaccionan distinto — el arranque grita, la
 * venta sigue de largo— pero la regla es una sola. Estaba escrita dos veces con
 * las mismas cuatro condiciones copiadas, y ese es el defecto que ya mordió dos
 * veces en este repo: dos definiciones de lo mismo que se separan con el
 * tiempo, y acaban discrepando sobre qué es una sucursal sana.
 */
function estadoDeCajas(DB, sucursalId) {
  const cajas = cajasDeSucursal(DB, sucursalId);
  const administrativas = cajas.filter((c) => c.nombre === "Administrativa");
  const fiscales = cajas.filter((c) => c.nombre === "Fiscal");
  const predeterminadas = cajas.filter((c) => c.predeterminada === true);

  if (cajas.length !== 2 || administrativas.length !== 1 || fiscales.length !== 1) {
    return { ok: false, motivo: "debe tener exactamente las cajas Administrativa y Fiscal" };
  }
  if (predeterminadas.length !== 1) {
    return {
      ok: false,
      motivo: `debe tener exactamente una caja predeterminada; tiene ${predeterminadas.length}`,
    };
  }
  return { ok: true, predeterminada: predeterminadas[0] };
}

/** El arranque grita: un catálogo torcido se arregla ahora, no en la caja. */
function validarPredeterminadaDeSucursal(DB, sucursalId) {
  const estado = estadoDeCajas(DB, sucursalId);
  if (estado.ok) return estado.predeterminada;
  const sucursal = (DB.pos?.sucursales || []).find((s) => s.id === Number(sucursalId));
  throw new Error(`La sucursal ${sucursal?.nombre || sucursalId} ${estado.motivo}`);
}

/** Completa las dos cajas que falten y valida la predeterminada. */
function sembrarCajas(DB) {
  const cajas = normalizarCajas(DB);
  for (const sucursal of DB.pos?.sucursales || []) {
    const existentes = cajasDeSucursal(DB, sucursal.id);
    if (!existentes.some((c) => c.nombre === "Administrativa")) {
      cajas.push({
        id: siguienteId(cajas),
        nombre: "Administrativa",
        sucursal_id: sucursal.id,
        predeterminada: true,
      });
    }
    if (!existentes.some((c) => c.nombre === "Fiscal")) {
      cajas.push({
        id: siguienteId(cajas),
        nombre: "Fiscal",
        sucursal_id: sucursal.id,
        predeterminada: false,
      });
    }
    validarPredeterminadaDeSucursal(DB, sucursal.id);
  }
  return cajas;
}

/**
 * La venta sigue de largo: devuelve null en vez de lanzar.
 *
 * Un catálogo ausente o torcido NO puede impedir cobrarle a un cliente que está
 * enfrente con el dinero en la mano. La venta se guarda con `caja_id: null`, que
 * es exactamente el caso de las ventas históricas, y el corte de la
 * Administrativa las absorbe: no se pierde un peso, solo se pierde saber de qué
 * mostrador salió.
 */
function cajaPredeterminadaDeSucursal(DB, sucursalId) {
  const estado = estadoDeCajas(DB, sucursalId);
  return estado.ok ? estado.predeterminada : null;
}

function resolverCajaDeSucursal(DB, sucursalId, cajaId) {
  if (cajaId === undefined || cajaId === null || cajaId === "") {
    return cajaPredeterminadaDeSucursal(DB, sucursalId);
  }
  const caja = normalizarCajas(DB).find((c) => c.id === Number(cajaId));
  if (!caja) throw new Error("La caja indicada no existe");
  if (caja.sucursal_id !== Number(sucursalId)) {
    throw new Error("La caja indicada no pertenece a la sucursal de la sesión");
  }
  return caja;
}

/**
 * La UNICA regla de "este movimiento pertenece a esta caja".
 *
 * La usan las ventas, los abonos de apartados, los gastos y los cortes. Vive
 * aqui y no en el modulo que la necesito primero: es una regla de cajas, y
 * buscarla en otro lado es como se acaban teniendo dos.
 *
 * Un registro sin caja pertenece a la predeterminada — es la que absorbe todo
 * lo anterior a que existieran las cajas, para que nada quede huerfano. Y sin
 * catalogo (`caja` en null) pertenece todo: donde el concepto de caja no
 * existe, no puede filtrar nada.
 */
function esDeEstaCaja(registro, caja) {
  return !caja || registro.caja_id === caja.id || (caja.predeterminada && registro.caja_id == null);
}

module.exports = {
  esDeEstaCaja,
  sembrarCajas,
  cajaPredeterminadaDeSucursal,
  resolverCajaDeSucursal,
};
