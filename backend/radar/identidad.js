const UMBRAL_PARECIDO = 0.8;

const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "para", "con", "y", "o", "a", "en", "por", "al",
]);

function texto(valor) {
  return valor == null ? "" : String(valor).trim();
}

function textoEscrito(registro) {
  return [
    registro.producto_buscado,
    registro.marca_solicitada,
    registro.modelo_solicitado,
    registro.variante_solicitada,
  ].map(texto).filter(Boolean).join(" ");
}

function crearBolsaPalabras(registro) {
  let valor = textoEscrito(registro)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  valor = valor
    .replace(/(\d+(?:[/.]\d+)?)\s*(?:''|")/g, "$1pulgadas")
    .replace(/(\d+(?:[/.]\d+)?)\s*(?:pulgadas?|pulg)\b/g, "$1pulgadas")
    .replace(/(\d+(?:[/.]\d+)?)\s*(?:metros?|mts?|m)\b/g, "$1metros")
    .replace(/(\d+(?:[/.]\d+)?)\s*(?:watts?|w)\b/g, "$1w")
    .replace(/(\d+(?:[/.]\d+)?)\s*(?:volts?|v)\b/g, "$1v")
    .replace(/[^a-z0-9/.]+/g, " ");

  const palabras = valor.split(/\s+/).filter(Boolean).filter((palabra) => !PALABRAS_VACIAS.has(palabra)).map((palabra) => {
    if (!/\d/.test(palabra) && palabra.length >= 4 && palabra.endsWith("s")) return palabra.slice(0, -1);
    return palabra;
  });
  return [...new Set(palabras)].sort((a, b) => a.localeCompare(b, "es"));
}

function distanciaEdicion(a, b) {
  const anterior = Array.from({ length: b.length + 1 }, (_, indice) => indice);
  for (let i = 1; i <= a.length; i += 1) {
    const actual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      actual[j] = Math.min(
        actual[j - 1] + 1,
        anterior[j] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    anterior.splice(0, anterior.length, ...actual);
  }
  return anterior[b.length];
}

function palabrasCompatibles(a, b) {
  if (a === b) return true;
  const largo = Math.max(a.length, b.length);
  const tolerancia = largo <= 4 ? 0 : largo <= 7 ? 1 : 2;
  return distanciaEdicion(a, b) <= tolerancia;
}

function maximoEmparejamiento(palabrasA, palabrasB) {
  const asignadaA = new Array(palabrasA.length).fill(-1);
  function asignar(indiceB, visitadas) {
    for (let indiceA = 0; indiceA < palabrasA.length; indiceA += 1) {
      if (visitadas.has(indiceA) || !palabrasCompatibles(palabrasA[indiceA], palabrasB[indiceB])) continue;
      visitadas.add(indiceA);
      if (asignadaA[indiceA] === -1 || asignar(asignadaA[indiceA], visitadas)) {
        asignadaA[indiceA] = indiceB;
        return true;
      }
    }
    return false;
  }
  let total = 0;
  for (let indiceB = 0; indiceB < palabrasB.length; indiceB += 1) {
    if (asignar(indiceB, new Set())) total += 1;
  }
  return total;
}

function calcularSimilitud(bolsaA, bolsaB) {
  if (!bolsaA.length || !bolsaB.length) return 0;
  const numericasA = bolsaA.filter((palabra) => /\d/.test(palabra));
  const numericasB = bolsaB.filter((palabra) => /\d/.test(palabra));
  if (numericasA.length !== numericasB.length || numericasA.some((palabra, indice) => palabra !== numericasB[indice])) return 0;
  const textoA = bolsaA.filter((palabra) => !/\d/.test(palabra));
  const textoB = bolsaB.filter((palabra) => !/\d/.test(palabra));
  const emparejadas = numericasA.length + maximoEmparejamiento(textoA, textoB);
  return (2 * emparejadas) / (bolsaA.length + bolsaB.length);
}

function fechaComparable(registro) {
  return texto(registro.fecha_registro);
}

function camposLlenos(registro) {
  return [
    registro.producto_buscado,
    registro.marca_solicitada,
    registro.modelo_solicitado,
    registro.variante_solicitada,
  ].filter((valor) => texto(valor)).length;
}

function agruparRegistrosLibres(registros, umbral = UMBRAL_PARECIDO) {
  const preparados = registros.map((registro) => ({
    registro,
    bolsa: crearBolsaPalabras(registro),
    forma: textoEscrito(registro),
  })).filter((item) => item.bolsa.length > 0);
  const repeticiones = new Map();
  for (const item of preparados) {
    item.claveBolsa = item.bolsa.join("|");
    repeticiones.set(item.claveBolsa, (repeticiones.get(item.claveBolsa) || 0) + 1);
  }
  preparados.sort((a, b) =>
    (repeticiones.get(b.claveBolsa) - repeticiones.get(a.claveBolsa))
    || a.claveBolsa.localeCompare(b.claveBolsa, "es")
    || (Number(a.registro.id) - Number(b.registro.id))
  );

  const grupos = [];
  for (const item of preparados) {
    let elegido = null;
    let mejorPuntaje = -1;
    for (const grupo of grupos) {
      const puntaje = calcularSimilitud(item.bolsa, grupo.bolsaLider);
      if (puntaje > 0 && puntaje >= umbral && puntaje > mejorPuntaje) {
        elegido = grupo;
        mejorPuntaje = puntaje;
      }
    }
    if (!elegido) {
      elegido = { bolsaLider: item.bolsa, miembros: [] };
      grupos.push(elegido);
    }
    elegido.miembros.push(item);
  }

  return grupos.map((grupo) => {
    const formas = new Map();
    for (const miembro of grupo.miembros) {
      const actual = formas.get(miembro.forma) || {
        forma: miembro.forma,
        apariciones: 0,
        campos_llenos: 0,
        reciente: miembro.registro,
      };
      actual.apariciones += 1;
      actual.campos_llenos = Math.max(actual.campos_llenos, camposLlenos(miembro.registro));
      if (fechaComparable(miembro.registro) > fechaComparable(actual.reciente)
        || (fechaComparable(miembro.registro) === fechaComparable(actual.reciente) && Number(miembro.registro.id) > Number(actual.reciente.id))) {
        actual.reciente = miembro.registro;
      }
      formas.set(miembro.forma, actual);
    }
    const ordenadas = [...formas.values()].sort((a, b) =>
      b.apariciones - a.apariciones
      || b.campos_llenos - a.campos_llenos
      || fechaComparable(b.reciente).localeCompare(fechaComparable(a.reciente))
      || b.forma.localeCompare(a.forma, "es")
    );
    const lider = ordenadas[0];
    return {
      lider: lider.forma,
      nombre_visible: texto(lider.reciente.producto_buscado) || lider.forma,
      registro_lider: lider.reciente,
      formas_distintas: ordenadas.length,
      formas: ordenadas.map((forma) => ({
        forma: forma.forma,
        apariciones: forma.apariciones,
        similitud: calcularSimilitud(crearBolsaPalabras(forma.reciente), grupo.bolsaLider),
      })),
      registros: grupo.miembros.map((miembro) => miembro.registro),
    };
  });
}

module.exports = {
  UMBRAL_PARECIDO,
  crearBolsaPalabras,
  calcularSimilitud,
  agruparRegistrosLibres,
};
