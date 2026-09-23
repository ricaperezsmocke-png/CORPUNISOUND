const crypto = require("node:crypto");
const { fechaLocal } = require("./fechas");
const { registroDelDia, tienePlantillaEnMes } = require("./objetivos");
const { CLASES_ACTIVIDAD, claseActividad } = require("./objetivosActividadesCatalogo");

const subidasEnCurso = new Set();
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function normalizarLink(link) {
  const error = "El link debe empezar con http:// o https://";
  if (typeof link !== "string" || !/^https?:\/\//i.test(link.trim())) throw new Error(error);
  const texto = link.trim();
  if (texto.length > 500) throw new Error("El link no puede tener más de 500 caracteres");
  let url;
  try { url = new URL(texto); } catch { throw new Error(error); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(error);
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^(?:(?:www|m|mobile)\.)+/, "");
  url.username = "";
  url.password = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  const rastreo = new Set(["fbclid", "mibextid", "rdid", "share_url", "igsh", "igshid", "gclid"]);
  const parametros = [...url.searchParams]
    .filter(([nombre]) => !rastreo.has(nombre) && !nombre.startsWith("utm_"))
    .sort(([nombreA, valorA], [nombreB, valorB]) => {
      if (nombreA !== nombreB) return nombreA < nombreB ? -1 : 1;
      return valorA < valorB ? -1 : valorA > valorB ? 1 : 0;
    });
  url.search = new URLSearchParams(parametros).toString();
  // URL conserva la barra del path raíz; se quita al construir el resultado.
  const normalizado = url.origin + url.pathname.replace(/\/$/, "") + url.search;
  if (normalizado.length > 500) throw new Error("El link no puede tener más de 500 caracteres");
  return normalizado;
}

function normalizarNota(nota) {
  if (nota === undefined || nota === null) return null;
  if (typeof nota !== "string") throw new Error("La nota debe ser texto");
  const texto = nota.trim();
  if (texto.length > 300) throw new Error("La nota no puede tener más de 300 caracteres");
  return texto || null;
}

// Se repite la validación de captura para mantener objetivosCaptura.js intacto.
function validarFechaYPlantilla(DB, { mes, fecha, sucursal_id, vendedor_id }) {
  if (typeof mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error("La fecha debe tener formato AAAA-MM-DD y ser válida");
  }
  const [anio, numeroMes, dia] = fecha.split("-").map(Number);
  const fechaUTC = new Date(Date.UTC(anio, numeroMes - 1, dia));
  if (fechaUTC.getUTCFullYear() !== anio || fechaUTC.getUTCMonth() !== numeroMes - 1 || fechaUTC.getUTCDate() !== dia) {
    throw new Error("La fecha debe tener formato AAAA-MM-DD y ser válida");
  }
  if (!fecha.startsWith(`${mes}-`)) throw new Error("La fecha debe caer dentro del mes indicado");
  if (fecha > fechaLocal(new Date())) throw new Error("No se puede capturar una fecha futura o adelantada");
  if (!Number.isInteger(sucursal_id) || sucursal_id <= 0) {
    throw new Error("La sucursal debe tener un identificador válido");
  }
  const vendedor = DB.pos.vendedores.find((item) => item.id === vendedor_id);
  if (!vendedor) throw new Error("El vendedor no existe");
  const registro = registroDelDia(DB, { mes, vendedor_id, fecha });
  if (tienePlantillaEnMes(DB, mes, vendedor_id)) {
    if (!registro || registro.sucursal_id !== sucursal_id) {
      throw new Error("Ese día no estás en la plantilla de esta tienda");
    }
  } else if (vendedor.sucursal_id !== sucursal_id) {
    throw new Error("El vendedor no pertenece a esta sucursal");
  }
  return vendedor;
}

function prepararEvidencia(clase, { link, archivo }) {
  if (clase.evidencia === "link") {
    if (archivo !== undefined && archivo !== null) throw new Error("Esta actividad requiere link, no archivo");
    return { evidencia: { tipo: "link", link: normalizarLink(link) } };
  }
  if (link !== undefined && link !== null) throw new Error("Esta actividad requiere foto, no link");
  if (!archivo || typeof archivo.contenido_base64 !== "string" || !archivo.contenido_base64) {
    throw new Error("Adjunta una foto en JPG o PNG");
  }
  if (!["image/jpeg", "image/png"].includes(archivo.tipo_mime)) {
    throw new Error("Tipo de archivo no permitido: solo JPG o PNG");
  }
  if (typeof archivo.nombre_archivo !== "string" || !archivo.nombre_archivo.trim()) {
    throw new Error("El archivo debe tener nombre");
  }
  const buffer = Buffer.from(archivo.contenido_base64, "base64");
  if (!buffer.length) throw new Error("Adjunta una foto en JPG o PNG");
  if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");
  const huella = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, evidencia: { tipo: "foto", nombre_archivo: archivo.nombre_archivo, huella } };
}

function validarRepeticion(DB, datos, evidencia) {
  const repetidas = (DB.pos.objetivo_actividades || []).filter((registro) => {
    if (!registro.vigente || registro.evidencia.tipo !== evidencia.tipo) return false;
    if (evidencia.tipo !== "link") return registro.evidencia.huella === evidencia.huella;
    let linkGuardado = registro.evidencia.link;
    try { linkGuardado = normalizarLink(linkGuardado); } catch { /* Conservar el texto histórico inválido. */ }
    return linkGuardado === evidencia.link;
  });
  const propia = repetidas.find((registro) => registro.vendedor_id === datos.vendedor_id);
  if (propia) throw new Error(`Ya presentaste esta evidencia el ${propia.fecha}`);
  if (repetidas.some((registro) => registro.sucursal_id !== datos.sucursal_id)) {
    throw new Error("Esta evidencia ya fue presentada en otra tienda");
  }
  const otroMes = repetidas.find((registro) => registro.mes !== datos.mes);
  if (otroMes) {
    const vendedor = DB.pos.vendedores.find((item) => item.id === otroMes.vendedor_id);
    const nombre = vendedor?.nombre || "desconocido";
    throw new Error(`Esta evidencia ya la presentó ${nombre} el ${otroMes.fecha}, en otro mes; no puede contar de nuevo.`);
  }
  const anterior = repetidas[0];
  if (!anterior) return null;
  if (datos.conjunta !== true) {
    const vendedor = DB.pos.vendedores.find((item) => item.id === anterior.vendedor_id);
    const nombre = vendedor?.nombre || "desconocido";
    throw new Error(`Esta evidencia ya la presentó ${nombre} el ${anterior.fecha}. Si fue una actividad conjunta, confírmalo.`);
  }
  return anterior.conjunta_con ?? anterior.id;
}

// `antesDeGuardar` corre despues de Drive y justo antes de guardar: el mes pudo
// cerrarse mientras la foto subia, y un registro no puede entrar a un mes sellado.
async function registrarActividad(DB, datos, usuario, drive, { antesDeGuardar } = {}) {
  const vendedor = validarFechaYPlantilla(DB, datos);
  const clase = claseActividad(datos.actividad);
  if (!clase) throw new Error("La clase de actividad no es válida");
  const nota = normalizarNota(datos.nota);
  const { evidencia, buffer } = prepararEvidencia(clase, datos);
  let conjunta_con = validarRepeticion(DB, datos, evidencia);
  if (evidencia.tipo === "foto") {
    if (subidasEnCurso.has(evidencia.huella)) throw new Error("Ya se está subiendo esta foto; inténtalo de nuevo al terminar");
    subidasEnCurso.add(evidencia.huella);
    try {
      const sucursal = DB.pos.sucursales.find((item) => item.id === datos.sucursal_id) || { id: datos.sucursal_id };
      const carpetaId = await drive.asegurarCarpetaActividadesSucursal(DB, sucursal);
      const subido = await drive.subirArchivoADrive(DB, {
        nombre: `${datos.fecha} - ${vendedor.nombre} - ${datos.actividad} - ${evidencia.nombre_archivo}`,
        mimeType: datos.archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
      });
      if (!subido || !subido.id || !subido.webViewLink) {
        throw new Error("Drive no confirmó la subida de la foto; inténtalo de nuevo");
      }
      // Durante Drive puede entrar otra evidencia. Rechazar aquí deja solo un
      // archivo huérfano en Drive, nunca una actividad guardada a medias.
      conjunta_con = validarRepeticion(DB, datos, evidencia);
      evidencia.drive_file_id = subido.id;
      evidencia.drive_link = subido.webViewLink;
    } finally {
      subidasEnCurso.delete(evidencia.huella);
    }
  }
  if (antesDeGuardar) antesDeGuardar();
  const registros = DB.pos.objetivo_actividades || [];
  const registro = {
    id: registros.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    mes: datos.mes, fecha: datos.fecha, sucursal_id: datos.sucursal_id, vendedor_id: datos.vendedor_id,
    actividad: datos.actividad, evidencia, nota, conjunta_con,
    registrado_por: usuario?.nombre || "desconocido", registrado_en: new Date().toISOString(),
    vigente: true, anulado_por: null, anulado_en: null, motivo_anulacion: null, resultados: [],
  };
  registros.push(registro);
  DB.pos.objetivo_actividades = registros;
  return registro;
}

function buscarVigente(DB, id) {
  const registro = (DB.pos.objetivo_actividades || []).find((item) => item.id === Number(id));
  if (!registro) throw new Error("La actividad no existe");
  if (!registro.vigente) throw new Error("La actividad ya está anulada");
  return registro;
}

function anularActividad(DB, id, motivo, usuario) {
  const registro = buscarVigente(DB, id);
  if (typeof motivo !== "string" || !motivo.trim()) throw new Error("Anular requiere un motivo; no puede estar vacío");
  registro.vigente = false;
  registro.anulado_por = usuario?.nombre || "desconocido";
  registro.anulado_en = new Date().toISOString();
  registro.motivo_anulacion = motivo.trim();
  return registro;
}

function agregarResultado(DB, id, { contactos, cotizaciones, nota }, usuario) {
  const registro = buscarVigente(DB, id);
  for (const valor of [contactos, cotizaciones]) {
    if (!Number.isInteger(valor) || valor < 0) throw new Error("Contactos y cotizaciones deben ser enteros mayores o iguales a cero");
  }
  const resultado = {
    contactos, cotizaciones, nota: normalizarNota(nota),
    registrado_por: usuario?.nombre || "desconocido", registrado_en: new Date().toISOString(),
  };
  registro.resultados.push(resultado);
  return registro;
}

function actividadesDelMes(DB, { mes, sucursal_id, vendedor_id }) {
  return (DB.pos.objetivo_actividades || []).filter((registro) =>
    registro.mes === mes && registro.sucursal_id === sucursal_id &&
    (vendedor_id === undefined || vendedor_id === null || registro.vendedor_id === vendedor_id)
  ).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
}

function resumenActividades(DB, filtros) {
  const vigentes = (DB.pos.objetivo_actividades || []).filter((registro) => registro.vigente);
  const grupos = new Map();
  for (const registro of vigentes) {
    const idOriginal = registro.conjunta_con ?? registro.id;
    if (!grupos.has(idOriginal)) grupos.set(idOriginal, []);
    grupos.get(idOriginal).push(registro);
  }
  const representantes = new Map();
  for (const [idOriginal, grupo] of grupos) {
    const original = grupo.find((registro) => registro.id === idOriginal);
    const masAntigua = original || [...grupo].sort((a, b) =>
      a.registrado_en.localeCompare(b.registrado_en) || a.id - b.id
    )[0];
    representantes.set(idOriginal, masAntigua.id);
  }
  const deTienda = filtros.vendedor_id === undefined || filtros.vendedor_id === null;
  const registros = actividadesDelMes(DB, filtros).filter((registro) => registro.vigente &&
    (!deTienda || representantes.get(registro.conjunta_con ?? registro.id) === registro.id)
  );
  return CLASES_ACTIVIDAD.map((clase) => {
    const deClase = registros.filter((registro) => registro.actividad === clase.clave);
    return {
      actividad: clase.clave, etiqueta: clase.etiqueta, declaradas: deClase.length,
      conjuntas: deClase.filter((registro) => registro.conjunta_con !== null || grupos.get(registro.id)?.length > 1).length,
    };
  });
}

module.exports = {
  normalizarLink, registrarActividad, anularActividad, agregarResultado,
  actividadesDelMes, resumenActividades,
};
