const { setTimeout: pausa } = require('node:timers/promises');
const { cargar, guardar, bloquear } = require('./estado');
const { cliente, sobre, cabe, esHorarioHistorico, id, clienteSeguro, ventaSegura, articuloSeguro } = require('./formato');
const { enviarPendiente } = require('./envio');
const MAXIMO_LOTES_POR_CORRIDA = 300;
const MAXIMO_PAGINAS_POR_CORRIDA = 1000;
// Ventas bajo el cursor que se releen por si otra caja las confirmó tarde (ids asignados antes, guardadas después).
const MARGEN_VENTAS = 200;
function elementos(pagina, estado, avisar, omitir) {
  const clientes = new Map(pagina.clientes.map(c => [String(c.cli_id), c]));
  return pagina.filas.map(v => {
    const c = clientes.get(String(v.cli_id));
    const detalles = pagina.detalles.filter(d => String(d.ven_id) === String(v.ven_id));
    const { venta: salida, omitida } = ventaSegura(v, c, detalles, !!estado.enviadas[String(v.ven_id)], avisar);
    if (omitida) omitir('VENTA_OMITIDA', omitida);
    // Solo una venta completa trae cliente: la excluida y la cancelación sin renglones no.
    return { venta: salida, cliente: salida?.cli_id ? cliente(c) : null };
  });
}
function agregar(lote, elemento) {
  if (elemento.cliente && !lote.clientes.some(c => c.cli_id === elemento.cliente.cli_id)) lote.clientes.push(elemento.cliente);
  if (elemento.venta) lote.ventas.push(elemento.venta);
  // La colección solo aparece cuando hay artículos: un lote sin ellos queda idéntico al de antes.
  if (elemento.articulo) (lote.articulos ??= []).push(elemento.articulo);
}
const vacio = lote => !lote.clientes.length && !lote.ventas.length && !lote.articulos?.length;
function cache(pagina, estado) {
  const ventana = { ...estado.ventana };
  for (const v of pagina.filas) ventana[id(v.ven_id)] = String(v.fecha).replace(' ', 'T');
  return ventana;
}
function horaLocal(ms) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms)).replace(' ', 'T');
}
async function ejecutar(archivo, config, deps) {
  const { fuente, reloj = Date.now, esperar = pausa, log = () => {} } = deps;
  const avisar = aviso => log('CAMPO_OMITIDO', aviso);
  const omitir = (evento, datos) => log(evento, datos);
  const clientePermitido = c => {
    const { cliente: salida, omitido } = clienteSeguro(c, avisar);
    if (omitido) omitir('CLIENTE_OMITIDO', omitido);
    return salida;
  };
  const liberar = deps.bloqueado ? async () => {} : await bloquear(archivo);
  if (!liberar) { log('OTRA_CORRIDA_ACTIVA'); return; }
  try {
    const estado = await cargar(archivo);
    if (estado.detenido) throw new Error(estado.detenido);
    if (!config.historial?.columna_referencia) log('HISTORIAL_SIN_CONFIGURAR');
    await fuente.validar();
    function permitido(mode) {
      if (mode !== 'historico' || deps.historicoAhora || esHorarioHistorico(new Date(reloj()))) return true;
      log('FUERA_DE_HORARIO');
      return false;
    }
    if (estado.pendiente) {
      if (!permitido(JSON.parse(estado.pendiente.bytes).mode)) return;
      if (!await enviarPendiente(archivo, estado, config, deps)) return;
    }
    const mode = estado.fase === 'incremental' ? 'incremental' : 'historico';
    if (!permitido(mode)) return;
    let enviados = 0, paginas = 0;
    async function transmitir(items, cambios, modo = mode) {
      if (++paginas > MAXIMO_PAGINAS_POR_CORRIDA) { log('TOPE_DE_CORRIDA'); return false; }
      // Nada que mandar (página de puro público, historial sin cancelaciones, fin de fase): avanza sin gastar envío.
      const prueba = sobre(estado.siguiente_secuencia, modo, new Date(reloj()));
      for (const item of items) agregar(prueba, item);
      if (vacio(prueba)) {
        Object.assign(estado, cambios);
        await guardar(archivo, estado);
        await esperar(200);
        return true;
      }
      const grupos = [];
      let lote = sobre(estado.siguiente_secuencia, modo, new Date(reloj()));
      for (const item of items) {
        const candidato = structuredClone(lote);
        agregar(candidato, item);
        if (cabe(candidato)) { lote = candidato; continue; }
        if (vacio(lote)) throw new Error('ENTIDAD_EXCEDE_LOTE');
        grupos.push(lote);
        lote = sobre(estado.siguiente_secuencia, modo, new Date(reloj()));
        agregar(lote, item);
        if (!cabe(lote)) throw new Error('ENTIDAD_EXCEDE_LOTE');
      }
      grupos.push(lote);
      for (let i = 0; i < grupos.length; i++) {
        if (!permitido(modo)) return false;
        // Tope por corrida: ninguna corrida legítima se acerca a las 6 horas en que su candado se daría por abandonado.
        if (enviados >= MAXIMO_LOTES_POR_CORRIDA) { log('TOPE_DE_CORRIDA'); return false; }
        enviados++;
        const actual = grupos[i];
        actual.sequence = estado.siguiente_secuencia;
        const enviadas = { ...estado.enviadas };
        for (const v of actual.ventas) enviadas[v.ven_id] = true;
        estado.pendiente = { bytes: JSON.stringify(actual),
          cambios: { enviadas, ...(i === grupos.length - 1 ? cambios : {}) } };
        await guardar(archivo, estado);
        if (!await enviarPendiente(archivo, estado, config, deps)) return false;
      }
      await esperar(1000);
      return true;
    }
    if (estado.fase !== 'incremental') {
      if (estado.tope === null) { estado.tope = await fuente.tope(); await guardar(archivo, estado); }
      while (estado.fase === 'clientes' && permitido(mode)) {
        const filas = await fuente.clientes(estado.cli_id, fuente.tamano);
        const cambios = filas.length ? { cli_id: id(filas.at(-1).cli_id) } : { fase: 'ventas' };
        if (!await transmitir(filas.map(c => ({ cliente: clientePermitido(c) })), cambios)) return;
      }
      while (estado.fase === 'ventas' && permitido(mode)) {
        const pagina = await fuente.ventas(estado.ven_id, estado.tope, fuente.tamano);
        const cambios = pagina.filas.length ? { ven_id: id(pagina.filas.at(-1).ven_id), ventana: cache(pagina, estado) }
          : { fase: 'incremental' };
        if (!await transmitir(elementos(pagina, estado, avisar, omitir), cambios)) return;
      }
      return;
    }
    const tope = await fuente.tope();
    while (BigInt(estado.ven_id) < BigInt(tope)) {
      const pagina = await fuente.ventas(estado.ven_id, tope, fuente.tamano);
      if (!pagina.filas.length) break;
      if (!await transmitir(elementos(pagina, estado, avisar, omitir), {
        ven_id: id(pagina.filas.at(-1).ven_id), ventana: cache(pagina, estado),
      })) return;
    }
    let desdeMargen = BigInt(estado.ven_id) > BigInt(MARGEN_VENTAS) ? String(BigInt(estado.ven_id) - BigInt(MARGEN_VENTAS)) : '0';
    while (BigInt(desdeMargen) < BigInt(estado.ven_id)) {
      const pagina = await fuente.ventas(desdeMargen, estado.ven_id, fuente.tamano);
      if (!pagina.filas.length) break;
      desdeMargen = id(pagina.filas.at(-1).ven_id);
      const nuevas = { ...pagina, filas: pagina.filas.filter(v => !estado.ventana[id(v.ven_id)]) };
      if (!nuevas.filas.length) continue;
      if (!await transmitir(elementos(nuevas, estado, avisar, omitir), { ventana: cache(nuevas, estado) })) return;
    }
    if (config.historial?.columna_referencia) {
      while (true) {
        const movimientos = await fuente.historial(estado.his_id, fuente.tamano);
        if (!movimientos.length) break;
        const ventasIds = [...new Set(movimientos.filter(m => m.tabla === 'Venta' && String(m.movimiento) === '2').map(m => id(m.referencia)))];
        const clientesIds = [...new Set(movimientos.filter(m => m.tabla === 'Cliente'
          && ['0', '1', '2'].includes(String(m.movimiento))).map(m => id(m.referencia)))];
        const pagina = { filas: [], clientes: [], detalles: [] };
        for (let i = 0; i < ventasIds.length; i += fuente.tamano) {
          const parte = await fuente.porIds(ventasIds.slice(i, i + fuente.tamano));
          for (const k of Object.keys(pagina)) pagina[k].push(...parte[k]);
        }
        const clientes = clientesIds.length ? await fuente.clientesIds(clientesIds) : [];
        const items = clientes.map(c => ({ cliente: clientePermitido(c) })).concat(elementos(pagina, estado, avisar, omitir));
        if (!await transmitir(items, { his_id: id(movimientos.at(-1).his_id), ventana: cache(pagina, estado) })) return;
      }
    }
    const desde = horaLocal(reloj() - 48 * 3600000), hasta = horaLocal(reloj());
    const ids = Object.keys(estado.ventana).filter(ven => estado.ventana[ven] >= desde && estado.ventana[ven] <= hasta);
    for (let i = 0; i < ids.length;) {
      const paginaIds = ids.slice(i, i + fuente.tamano);
      const pagina = await fuente.porIds(paginaIds);
      if (!await transmitir(elementos(pagina, estado, avisar, omitir), { ventana: cache(pagina, estado) })) return;
      i += paginaIds.length;
    }
    // Lista de artículos (departamento y categoría): completa una vez al día, de noche o a mano, después de las ventas.
    const hoy = horaLocal(reloj()).slice(0, 10);
    const toca = () => estado.articulos_dia !== hoy && (deps.articulosAhora || esHorarioHistorico(new Date(reloj())));
    if (!toca()) return;
    if (!fuente.articulosDisponibles) { log('ARTICULOS_NO_DISPONIBLES'); return; }
    while (toca()) {
      const filas = await fuente.articulos(estado.articulos_cursor, fuente.tamano);
      const cambios = filas.length ? { articulos_cursor: id(filas.at(-1).art_id) } : { articulos_cursor: '0', articulos_dia: hoy };
      const items = filas.map(a => {
        const { articulo, omitido } = articuloSeguro(a);
        if (omitido) omitir('ARTICULO_OMITIDO', omitido);
        return { articulo };
      });
      if (!await transmitir(items, cambios, 'incremental')) return;
    }
  } finally { await liberar(); }
}
module.exports = { ejecutar };
