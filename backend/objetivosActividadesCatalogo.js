const CLASES_ACTIVIDAD = [
  { clave: "grupos", etiqueta: "Publicación en grupos", evidencia: "link", unidad: "publicación" },
  { clave: "marketplace", etiqueta: "Publicación en Marketplace", evidencia: "link", unidad: "publicación" },
  { clave: "iglesia", etiqueta: "Salida a iglesia", evidencia: "foto", unidad: "salida" },
  { clave: "volanteo", etiqueta: "Jornada de volanteo", evidencia: "foto", unidad: "jornada" },
];

function claseActividad(clave) {
  return CLASES_ACTIVIDAD.find((clase) => clase.clave === clave) || null;
}

module.exports = { CLASES_ACTIVIDAD, claseActividad };
