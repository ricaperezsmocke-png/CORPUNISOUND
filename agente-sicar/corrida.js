const { setTimeout: pausa } = require('node:timers/promises');
const { cargar, guardar, bloquear } = require('./estado');
const { cliente, venta, sobre, cabe, esHorarioHistorico, id } = require('./formato');
const { enviarPendiente } = require('./envio');
function elementos(pagina, estado) {
  const clientes = new Map(pagina.clientes.map(c => [String(c.cli_id), c]));
  return pagina.filas.map(v => {
    const c = clientes.get(String(v.cli_id));
    const detalles = pagina.detalles.filter(d => String(d.ven_id) === String(v.ven_id));
    const salida = venta(v, c, detalles, !!estado.enviadas[String(v.ven_id)]);
    return { venta: salida, cliente: salida?.estado !== 'excluida' && salida ? cliente(c) : null };
  });
}
function agregar(lote, elemento) {
  if (elemento.cliente && !lote.clientes.some(c => c.cli_id === elemento.cliente.cli_id)) lote.clientes.push(elemento.cliente);
  if (elemento.venta) lote.ventas.push(elemento.venta);
}
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
  const liberar = deps.bloqueado ? async () => {} : await bloquear(archivo);
  if (!liberar) { log('OTRA_CORRIDA_ACTIVA'); return; }
  try {
    const estado = await cargar(archivo);
    if (estado.detenido) throw new Error(estado.detenido);
    if (!config.historial?.columna_referencia) log('HISTORIAL_SIN_CONFIGURAR');
    await fuente.validar();
    function permitido(mode) {
      if (mode !== 'historico' || esHorarioHistorico(new Date(reloj()))) return true;
      log('FUERA_DE_HORARIO');
      return false;
    }
    if (estado.pendiente) {
      if (!permitido(JSON.parse(estado.pendiente.bytes).mode)) return;
      if (!await enviarPendiente(archivo, estado, config, deps)) return;
    }
    const mode = estado.fase === 'incremental' ? 'incremental' : 'historico';
    if (!permitido(mode)) return;
    async function transmitir(items, cambios, modo = mode) {
      const grupos = [];
      let lote = sobre(estado.siguiente_secuencia, modo, new Date(reloj()));
      for (const item of items) {
        const candidato = structuredClone(lote);
        agregar(candidato, item);
        if (cabe(candidato)) { lote = candidato; continue; }
        if (!lote.clientes.length && !lote.ventas.length) throw new Error('ENTIDAD_EXCEDE_LOTE');
        grupos.push(lote);
        lote = sobre(estado.siguiente_secuencia, modo, new Date(reloj()));
        agregar(lote, item);
        if (!cabe(lote)) throw new Error('ENTIDAD_EXCEDE_LOTE');
      }
      grupos.push(lote);
      for (let i = 0; i < grupos.length; i++) {
        if (!permitido(modo)) return false;
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
        if (!await transmitir(filas.map(c => ({ cliente: cliente(c) })), cambios)) return;
      }
      while (estado.fase === 'ventas' && permitido(mode)) {
        const pagina = await fuente.ventas(estado.ven_id, estado.tope, fuente.tamano);
        const cambios = pagina.filas.length ? { ven_id: id(pagina.filas.at(-1).ven_id), ventana: cache(pagina, estado) }
          : { fase: 'incremental' };
        if (!await transmitir(elementos(pagina, estado), cambios)) return;
      }
      return;
    }
    const tope = await fuente.tope();
    while (BigInt(estado.ven_id) < BigInt(tope)) {
      const pagina = await fuente.ventas(estado.ven_id, tope, fuente.tamano);
      if (!pagina.filas.length) break;
      if (!await transmitir(elementos(pagina, estado), {
        ven_id: id(pagina.filas.at(-1).ven_id), ventana: cache(pagina, estado),
      })) return;
    }
    if (config.historial?.columna_referencia) {
      while (true) {
        const movimientos = await fuente.historial(estado.his_id, fuente.tamano);
        if (!movimientos.length) break;
        const ventasIds = [...new Set(movimientos.filter(m => m.tabla === 'Venta' && String(m.movimiento) === '2').map(m => id(m.referencia)))];
        const clientesIds = [...new Set(movimientos.filter(m => m.tabla === 'Cliente'
          && ['0', '1', '2'].includes(String(m.movimiento))).map(m => id(m.referencia)))];
        const pagina = await fuente.porIds(ventasIds);
        const clientes = clientesIds.length ? await fuente.clientesIds(clientesIds) : [];
        const items = clientes.map(c => ({ cliente: cliente(c) })).concat(elementos(pagina, estado));
        if (!await transmitir(items, { his_id: id(movimientos.at(-1).his_id), ventana: cache(pagina, estado) })) return;
      }
    }
    const desde = horaLocal(reloj() - 48 * 3600000), hasta = horaLocal(reloj());
    const ids = Object.keys(estado.ventana).filter(ven => estado.ventana[ven] >= desde && estado.ventana[ven] <= hasta);
    for (let i = 0; i < ids.length;) {
      const paginaIds = ids.slice(i, i + fuente.tamano);
      const pagina = await fuente.porIds(paginaIds);
      if (!await transmitir(elementos(pagina, estado), { ventana: cache(pagina, estado) })) return;
      i += paginaIds.length;
    }
  } finally { await liberar(); }
}
module.exports = { ejecutar };
