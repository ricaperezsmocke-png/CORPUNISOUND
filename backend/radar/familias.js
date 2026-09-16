// Proyección pura: ninguna regla consulta ni modifica catálogo o persistencia.
const { normalizarTextoRadar, normalizarGrafiaRadar, palabrasCompatibles } = require("./identidad");
const { seleccionarUniversoDemanda } = require("./metricas");
const { fechaLocal } = require("../fechas");

const VERSION = 2;
const REGLAS = [
  ["reparacion", "Reparación", ["reparacion", "reparar", "servicio tecnico"]],
  ["pastillas", "Pastillas", ["pastilla"]],
  ["maquinaria", "Maquinaria", ["maquinaria", "clavija"]],
  ["fundas", "Fundas", ["funda", "estuche"]],
  ["cuerdas", "Cuerdas", ["cuerda", "encordadura"]],
  ["capotrastes", "Capotrastes", ["capotraste", "capo traste", "capo"]],
  ["bases_atriles", "Bases y atriles", ["base", "atril", "atrile", "pedestal", "tripie"]],
  ["cables", "Cables", ["cable"]],
  ["conectores", "Conectores", ["conector", "conectore", "terminal", "terminale"]],
  ["guitarrones", "Guitarrones", ["guitarron", "guitarrone"]],
  ["vihuelas", "Vihuelas", ["vihuela"]],
  ["bajos_quintos", "Bajos quintos", ["bajo quinto"]],
  ["requintos", "Requintos", ["requinto"]],
  ["guitarras", "Guitarras", ["guitarra", "docerola"]],
  ["violines", "Violines", ["violin", "violine"]],
  ["teclados", "Teclados", ["teclado"]],
  ["saxofones", "Saxofones", ["saxofon", "saxofone"]],
  ["trompetas", "Trompetas", ["trompeta"]],
  ["microfonos", "Micrófonos", ["microfono"]],
  ["amplificadores", "Amplificadores", ["amplificador", "amplificadore"]],
  ["bocinas", "Bocinas", ["bocina", "bafle"]],
];
const TIPOS = {
  guitarras: [
    ["electroacustica", "Electroacústica", ["electroacustica", "electroacustico"]],
    ["electrica", "Eléctrica", ["electrica", "electrico"]],
    ["acustica", "Acústica", ["acustica", "acustico"]],
    ["clasica", "Clásica", ["clasica", "clasico"]],
  ],
  microfonos: [["inalambrico", "Inalámbrico", ["inalambrico", "inalambrica"]]],
};
// Auxiliar de reconocimiento, nunca filtro de admisión de marcas explícitas.
const MARCAS = [
  "Fender", "Pure GEWA", "GEWA", "Tagima", "Yamaha", "Steren", "Shure", "Radox",
  "Eminence", "Harden", "Sony", "Sevillana", "Duracell", "BKL", "JR",
  "Ibanez", "Epiphone", "Takamine", "Casio", "Roland",
];
const DESCRIPTORES = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "para", "con", "y", "e", "o", "a", "en",
  "economica", "economico", "normal", "audio", "tamano", "acabado", "cuerda", "peso", "presupuesto",
  "negro", "negra", "blanco", "blanca", "rojo", "roja", "azul", "zurdo", "zurda", "mate", "brillante",
]);
const esTexto = (valor) => valor == null || typeof valor === "string";
const texto = (valor) => typeof valor === "string" ? valor : "";

function tokensOriginales(valor) {
  return [...valor.matchAll(/[\p{L}\p{N}]+(?:[-/.][\p{L}\p{N}]+)*/gu)].map((m) => ({
    original: m[0], normalizado: normalizarTextoRadar(m[0]), inicio: m.index, fin: m.index + m[0].length,
  }));
}

function coincidencia(palabras, indice) {
  // Exactas primero: guitarrón nunca se convierte en guitarra por parecido.
  for (const difusa of [false, true]) {
    const candidatas = REGLAS.filter(([, , variantes]) => variantes.some((variante) => {
      const partes = variante.split(" ");
      return partes.every((parte, desplazamiento) => {
        const palabra = palabras[indice + desplazamiento];
        return palabra === parte || (difusa && palabra?.length >= 5 && parte.length >= 5
          && !/\d/.test(palabra) && palabrasCompatibles(palabra, parte));
      });
    }));
    if (candidatas.length === 1) return candidatas[0];
    if (candidatas.length > 1) return null;
  }
  return null;
}

function articuloPrincipal(valor) {
  const palabras = normalizarTextoRadar(valor).split(" ");
  for (let indice = 0; indice < palabras.length; indice += 1) {
    // Los valores de marca/modelo no son vocabulario de artículos.
    if (palabras[indice] === "marca" || palabras[indice] === "modelo") break;
    const regla = coincidencia(palabras, indice);
    if (regla) return regla;
  }
  return null;
}

function empiezaArticulo(valor) {
  const palabras = normalizarTextoRadar(valor).replace(/^(?:\d+(?:\.\d+)?|un|una)\s+/, "").split(" ");
  return Boolean(coincidencia(palabras, 0));
}

function separarArticulos(original) {
  const partes = [];
  let inicio = 0;
  for (const m of original.matchAll(/;|(?<!\d),(?!\d)|\s+(?:y|e|\+)\s+/gi)) {
    const izquierda = original.slice(inicio, m.index);
    const derecha = original.slice(m.index + m[0].length);
    // «para guitarra y bajo» describe compatibilidad, no una segunda compra.
    const uso = /\bpara\b/.test(normalizarTextoRadar(izquierda));
    if (m[0] !== ";" && (!empiezaArticulo(derecha) || uso)) continue;
    partes.push({ inicio, fin: m.index });
    inicio = m.index + m[0].length;
  }
  partes.push({ inicio, fin: original.length });
  return partes.map((p) => {
    const tramo = original.slice(p.inicio, p.fin);
    const espacios = tramo.length - tramo.trimStart().length;
    const fragmento = tramo.trim();
    return { fragmento, inicio: p.inicio + espacios, fin: p.inicio + espacios + fragmento.length };
  });
}

function caracteristicasDe(valor) {
  const normalizado = normalizarTextoRadar(valor);
  const caracteristicas = new Map();
  const agregar = (clave, etiqueta) => caracteristicas.set(clave, { clave, etiqueta });
  for (const m of normalizado.matchAll(/\b(\d+) cuerda\b/g)) agregar(`cuerdas_${m[1]}`, `${m[1]} cuerdas`);
  if (/\bdocerola\b/.test(normalizado)) agregar("cuerdas_12", "12 cuerdas");
  for (const [patron, clave, etiqueta] of [
    [/\bnegr[oa]\b/, "color_negro", "Negro"], [/\bblanc[oa]\b/, "color_blanco", "Blanco"],
    [/\broj[oa]\b/, "color_rojo", "Rojo"], [/\bazul\b/, "color_azul", "Azul"],
    [/\bzurd[oa]\b/, "zurdo", "Zurdo"], [/\bmate\b/, "acabado_mate", "Mate"],
    [/\bbrillante\b/, "acabado_brillante", "Brillante"],
  ]) if (patron.test(normalizado)) agregar(clave, etiqueta);
  for (const m of normalizado.matchAll(/\b(\d+\/\d+)\b/g)) agregar(`tamano_${m[1].replace("/", "_")}`, m[1]);
  return [...caracteristicas.values()];
}

function tipoDe(familiaId, atributos, diagnosticos) {
  const palabras = normalizarTextoRadar(atributos).split(" ");
  const tipos = (TIPOS[familiaId] || []).filter(([, , variantes]) => variantes.some((v) =>
    palabras.some((p) => p === v || (p.length >= 5 && !/\d/.test(p) && palabrasCompatibles(p, v)))
  ));
  if (tipos.length === 1) return tipos[0];
  diagnosticos.push({ motivo: tipos.length > 1 ? "TIPO_AMBIGUO" : "TIPO_NO_IDENTIFICADO" });
  return ["no_identificado", "Tipo no identificado"];
}

function esImporte(valor) {
  return /\$|\bpesos?\b/i.test(valor) || /^\s*\d[\d,.\s]*\s*$/.test(valor);
}

function marcaReconocida(literal) {
  return { estado: "RECONOCIDA", texto: literal, clave: normalizarGrafiaRadar(literal), candidato: null };
}

function extraerIdentidad(fragmento, registro, unica, diagnosticos) {
  const tokens = tokensOriginales(fragmento);
  const ocupados = new Set();
  const ocupar = (inicio, fin) => tokens.forEach((t, i) => { if (t.inicio >= inicio && t.fin <= fin) ocupados.add(i); });
  let modelo = unica && !esImporte(texto(registro.modelo_solicitado)) ? texto(registro.modelo_solicitado) : "";
  const indiceModelo = tokens.findIndex((t) => t.normalizado === "modelo");
  if (indiceModelo >= 0) {
    const siguiente = tokens[indiceModelo + 1];
    if (!modelo && siguiente && !esImporte(siguiente.original)) modelo = siguiente.original;
    ocupados.add(indiceModelo);
    ocupados.add(indiceModelo + 1);
  }
  let marca = null;
  const campoMarca = texto(registro.marca_solicitada);
  if (unica && campoMarca.trim() && !esImporte(campoMarca)) marca = marcaReconocida(campoMarca);
  const indiceMarca = tokens.findIndex((t) => t.normalizado === "marca");
  if (indiceMarca >= 0) {
    let fin = indiceMarca + 1;
    // El marcador es evidencia explícita; admite incluso nombres nuevos con cifras.
    while (fin < tokens.length && tokens[fin].normalizado !== "modelo"
      && !["con", "para"].includes(tokens[fin].normalizado)
      && !(DESCRIPTORES.has(tokens[fin].normalizado) && !["de", "del", "la", "el", "y"].includes(tokens[fin].normalizado))) fin += 1;
    if (fin > indiceMarca + 1) {
      const literal = fragmento.slice(tokens[indiceMarca + 1].inicio, tokens[fin - 1].fin);
      if (!marca && !esImporte(literal)) marca = marcaReconocida(literal);
      ocupar(tokens[indiceMarca].inicio, tokens[fin - 1].fin);
    }
  }
  const encontradas = [];
  for (const conocida of MARCAS) {
    const patron = new RegExp(`\\b${conocida.replace(/ /g, "\\s+")}\\b`, "gi");
    for (const m of fragmento.matchAll(patron)) {
      if (tokens.some((t, i) => ocupados.has(i) && t.inicio >= m.index && t.fin <= m.index + m[0].length)) continue;
      encontradas.push({ literal: m[0], inicio: m.index, fin: m.index + m[0].length });
      ocupar(m.index, m.index + m[0].length);
    }
  }
  if (!marca && encontradas.length) {
    const claves = new Set(encontradas.map((m) => normalizarGrafiaRadar(m.literal)));
    if (claves.size === 1) marca = marcaReconocida(encontradas[0].literal);
    else {
      const candidato = fragmento.slice(Math.min(...encontradas.map((m) => m.inicio)), Math.max(...encontradas.map((m) => m.fin)));
      marca = { estado: "NO_IDENTIFICADA", texto: "", clave: "no_identificada", candidato };
    }
  }
  for (const m of fragmento.matchAll(/\$\s*[\d,.]+|\b[\d,.]+\s*pesos?\b/gi)) ocupar(m.index, m.index + m[0].length);
  // Una palabra sobrante NO basta para llamarla marca: el spec prohíbe
  // convertir el descarte en marca ("guitarra económica para principiante" no
  // es marca Principiante). El único indicio disponible es que el vendedor la
  // escribió con mayúscula inicial. Si el texto viene TODO en mayúsculas ese
  // indicio no existe y no se propone ningún candidato; el texto original
  // siempre queda visible en la evidencia.
  const todoMayusculas = fragmento === fragmento.toLocaleUpperCase("es");
  const pareceNombrePropio = (original) => !todoMayusculas
    && original.slice(0, 1) !== original.slice(0, 1).toLocaleLowerCase("es");
  const candidatos = tokens.filter((t, i) => {
    if (ocupados.has(i) || DESCRIPTORES.has(t.normalizado) || !/[\p{L}]/u.test(t.original)) return false;
    if (modelo && normalizarGrafiaRadar(t.original) === normalizarGrafiaRadar(modelo)) return false;
    if (coincidencia(tokens.map((token) => token.normalizado), i)) return false;
    // Segundo término de expresiones controladas, por ejemplo «bajo quinto».
    if (REGLAS.some(([, , variantes]) => variantes.some((v) => v.split(" ").includes(t.normalizado)))) return false;
    if (Object.values(TIPOS).flat().some(([, , variantes]) => variantes.some((v) => palabrasCompatibles(t.normalizado, v)))) return false;
    const codigoModelo = /^[A-Za-z]{1,4}[-/]?\d{1,5}[A-Za-z]{0,2}$/.test(t.original);
    if (/^\d+(?:[/.]\d+)?(?:pulgadas|metros|w|v)?$/.test(t.normalizado) || codigoModelo) {
      if (codigoModelo) {
        if (!modelo) modelo = t.original;
        ocupados.add(i);
      }
      return false;
    }
    return pareceNombrePropio(t.original);
  });
  if (!marca && candidatos.length) {
    const candidato = fragmento.slice(candidatos[0].inicio, candidatos.at(-1).fin);
    marca = { estado: "NO_IDENTIFICADA", texto: "", clave: "no_identificada", candidato };
  }
  if (!unica && [registro.marca_solicitada, registro.modelo_solicitado, registro.variante_solicitada].some((v) => texto(v).trim())) {
    diagnosticos.push({ motivo: "CAMPOS_SIN_ATRIBUCION" });
    if (!marca && campoMarca.trim() && !esImporte(campoMarca)) {
      marca = { estado: "NO_IDENTIFICADA", texto: "", clave: "no_identificada", candidato: campoMarca };
    }
  }
  if (!marca) marca = { estado: "NO_INFORMADA", texto: "", clave: "no_informada", candidato: null };
  if (marca.estado === "NO_IDENTIFICADA") diagnosticos.push({ motivo: "MARCA_NO_IDENTIFICADA" });
  return { marca, modelo, semantica: tokens.filter((t, i) => !ocupados.has(i)).map((t) => t.original).join(" ") };
}

function cantidadDe(valor, diagnosticos) {
  if (valor == null || (typeof valor === "string" && !valor.trim())) return null;
  if ((typeof valor === "number" || typeof valor === "string") && Number.isFinite(Number(valor)) && Number(valor) > 0) return Number(valor);
  diagnosticos.push({ motivo: "CANTIDAD_INVALIDA" });
  return null;
}

function clasificarSolicitud(entrada) {
  const registro = entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : {};
  const fuente = registro.producto_buscado == null || registro.producto_buscado === ""
    ? registro.producto_nombre_registrado : registro.producto_buscado;
  const original = texto(fuente);
  const partes = separarArticulos(original);
  return partes.map((parte) => {
    const diagnosticos = [];
    const unica = partes.length === 1;
    const danado = !esTexto(fuente) || (unica && [registro.marca_solicitada, registro.modelo_solicitado, registro.variante_solicitada].some((v) => !esTexto(v)));
    if (danado) diagnosticos.push({ motivo: "DATO_INVALIDO" });
    const cantidadTexto = parte.fragmento.match(/^\s*(\d+(?:\.\d+)?)\s+(?=\p{L})/u);
    const cantidad = cantidadDe(cantidadTexto ? cantidadTexto[1] : unica ? registro.cantidad : null, diagnosticos);
    if (cantidad === null && !diagnosticos.some((d) => d.motivo === "CANTIDAD_INVALIDA")) diagnosticos.push({ motivo: "CANTIDAD_DESCONOCIDA" });
    const regla = articuloPrincipal(parte.fragmento);
    const degradar = danado || diagnosticos.some((d) => d.motivo === "CANTIDAD_INVALIDA");
    const [familia_id, familia] = !degradar && regla ? regla : ["por_clasificar", "Por clasificar"];
    if (!regla) diagnosticos.push({ motivo: "FAMILIA_NO_IDENTIFICADA" });
    const { semantica, ...identidad } = extraerIdentidad(parte.fragmento, registro, unica, diagnosticos);
    const atributos = [semantica, unica ? texto(registro.variante_solicitada) : ""].join(" ");
    const [tipo_id, tipo] = tipoDe(familia_id, atributos, diagnosticos);
    return {
      familia_id, familia, tipo_id, tipo, ...identidad,
      caracteristicas: caracteristicasDe(atributos), cantidad,
      regla: regla && !degradar ? `articulo_principal:${regla[0]}` : "sin_regla_segura",
      version: VERSION, diagnosticos,
      evidencia: {
        texto_original: fuente ?? "", ...parte,
        marca_solicitada: registro.marca_solicitada ?? null,
        modelo_solicitado: registro.modelo_solicitado ?? null,
        variante_solicitada: registro.variante_solicitada ?? null,
        cantidad_original: registro.cantidad ?? null,
      },
    };
  });
}

function nuevoConteo(datos = {}) {
  return { ...datos, _solicitudes: new Set(), unidades_conocidas: 0, articulos_cantidad_desconocida: 0 };
}

function contar(nodo, solicitud, articulo) {
  nodo._solicitudes.add(solicitud);
  if (articulo.cantidad === null) nodo.articulos_cantidad_desconocida += 1;
  else nodo.unidades_conocidas += articulo.cantidad;
}

function obtenerNodo(mapa, clave, datos) {
  if (!mapa.has(clave)) mapa.set(clave, nuevoConteo({ clave, ...datos }));
  return mapa.get(clave);
}

function contarMarca(mapa, solicitud, articulo) {
  const { marca, modelo } = articulo;
  const clave = `${marca.estado}:${marca.clave}`;
  const nodo = obtenerNodo(mapa, clave, {
    estado: marca.estado,
    etiqueta: marca.estado === "RECONOCIDA" ? marca.texto
      : marca.estado === "NO_IDENTIFICADA" ? "Marca no identificada" : "Marca no informada",
    escrituras: new Set(), candidatos: new Set(), modelos: new Map(),
  });
  contar(nodo, solicitud, articulo);
  if (marca.texto) nodo.escrituras.add(marca.texto);
  if (marca.candidato) nodo.candidatos.add(marca.candidato);
  const nodoModelo = obtenerNodo(nodo.modelos, modelo ? `modelo:${normalizarGrafiaRadar(modelo)}` : "no_informado", {
    etiqueta: modelo || "Modelo no informado", escrituras: new Set(),
  });
  if (modelo) nodoModelo.escrituras.add(modelo);
  contar(nodoModelo, solicitud, articulo);
}

function finalizar(nodo) {
  const { _solicitudes, ...resultado } = nodo;
  resultado.solicitudes = _solicitudes.size;
  for (const [campo, valor] of Object.entries(resultado)) {
    if (valor instanceof Map) {
      resultado[campo] = [...valor.values()].sort((a, b) => a.clave.localeCompare(b.clave, "es")).map(finalizar);
    } else if (valor instanceof Set) resultado[campo] = [...valor];
  }
  return resultado;
}

/**
 * El llamador entrega registros con el alcance y periodo ya aplicados (Task 5).
 * PENDIENTE está contenido en HISTORICA; estos resultados nunca se suman.
 * Solo el universo ausente/inválido (error del llamador) lanza; los datos
 * defectuosos quedan en diagnósticos de su solicitud/artículo.
 */
function agruparFamilias(registros, opciones = {}) {
  const { universo } = opciones;
  const seleccion = seleccionarUniversoDemanda(registros, universo);
  const diagnosticos = [...seleccion.diagnosticos];
  const resultado = nuevoConteo({ universo, version: VERSION, familias: new Map(), diagnosticos });
  const vistas = new Set();
  for (const registro of seleccion.registros) {
    const tieneId = (typeof registro.id === "string" && registro.id.trim())
      || (typeof registro.id === "number" && Number.isFinite(registro.id));
    const solicitud = tieneId ? String(registro.id) : Symbol();
    if (vistas.has(solicitud)) continue;
    vistas.add(solicitud);
    const articulos = clasificarSolicitud(registro);
    const fecha = registro.fecha_registro;
    const fechaValida = typeof fecha === "string" && fecha.trim() && !Number.isNaN(Date.parse(fecha));
    // Una fecha que ya viene como dia suelto YA es el dia: pasarla por una zona
    // horaria solo puede correrla. Render corre en UTC y el proceso local no.
    const esSoloDia = fechaValida && /^\d{4}-\d{2}-\d{2}$/.test(fecha.trim());
    const fechaDia = !fechaValida ? null : esSoloDia ? fecha.trim() : fechaLocal(fecha);
    if (!fechaValida) diagnosticos.push({ demanda_id: registro.id ?? null, motivo: "FECHA_INVALIDA" });
    const evidenciaPorFamilia = new Map();
    articulos.forEach((articulo, indice) => {
      const familia = obtenerNodo(resultado.familias, articulo.familia_id, {
        etiqueta: articulo.familia, tipos: new Map(), marcas: new Map(), registros: [],
      });
      const tipo = obtenerNodo(familia.tipos, articulo.tipo_id, {
        etiqueta: articulo.tipo, marcas: new Map(), caracteristicas: new Map(),
      });
      contar(resultado, solicitud, articulo);
      contar(familia, solicitud, articulo);
      contar(tipo, solicitud, articulo);
      contarMarca(familia.marcas, solicitud, articulo);
      contarMarca(tipo.marcas, solicitud, articulo);
      for (const caracteristica of articulo.caracteristicas) {
        const nodo = obtenerNodo(tipo.caracteristicas, caracteristica.clave, { etiqueta: caracteristica.etiqueta });
        contar(nodo, solicitud, articulo);
      }
      for (const diagnostico of articulo.diagnosticos) {
        diagnosticos.push({ demanda_id: registro.id ?? null, articulo: indice, ...diagnostico });
      }
      if (!evidenciaPorFamilia.has(articulo.familia_id)) {
        const evidencia = {
          demanda_id: registro.id ?? null, estado: registro.estado,
          sucursal_id: registro.sucursal_id ?? null,
          fecha_registro: fecha ?? null, fecha_local: fechaDia,
          cantidad_original: registro.cantidad ?? null, articulos: [],
        };
        evidenciaPorFamilia.set(articulo.familia_id, evidencia);
        familia.registros.push(evidencia);
      }
      evidenciaPorFamilia.get(articulo.familia_id).articulos.push(articulo);
    });
  }
  return finalizar(resultado);
}

module.exports = { VERSION, clasificarSolicitud, agruparFamilias };
