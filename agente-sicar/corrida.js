const { setTimeout: pausa } = require('node:timers/promises');
const { cargar, guardar, bloquear, LIMITE_AVISOS } = require('./estado');
const { cliente, esPublico, sobre, cabe, esHorarioHistorico, id, clienteSeguro, ventaSegura, articuloSeguro,
  proveedorSeguro, existenciaSegura, corteSeguro } = require('./formato');
const { enviarPendiente } = require('./envio');
const MAXIMO_LOTES_POR_CORRIDA = 300;
const MAXIMO_PAGINAS_POR_CORRIDA = 1000;
// Ventas bajo el cursor que se releen por si otra caja las confirmó tarde (ids asignados antes, guardadas después).
const MARGEN_VENTAS = 200;
// Carga de ventas de mostrador desde 2025: a lo más estas páginas por corrida, para que la corrida termine pronto y la
// siguiente (con las ventas nuevas) no espere.
const PAGINAS_MOSTRADOR_POR_CORRIDA = 10;
const INICIO_MOSTRADOR = '2025-01-01 00:00:00';
// Con el interruptor mostrador (exactamente true) la venta de público en general sale además como fila de mostrador.
// soloPublico (carga desde 2025): las de cliente no se devuelven; las de público, con su tumba excluida si hace falta.
function elementos(pagina, estado, avisar, omitir, config = {}, soloPublico = false) {
  const clientes = new Map(pagina.clientes.map(c => [String(c.cli_id), c]));
  const conMostrador = config.mostrador === true;
  return pagina.filas.flatMap(v => {
    const c = clientes.get(String(v.cli_id));
    if (soloPublico && !esPublico(c)) return [];
    const detalles = pagina.detalles.filter(d => String(d.ven_id) === String(v.ven_id));
    const opciones = conMostrador ? { enviada: !!estado.mostrador_enviadas[String(v.ven_id)] } : undefined;
    const { venta: salida, omitida, mostrador = null } = ventaSegura(v, c, detalles, !!estado.enviadas[String(v.ven_id)], avisar, opciones);
    if (omitida) omitir('VENTA_OMITIDA', omitida);
    // Solo una venta completa trae cliente: la excluida y la cancelación sin renglones no.
    return [{ venta: salida, cliente: salida?.cli_id ? cliente(c) : null, mostrador }];
  });
}
function agregar(lote, elemento) {
  if (elemento.cliente && !lote.clientes.some(c => c.cli_id === elemento.cliente.cli_id)) lote.clientes.push(elemento.cliente);
  if (elemento.venta) lote.ventas.push(elemento.venta);
  // La colección solo aparece cuando hay artículos: un lote sin ellos queda idéntico al de antes.
  if (elemento.articulo) (lote.articulos ??= []).push(elemento.articulo);
  if (elemento.proveedor) (lote.proveedores ??= []).push(elemento.proveedor);
  // La fila nunca es null (su existencia sí puede serlo: artículo que dejó de ser vigente).
  if (elemento.existencia) (lote.existencias ??= []).push(elemento.existencia);
  if (elemento.corte) (lote.cortes ??= []).push(elemento.corte);
  // Va en el mismo lote que la tumba excluida de su venta: el servidor la acepta solo así. elementos() solo la produce
  // con el interruptor mostrador === true.
  if (elemento.mostrador) (lote.mostrador ??= []).push(elemento.mostrador);
}
// Un prv_id repetido en el lote lo rechaza el servidor (ID_DUPLICADO, 422) y eso detendría el agente entero, con clientes
// y ventas. La lista de proveedores es opcional: se conserva la primera aparición de cada id y se sigue.
function sinIdsRepetidos(filas) {
  const vistos = new Set();
  return filas.filter(p => !vistos.has(String(p.prv_id)) && vistos.add(String(p.prv_id)));
}
const vacio = lote => !lote.clientes.length && !lote.ventas.length && !lote.articulos?.length && !lote.proveedores?.length
  && !lote.existencias?.length && !lote.cortes?.length && !lote.mostrador?.length;
// Solo un lote de existencias y/o cortes se puede descartar; nunca uno que traiga clientes, ventas, artículos, proveedores
// o mostrador (la carga de mostrador mueve su cursor solo al confirmar, pero sus ventas sí cuentan).
const descartable = lote => (!!lote.existencias?.length || !!lote.cortes?.length) && !lote.clientes?.length
  && !lote.ventas?.length && !lote.articulos?.length && !lote.proveedores?.length && !lote.mostrador?.length;
const EXISTENCIAS_POR_LOTE = 500;
const CORTES_POR_LOTE = 100;
// SICAR escribe el corte, luego el renglón de historial de quién lo cerró (0-22 s) y enseguida el resumen (1 s): un
// corte leído en esos segundos puede estar a medias. Ninguno se manda antes de 2 minutos; sin quién lo cerró o sin
// resumen se espera hasta 10. Uno fechado más de 10 minutos en el futuro (reloj de SICAR adelantado) no se espera.
const ESPERA_CORTE_MS = 2 * 60000;
const ESPERA_INCOMPLETO_MS = 10 * 60000;
// Cortes bajo el cursor que se releen por si otra caja los guardó tarde (como MARGEN_VENTAS) y cuántos se recuerdan.
const MARGEN_CORTES = 50;
const FECHA_SICAR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
// enviadas y mostrador_enviadas olvidan las ventas fechadas hace más de esto que ya están fuera del margen de relectura.
const DIAS_RECUERDO_VENTAS = 90;
function cache(pagina, estado) {
  const ventana = { ...estado.ventana };
  for (const v of pagina.filas) ventana[id(v.ven_id)] = String(v.fecha).replace(' ', 'T');
  return ventana;
}
function horaLocal(ms) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms)).replace(' ', 'T');
}
// Olvida de enviadas (y de mostrador_enviadas) las ventas fechadas hace más de 90 días que ya quedaron fuera del margen de
// relectura: ninguna corrida normal las vuelve a leer y el estado.json crecería para siempre. Nunca se olvida una venta
// sin fecha válida en la ventana, ni una de las 200 bajo el cursor, ni nada mientras la carga de mostrador desde 2025
// está prendida y sin terminar (decide la tumba 'excluida' de ventas viejas). Devuelve true si quitó algo.
function podar(estado, config, ahora) {
  if (estado.fase !== 'incremental' || (config.mostrador === true && !estado.mostrador_terminado)) return false;
  const limite = horaLocal(ahora - DIAS_RECUERDO_VENTAS * 86400000);
  const piso = BigInt(estado.ven_id) - BigInt(MARGEN_VENTAS);
  const fecha = ven => estado.ventana[ven];
  const olvidable = ven => /^[1-9]\d*$/.test(ven) && BigInt(ven) <= piso && typeof fecha(ven) === 'string'
    && FECHA_SICAR.test(fecha(ven)) && fecha(ven) < limite;
  let quito = false;
  for (const mapa of ['enviadas', 'mostrador_enviadas']) {
    const quedan = Object.entries(estado[mapa]).filter(([ven]) => !olvidable(ven));
    if (quedan.length === Object.keys(estado[mapa]).length) continue;
    estado[mapa] = Object.fromEntries(quedan);
    quito = true;
  }
  return quito;
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
    // Avisos repetibles (un artículo o un corte raro, las existencias sin columnas): una vez por día por id o por evento,
    // no en cada corrida. El recuerdo vive en estado.json y se guarda con lo demás o al final de existencias y cortes.
    let vistos = null, avisosNuevos = false;
    function avisarUnaVez(evento, clave, datos) {
      const dia = horaLocal(reloj()).slice(0, 10);
      if (estado.avisos_dia !== dia) { estado.avisos_dia = dia; estado.avisos = []; vistos = null; avisosNuevos = true; }
      vistos ??= new Set(estado.avisos);
      const llave = clave ? `${evento}:${clave}` : evento;
      if (vistos.has(llave)) return;
      if (estado.avisos.length < LIMITE_AVISOS) { estado.avisos.push(llave); vistos.add(llave); avisosNuevos = true; }
      log(evento, datos);
    }
    async function guardarAvisos() {
      if (!avisosNuevos) return;
      avisosNuevos = false;
      await guardar(archivo, estado);
    }
    await fuente.validar();
    function permitido(mode) {
      if (mode !== 'historico' || deps.historicoAhora || esHorarioHistorico(new Date(reloj()))) return true;
      log('FUERA_DE_HORARIO');
      return false;
    }
    if (estado.pendiente) {
      if (!permitido(JSON.parse(estado.pendiente.bytes).mode)) return;
      if (!await enviarPendiente(archivo, estado, config, deps)) {
        // Lo más importante del agente son las ventas: un lote de SOLO existencias y/o cortes que agotó sus intentos (5xx,
        // red, 409) se descarta sin aplicar sus cambios: cortes_cursor y cortes_enviados quedan como estaban y esos cortes
        // se vuelven a leer y mandar. Si el servidor sí lo había aceptado, el siguiente lote recibe 409 SECUENCIA_INCORRECTA
        // y se renumera solo; por eso los artículos que el lote traía con valor quedan marcados con '?', que nunca coincide
        // con un valor real: si siguen vigentes se reenvía su valor y si dejaron de serlo se manda su baja (null). Las bajas
        // (null) se quedan en el mapa para recalcularse y mandarse otra vez.
        if (!estado.pendiente) return;
        const atorado = JSON.parse(estado.pendiente.bytes);
        if (!descartable(atorado)) return;
        estado.pendiente = null;
        for (const { art_id, existencia } of atorado.existencias || []) {
          if (existencia !== null) estado.existencias[art_id] = '?';
        }
        await guardar(archivo, estado);
        if (atorado.existencias?.length) log('EXISTENCIAS_DESCARTADAS');
        if (atorado.cortes?.length) log('CORTES_DESCARTADOS');
      }
    }
    const mode = estado.fase === 'incremental' ? 'incremental' : 'historico';
    if (!permitido(mode)) return;
    if (podar(estado, config, reloj())) await guardar(archivo, estado);
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
        // Las de mostrador se recuerdan aparte: enviadas decide la tumba excluida de ventas y no se mezcla.
        const mostrador = actual.mostrador?.length ? { ...estado.mostrador_enviadas } : null;
        for (const m of actual.mostrador || []) mostrador[m.ven_id] = true;
        estado.pendiente = { bytes: JSON.stringify(actual),
          cambios: { enviadas, ...(mostrador ? { mostrador_enviadas: mostrador } : {}), ...(i === grupos.length - 1 ? cambios : {}) } };
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
        if (!await transmitir(elementos(pagina, estado, avisar, omitir, config), cambios)) return;
      }
      return;
    }
    const tope = await fuente.tope();
    while (BigInt(estado.ven_id) < BigInt(tope)) {
      const pagina = await fuente.ventas(estado.ven_id, tope, fuente.tamano);
      if (!pagina.filas.length) break;
      if (!await transmitir(elementos(pagina, estado, avisar, omitir, config), {
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
      if (!await transmitir(elementos(nuevas, estado, avisar, omitir, config), { ventana: cache(nuevas, estado) })) return;
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
        const items = clientes.map(c => ({ cliente: clientePermitido(c) })).concat(elementos(pagina, estado, avisar, omitir, config));
        if (!await transmitir(items, { his_id: id(movimientos.at(-1).his_id), ventana: cache(pagina, estado) })) return;
      }
    }
    const desde = horaLocal(reloj() - 48 * 3600000), hasta = horaLocal(reloj());
    const ids = Object.keys(estado.ventana).filter(ven => estado.ventana[ven] >= desde && estado.ventana[ven] <= hasta);
    for (let i = 0; i < ids.length;) {
      const paginaIds = ids.slice(i, i + fuente.tamano);
      const pagina = await fuente.porIds(paginaIds);
      if (!await transmitir(elementos(pagina, estado, avisar, omitir, config), { ventana: cache(pagina, estado) })) return;
      i += paginaIds.length;
    }
    // Listas diarias (artículos con departamento y categoría; proveedores para el Radar): completas una vez al día, de noche
    // o a mano, después de las ventas. Cada una apagada mientras su interruptor no sea true: un servidor viejo rechaza la
    // colección y detendría las ventas.
    const hoy = horaLocal(reloj()).slice(0, 10);
    async function listaDiaria(lista, { ahora, disponible, aviso, leer, idDe, seguro, evento }) {
      if (config[lista] !== true) return true;
      // A mano (--articulos-ahora / --proveedores-ahora) se manda una vuelta completa aunque hoy ya se haya mandado:
      // sirve tras restaurar un respaldo que dejó la lista vacía. Solo, de noche, una vez al día.
      let vueltaCompleta = false;
      const toca = () => (ahora ? !vueltaCompleta : estado[`${lista}_dia`] !== hoy && esHorarioHistorico(new Date(reloj())));
      if (!toca()) return true;
      if (!disponible) { log(aviso); return true; }
      while (toca()) {
        const filas = await leer(estado[`${lista}_cursor`], 500);
        const cambios = filas.length ? { [`${lista}_cursor`]: id(idDe(filas.at(-1))) } : { [`${lista}_cursor`]: '0', [`${lista}_dia`]: hoy };
        const items = filas.map(fila => {
          const { item, omitido } = seguro(fila);
          if (omitido) omitir(evento, omitido);
          return item;
        });
        if (!await transmitir(items, cambios, 'incremental')) return false;
        if (!filas.length) vueltaCompleta = true;
      }
      return true;
    }
    if (!await listaDiaria('articulos', { ahora: deps.articulosAhora, disponible: fuente.articulosDisponibles,
      aviso: 'ARTICULOS_NO_DISPONIBLES', leer: (cursor, n) => fuente.articulos(cursor, n), idDe: a => a.art_id,
      seguro: a => { const r = articuloSeguro(a); return { item: { articulo: r.articulo }, omitido: r.omitido }; },
      evento: 'ARTICULO_OMITIDO' })) return;
    if (!await listaDiaria('proveedores', { ahora: deps.proveedoresAhora, disponible: fuente.proveedoresDisponibles,
      aviso: 'PROVEEDORES_NO_DISPONIBLES', leer: async (cursor, n) => sinIdsRepetidos(await fuente.proveedores(cursor, n)), idDe: p => p.prv_id,
      seguro: p => { const r = proveedorSeguro(p); return { item: { proveedor: r.proveedor }, omitido: r.omitido }; },
      evento: 'PROVEEDOR_OMITIDO' })) return;
    // Existencias: en cada corrida, al final. Se leen todas las vigentes y se comparan contra lo último que el servidor
    // CONFIRMÓ (estado.existencias); se mandan solo las que cambiaron y, con null, las que dejaron de ser vigentes. Una
    // vez al día (de noche, de día si la última fue antes de ayer, o a mano con --existencias-ahora) se mandan todas. Apagadas mientras el
    // interruptor no sea true: un servidor viejo rechaza la colección y detendría las ventas.
    async function mandarExistencias() {
      if (config.existencias !== true) return true;
      if (!fuente.existenciasDisponibles) { avisarUnaVez('EXISTENCIAS_NO_DISPONIBLES'); return true; }
      // De día también toca si la última vuelta completa fue antes de ayer (o nunca): tiendas que apagan la PC de noche.
      const ayer = horaLocal(reloj() - 24 * 3600000).slice(0, 10);
      const atrasada = !estado.existencias_dia || estado.existencias_dia < ayer;
      const completa = deps.existenciasAhora ? true
        : estado.existencias_dia !== hoy && (esHorarioHistorico(new Date(reloj())) || atrasada);
      const actuales = new Map();
      const omitidas = new Set();
      for (let cursor = '0'; ;) {
        const filas = await fuente.existencias(cursor, EXISTENCIAS_POR_LOTE);
        if (!filas.length) break;
        const siguiente = id(filas.at(-1).art_id);
        // El cursor solo avanza: una página que no avanza (SICAR devolviendo basura) no deja el ciclo dando vueltas.
        if (BigInt(siguiente) <= BigInt(cursor)) throw new Error('ID_INVALIDO');
        cursor = siguiente;
        for (const fila of filas) {
          const { existencia, omitido } = existenciaSegura(fila);
          if (omitido) { avisarUnaVez('EXISTENCIA_OMITIDA', omitido.art_id, omitido); omitidas.add(omitido.art_id); continue; }
          // Un art_id repetido lo rechaza el servidor (ID_DUPLICADO, 422) y detendría el agente: se queda el primero.
          if (!actuales.has(existencia.art_id)) actuales.set(existencia.art_id, existencia.existencia);
        }
      }
      const confirmadas = estado.existencias;
      const items = [...actuales].filter(([art_id, valor]) => completa || confirmadas[art_id] !== valor)
        .map(([art_id, existencia]) => ({ art_id, existencia }));
      // Una omitida (dato que no se sabe leer) no se borra: el servidor conserva lo último confirmado y, si no se vuelve a
      // confirmar, la pantalla la muestra en gris tras 36 h.
      const bajas = Object.keys(confirmadas).filter(art_id => !actuales.has(art_id) && !omitidas.has(art_id))
        .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      items.push(...bajas.map(art_id => ({ art_id, existencia: null })));
      if (!items.length && !completa) return true;
      // Un tramo = un lote: transmitir() aplica sus cambios solo cuando el servidor confirma el último grupo de la llamada,
      // así el mapa local nunca guarda algo que el servidor no recibió.
      let mapa = { ...confirmadas };
      for (let i = 0; i < items.length || (i === 0 && completa); i += EXISTENCIAS_POR_LOTE) {
        const tramo = items.slice(i, i + EXISTENCIAS_POR_LOTE);
        mapa = { ...mapa };
        for (const { art_id, existencia } of tramo) {
          if (existencia === null) delete mapa[art_id];
          else mapa[art_id] = existencia;
        }
        const ultimo = i + EXISTENCIAS_POR_LOTE >= items.length;
        const cambios = { existencias: mapa, ...(ultimo && completa ? { existencias_dia: hoy } : {}) };
        if (!await transmitir(tramo.map(existencia => ({ existencia })), cambios, 'incremental')) return false;
      }
      return true;
    }
    const existenciasListas = await mandarExistencias();
    await guardarAvisos();
    if (!existenciasListas) return;
    // Cortes de caja: en cada corrida, después de las existencias, por cor_id (nunca se editan y crecen con el tiempo).
    // cortes_cursor avanza solo cuando el servidor confirma el lote. Apagados mientras el interruptor no sea true.
    async function mandarCortes() {
      if (config.cortes !== true) return true;
      if (!fuente.cortesDisponibles) { log('CORTES_NO_DISPONIBLES'); return true; }
      const posterior = (a, b) => BigInt(a) > BigInt(b);
      // Se empieza 50 abajo del cursor: un corte de número menor guardado tarde también sale. Los ya resueltos se saltan.
      let lectura = posterior(estado.cortes_cursor, MARGEN_CORTES) ? String(BigInt(estado.cortes_cursor) - BigInt(MARGEN_CORTES)) : '0';
      while (true) {
        const pagina = await fuente.cortes(lectura, CORTES_POR_LOTE);
        if (!pagina.cortes.length) return true;
        // Horas de la tienda, en el mismo formato que la fecha de SICAR.
        const hace2 = horaLocal(reloj() - ESPERA_CORTE_MS), hace10 = horaLocal(reloj() - ESPERA_INCOMPLETO_MS);
        const futuro = horaLocal(reloj() + ESPERA_INCOMPLETO_MS);
        const resueltos = new Set(estado.cortes_enviados);
        let cursor = estado.cortes_cursor, espera = false;
        const items = [], nuevos = [];
        for (const fila of pagina.cortes) {
          const cor_id = id(fila.cor_id);
          // La lectura solo avanza: una página que no avanza (SICAR devolviendo basura) no deja el ciclo dando vueltas.
          if (!posterior(cor_id, lectura)) throw new Error('ID_INVALIDO');
          lectura = cor_id;
          if (!posterior(cor_id, estado.cortes_cursor) && resueltos.has(cor_id)) continue;
          const fecha = String(fila.fecha).replace(' ', 'T');
          const conCajero = pagina.cajeros.some(h => String(h.id) === cor_id);
          const conResumen = pagina.resumenes.some(r => String(r.cor_id) === cor_id);
          const adelantado = FECHA_SICAR.test(fecha) && fecha > futuro;
          // Recién cerrado o a medias: se espera a la siguiente corrida, junto con todos los posteriores.
          if (FECHA_SICAR.test(fecha) && !adelantado && (fecha > hace2 || ((!conCajero || !conResumen) && fecha > hace10))) {
            espera = true;
            break;
          }
          const { corte, omitido } = corteSeguro({ corte: fila, pagos: pagina.pagos, cajeros: pagina.cajeros, ventas: pagina.ventas });
          if (omitido) avisarUnaVez('CORTE_OMITIDO', cor_id, omitido);
          else {
            if (adelantado) avisarUnaVez('CORTE_FECHA_FUTURA', cor_id, { cor_id });
            if (corte.usu_id === null) avisarUnaVez('CORTE_SIN_CAJERO', cor_id, { cor_id });
            if (!conResumen) avisarUnaVez('CORTE_SIN_RESUMEN', cor_id, { cor_id });
            items.push({ corte });
          }
          // Mandado sin quién lo cerró o sin resumen: no queda resuelto, así la relectura del margen lo vuelve a mandar
          // (el servidor lo reescribe por cor_id, no lo duplica) hasta que SICAR tenga esos datos. El cursor sí lo pasa.
          if (omitido || (conCajero && conResumen)) nuevos.push(cor_id);
          if (posterior(cor_id, cursor)) cursor = cor_id;
        }
        if (items.length || nuevos.length) {
          const enviados = [...new Set([...estado.cortes_enviados, ...nuevos])].sort((x, y) => (posterior(x, y) ? 1 : -1)).slice(-MARGEN_CORTES);
          if (!await transmitir(items, { cortes_cursor: cursor, cortes_enviados: enviados }, 'incremental')) return false;
        }
        if (espera) return true;
      }
    }
    const cortesListos = await mandarCortes();
    await guardarAvisos();
    if (!cortesListos) return;
    // Ventas de mostrador desde 2025 (Cinco Caminos P1): una sola vez, al final de todo, de noche o con --mostrador-ahora.
    // Lee las ventas de (max(mostrador_cursor, desde - 1), cursor de ventas] y manda solo las de público (con su tumba
    // excluida si se habían mandado con cliente); mostrador_cursor avanza solo cuando el servidor confirma. Al alcanzar el
    // cursor de ventas termina y no vuelve a correr: lo nuevo ya sale con el interruptor prendido. Nunca toca ventana.
    if (config.mostrador !== true || estado.mostrador_terminado) return;
    if (!deps.mostradorAhora && !esHorarioHistorico(new Date(reloj()))) return;
    const terminar = () => transmitir([], { mostrador_terminado: true }, 'incremental');
    if (estado.mostrador_desde_ven_id === null) {
      const primera = await fuente.mostradorDesde(INICIO_MOSTRADOR);
      if (primera === null) { await terminar(); return; }
      estado.mostrador_desde_ven_id = id(primera);
      await guardar(archivo, estado);
    }
    for (let n = 0; n < PAGINAS_MOSTRADOR_POR_CORRIDA; n++) {
      const inicio = String(BigInt(estado.mostrador_desde_ven_id) - 1n);
      const desde = BigInt(estado.mostrador_cursor) > BigInt(inicio) ? estado.mostrador_cursor : inicio;
      const pagina = BigInt(desde) < BigInt(estado.ven_id) ? await fuente.ventas(desde, estado.ven_id, fuente.tamano) : { filas: [] };
      if (!pagina.filas.length) { await terminar(); return; }
      const ultimo = id(pagina.filas.at(-1).ven_id);
      // El cursor solo avanza: una página que no avanza (SICAR devolviendo basura) no deja el ciclo dando vueltas.
      if (BigInt(ultimo) <= BigInt(desde)) throw new Error('ID_INVALIDO');
      // Solo las fechadas desde 2025: un ven_id mayor no garantiza la fecha (reloj de SICAR mal puesto).
      const de2025 = { ...pagina, filas: pagina.filas.filter(v => String(v.fecha).replace('T', ' ') >= INICIO_MOSTRADOR) };
      if (!await transmitir(elementos(de2025, estado, avisar, omitir, config, true), { mostrador_cursor: ultimo }, 'incremental')) return;
    }
  } finally { await liberar(); }
}
module.exports = { ejecutar };
