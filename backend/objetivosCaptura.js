const { mesValido, fechaValida, validarFechaYPlantilla } = require("./objetivosFechas");
const { listarElementos } = require("./objetivosCatalogos");

function siguienteId(capturas) {
  return capturas.reduce((maximo, captura) => Math.max(maximo, captura.id), 0) + 1;
}

function validarMonto(monto, tipo) {
  if (!Number.isFinite(monto) || monto < 0) {
    throw new Error("El monto debe ser un número finito mayor o igual a cero");
  }
  // Pesos con a lo más dos decimales: con más, cada importe se redondeaba por separado en el
  // candado y tres marcas de $1.004 cabían en una venta de $3.00.
  if (tipo !== "producto" && Math.abs(monto * 100 - Math.round(monto * 100)) > 1e-6) {
    throw new Error("El monto en pesos acepta a lo más dos decimales");
  }
  if (tipo === "producto" && !Number.isInteger(monto)) {
    throw new Error("El monto de producto debe ser un entero mayor o igual a cero");
  }
}

function normalizarId(valor, campo) {
  const id = typeof valor === "string" || typeof valor === "number" ? Number(valor) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${campo} debe tener un identificador válido`);
  return id;
}

function referenciaDeCaptura({ tipo, marca_id = null, producto_meta_id = null, actividad = null, financiera = null }) {
  if (!["venta", "marca", "producto"].includes(tipo)) {
    throw new Error("El tipo de captura debe ser venta, marca o producto");
  }
  const campoPropio = { marca: "marca_id", producto: "producto_meta_id" }[tipo];
  const referencias = { marca_id, producto_meta_id, actividad, financiera };
  for (const [campo, valor] of Object.entries(referencias)) {
    if (campo !== campoPropio && valor !== null) {
      throw new Error(`Una captura de ${tipo} no puede tener ${campo}`);
    }
  }
  if (tipo === "marca") return { marca_id: normalizarId(marca_id, "La marca") };
  if (tipo === "producto") return { producto_meta_id: normalizarId(producto_meta_id, "El producto") };
  return {};
}

function validarElemento(DB, datos, incluirInactivos = false) {
  if (datos.tipo === "venta") return;
  const esMarca = datos.tipo === "marca";
  const lista = esMarca ? "marcas" : "productos";
  const id = esMarca ? datos.marca_id : datos.producto_meta_id;
  if (!listarElementos(DB, lista, { incluirInactivos }).some((elemento) => elemento.id === id)) {
    const nombre = esMarca ? "La marca" : "El producto";
    throw new Error(`${nombre} no existe${incluirInactivos ? "" : " o está desactivada"}`);
  }
}

function mismaReferencia(captura, datos) {
  return captura.tipo === datos.tipo &&
    (captura.marca_id ?? null) === (datos.marca_id ?? null) &&
    (captura.producto_meta_id ?? null) === (datos.producto_meta_id ?? null);
}

function validarCandadoMarca(DB, datos, reemplazaId = null) {
  if (datos.tipo === "producto") return;
  // Igual que la unicidad, el día de la persona no se duplica por un traslado.
  const delDia = DB.pos.objetivo_capturas.filter((captura) => captura.vigente &&
    captura.vendedor_id === datos.vendedor_id && captura.fecha === datos.fecha);
  // En centavos enteros: en binario 1.40 + 70.20 > 71.60, y el candado le rechazaba a una
  // vendedora la repartición exacta de su venta.
  const centavos = (monto) => Math.round(monto * 100);
  const marcas = delDia.filter((captura) => captura.tipo === "marca" && captura.id !== reemplazaId)
    .reduce((total, captura) => total + centavos(captura.monto), 0);
  if (datos.tipo === "venta") {
    if (centavos(datos.monto) < marcas) {
      throw new Error("Tu venta quedaría por debajo de lo que ya capturaste por marca; corrige primero las marcas");
    }
    return;
  }
  const venta = delDia.find((captura) => captura.tipo === "venta");
  if (!venta) throw new Error("Primero captura tu venta de ese día");
  if (marcas + centavos(datos.monto) > centavos(venta.monto)) {
    throw new Error("La suma de lo capturado por marca no puede superar tu venta de ese día");
  }
}

function capturarDia(DB, datos, usuario) {
  validarMonto(datos.monto, datos.tipo);
  const referencia = referenciaDeCaptura(datos);
  datos = {
    ...datos, ...referencia,
    sucursal_id: normalizarId(datos.sucursal_id, "La sucursal"),
    vendedor_id: normalizarId(datos.vendedor_id, "El vendedor"),
  };
  validarFechaYPlantilla(DB, datos);
  validarElemento(DB, datos);

  // Sin sucursal a proposito: si trasladan a la persona a mitad de mes, el mismo
  // dia no puede quedar capturado en dos tiendas.
  const yaCapturado = DB.pos.objetivo_capturas.some((captura) =>
    captura.vigente &&
    captura.vendedor_id === datos.vendedor_id &&
    mismaReferencia(captura, datos) &&
    captura.fecha === datos.fecha
  );
  if (yaCapturado) {
    throw new Error("Ya hay una captura de ese día; si el monto está mal, usa Corregir");
  }
  validarCandadoMarca(DB, datos);

  const nueva = {
    id: siguienteId(DB.pos.objetivo_capturas),
    mes: datos.mes,
    fecha: datos.fecha,
    sucursal_id: datos.sucursal_id,
    vendedor_id: datos.vendedor_id,
    tipo: datos.tipo,
    ...referencia,
    monto: datos.monto,
    capturado_por: usuario?.nombre || "desconocido",
    capturado_en: new Date().toISOString(),
    corrige_a: null,
    vigente: true,
  };

  DB.pos.objetivo_capturas.push(nueva);
  return nueva;
}

function corregirCaptura(DB, capturaId, monto, motivo, usuario) {
  validarMonto(monto);
  if (typeof motivo !== "string" || motivo.trim() === "") {
    throw new Error("Corregir una captura requiere un motivo; no puede estar vacío");
  }

  const id = normalizarId(capturaId, "La captura");
  const anterior = DB.pos.objetivo_capturas.find((captura) => captura.id === id);
  if (!anterior) throw new Error("La captura que se quiere corregir no existe");
  if (!anterior.vigente) {
    throw new Error("La captura ya fue corregida y dejó de estar vigente");
  }
  validarMonto(monto, anterior.tipo);
  const referencia = referenciaDeCaptura(anterior);
  const datos = { ...anterior, ...referencia, monto };
  validarElemento(DB, datos, true);
  validarCandadoMarca(DB, datos, anterior.id);

  const nueva = {
    id: siguienteId(DB.pos.objetivo_capturas),
    mes: anterior.mes,
    fecha: anterior.fecha,
    sucursal_id: anterior.sucursal_id,
    vendedor_id: anterior.vendedor_id,
    tipo: anterior.tipo,
    ...referencia,
    monto,
    capturado_por: usuario?.nombre || "desconocido",
    capturado_en: new Date().toISOString(),
    corrige_a: anterior.id,
    motivo: motivo.trim(),
    vigente: true,
  };

  anterior.vigente = false;
  DB.pos.objetivo_capturas.push(nueva);
  return nueva;
}

function capturadoDelMes(DB, { tipo = "venta", ...datos }) {
  return capturadoDelMesPor(DB, { ...datos, tipo });
}

function capturadoDelMesPor(DB, datos) {
  const { mes, tipo } = datos;
  const sucursal_id = normalizarId(datos.sucursal_id, "La sucursal");
  const vendedor_id = normalizarId(datos.vendedor_id, "El vendedor");
  const referencia = referenciaDeCaptura(datos);
  return DB.pos.objetivo_capturas
    .filter((captura) => captura.vigente &&
      mismaReferencia(captura, { tipo, ...referencia }) &&
      captura.mes === mes &&
      captura.sucursal_id === sucursal_id &&
      captura.vendedor_id === vendedor_id)
    .reduce((total, captura) => total + captura.monto, 0);
}

function diasSinCapturar(DB, { mes, sucursal_id, vendedor_id, hasta }) {
  if (!mesValido(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }
  if (!fechaValida(hasta) || !hasta.startsWith(`${mes}-`)) {
    throw new Error("La fecha hasta debe caer dentro del mes indicado");
  }

  const fechasCapturadas = new Set(DB.pos.objetivo_capturas
    .filter((captura) => captura.vigente &&
      captura.tipo === "venta" &&
      captura.mes === mes &&
      captura.sucursal_id === sucursal_id &&
      captura.vendedor_id === vendedor_id)
    .map((captura) => captura.fecha));
  const registros = DB.pos.objetivo_plantilla.filter((linea) =>
    linea.mes === mes && linea.sucursal_id === sucursal_id && linea.vendedor_id === vendedor_id
  );
  const faltantes = [];
  const intervalos = registros.length ? registros : [{ desde: `${mes}-01`, hasta: null }];
  for (const registro of intervalos) {
    const limite = registro.hasta && registro.hasta < hasta ? registro.hasta : hasta;
    for (let dia = Number(registro.desde.slice(8, 10)); dia <= Number(limite.slice(8, 10)); dia += 1) {
      const fecha = `${mes}-${String(dia).padStart(2, "0")}`;
      if (!fechasCapturadas.has(fecha)) faltantes.push(fecha);
    }
  }
  return [...new Set(faltantes)].sort();
}

module.exports = {
  capturarDia,
  corregirCaptura,
  capturadoDelMes,
  capturadoDelMesPor,
  diasSinCapturar,
};
