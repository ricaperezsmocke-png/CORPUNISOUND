const ESTADOS_LEAD = Object.freeze([
  "NUEVO",
  "ASIGNADO",
  "CONTACTADO",
  "CALIFICADO",
  "COTIZACION",
  "NEGOCIACION",
  "GANADO",
  "PERDIDO",
  "NO_RESPONDE",
  "NO_CALIFICADO",
  "DUPLICADO",
]);

const ESTADOS_TERMINALES = Object.freeze([
  "GANADO",
  "PERDIDO",
  "NO_RESPONDE",
  "NO_CALIFICADO",
  "DUPLICADO",
]);

const TRANSICIONES_ESTADO = Object.freeze({
  NUEVO: Object.freeze(["ASIGNADO", "NO_CALIFICADO", "DUPLICADO"]),
  ASIGNADO: Object.freeze(["CONTACTADO", "NO_RESPONDE", "NO_CALIFICADO", "PERDIDO", "DUPLICADO"]),
  CONTACTADO: Object.freeze(["CALIFICADO", "NO_RESPONDE", "NO_CALIFICADO", "PERDIDO", "DUPLICADO"]),
  CALIFICADO: Object.freeze(["COTIZACION", "PERDIDO", "DUPLICADO"]),
  COTIZACION: Object.freeze(["NEGOCIACION", "GANADO", "PERDIDO", "DUPLICADO"]),
  NEGOCIACION: Object.freeze(["GANADO", "PERDIDO", "DUPLICADO"]),
  GANADO: Object.freeze([]),
  PERDIDO: Object.freeze([]),
  NO_RESPONDE: Object.freeze([]),
  NO_CALIFICADO: Object.freeze([]),
  DUPLICADO: Object.freeze([]),
});

class ErrorDominioCentroLeads extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = "ErrorDominioCentroLeads";
    this.codigo = codigo;
  }
}

function validarIdLogico(valor, campo, { opcional = true } = {}) {
  if (valor === undefined || valor === null) {
    if (opcional) return null;
    throw new ErrorDominioCentroLeads("ID_REQUERIDO", `${campo} es obligatorio`);
  }
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ErrorDominioCentroLeads("ID_INVALIDO", `${campo} debe ser un entero positivo`);
  }
  return numero;
}

function validarEstado(estado) {
  if (!ESTADOS_LEAD.includes(estado)) {
    throw new ErrorDominioCentroLeads("ESTADO_INVALIDO", `Estado de lead inválido: ${estado}`);
  }
  return estado;
}

function validarTransicion(actual, siguiente) {
  validarEstado(actual);
  validarEstado(siguiente);
  if (!TRANSICIONES_ESTADO[actual].includes(siguiente)) {
    throw new ErrorDominioCentroLeads(
      "TRANSICION_INVALIDA",
      `Transición de ${actual} a ${siguiente} no permitida`
    );
  }
  return siguiente;
}

function normalizarTelefono(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const texto = String(valor).trim();
  const prefijo = texto.startsWith("+") ? "+" : "";
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length < 7 || digitos.length > 15) {
    throw new ErrorDominioCentroLeads("TELEFONO_INVALIDO", "El teléfono debe contener entre 7 y 15 dígitos");
  }
  return prefijo + digitos;
}

function normalizarEmail(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const email = String(valor).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErrorDominioCentroLeads("EMAIL_INVALIDO", "El email no tiene un formato válido");
  }
  return email;
}

function normalizarFechaUtc(valor, campo = "fecha") {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new ErrorDominioCentroLeads("FECHA_INVALIDA", `${campo} no es una fecha válida`);
  }
  return fecha.toISOString();
}

function instanteContexto(contexto = {}) {
  const valor = typeof contexto.ahora === "function" ? contexto.ahora() : new Date();
  return normalizarFechaUtc(valor, "ahora");
}

const CLAVES_SENSIBLES = /(?:token|secret|password|passwd|api[_-]?key|oauth|authorization|cookie|credencial)/i;

function textoRequerido(valor, campo) {
  const texto = valor == null ? "" : String(valor).trim();
  if (!texto) {
    throw new ErrorDominioCentroLeads("CAMPO_REQUERIDO", `${campo} es obligatorio`);
  }
  return texto;
}

function validarMetadataNoSensible(metadata) {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ErrorDominioCentroLeads("METADATA_INVALIDA", "metadata debe ser un objeto");
  }
  const revisar = (valor) => {
    if (!valor || typeof valor !== "object") return;
    for (const [clave, contenido] of Object.entries(valor)) {
      if (CLAVES_SENSIBLES.test(clave)) {
        throw new ErrorDominioCentroLeads("METADATA_SENSIBLE", `metadata contiene una clave sensible: ${clave}`);
      }
      revisar(contenido);
    }
  };
  revisar(metadata);
  const serializada = JSON.stringify(metadata);
  if (Buffer.byteLength(serializada, "utf8") > 4096) {
    throw new ErrorDominioCentroLeads("METADATA_EXCESIVA", "metadata no puede superar 4096 bytes");
  }
  return serializada;
}

module.exports = {
  ESTADOS_LEAD,
  ESTADOS_TERMINALES,
  TRANSICIONES_ESTADO,
  ErrorDominioCentroLeads,
  validarIdLogico,
  validarEstado,
  validarTransicion,
  normalizarTelefono,
  normalizarEmail,
  normalizarFechaUtc,
  instanteContexto,
  textoRequerido,
  validarMetadataNoSensible,
};
