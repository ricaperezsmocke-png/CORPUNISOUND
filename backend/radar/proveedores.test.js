const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarNombreProveedor, listaProveedoresRadar, resolverProveedor, agruparPorProveedor,
} = require("./proveedores");

test("normaliza el nombre: minúsculas, sin acentos y espacios colapsados", () => {
  assert.equal(normalizarNombreProveedor("  Fénder   MÉXICO\t S.A. "), "fender mexico s.a.");
  assert.equal(normalizarNombreProveedor(null), "");
});

test("la lista junta las tiendas en una sola entrada por nombre normalizado y la ordena", () => {
  const lista = listaProveedoresRadar([
    { sucursal_id: 1, prv_id: "7", nombre: "Casa  Veerkamp" },
    { sucursal_id: 2, prv_id: "40", nombre: "casa veerkamp" },
    { sucursal_id: 2, prv_id: "41", nombre: "Ádamo Música" },
    { sucursal_id: 3, prv_id: "9", nombre: "   " },
    { sucursal_id: 3, prv_id: "10", nombre: null },
  ]);
  assert.deepEqual(lista, [
    { clave: "adamo musica", nombre: "Ádamo Música" },
    { clave: "casa veerkamp", nombre: "Casa Veerkamp" },
  ]);
  assert.deepEqual(listaProveedoresRadar(), []);
});

const LISTA = [{ clave: "casa veerkamp", nombre: "Casa Veerkamp" }, { clave: "yamaha", nombre: "Yamaha" }];

test("un proveedor de la lista se guarda con su nombre y sin revisar", () => {
  assert.deepEqual(resolverProveedor({ proveedor_clave: "yamaha" }, LISTA),
    { proveedor_clave: "yamaha", proveedor_nombre: "Yamaha", proveedor_por_revisar: false });
});

test("otro proveedor queda por revisar, con su nombre limpio", () => {
  assert.deepEqual(resolverProveedor({ proveedor_texto: "  Distribuidora   del Sur " }, LISTA),
    { proveedor_clave: "distribuidora del sur", proveedor_nombre: "Distribuidora del Sur", proveedor_por_revisar: true });
});

test("otro proveedor que ya está en la lista se toma de la lista", () => {
  assert.deepEqual(resolverProveedor({ proveedor_texto: "CASA VEERKAMP" }, LISTA),
    { proveedor_clave: "casa veerkamp", proveedor_nombre: "Casa Veerkamp", proveedor_por_revisar: false });
});

test("el proveedor que manda el navegador no es de fiar: falla cerrando", () => {
  const casos = [
    [{}, /proveedor/],
    [{ proveedor_clave: "" , proveedor_texto: "" }, /proveedor/],
    [{ proveedor_clave: "inventado" }, /no está en la lista/],
    [{ proveedor_clave: "Yamaha" }, /no está en la lista/],
    [{ proveedor_clave: ["yamaha"] }, /no es válido/],
    [{ proveedor_clave: 7 }, /no es válido/],
    [{ proveedor_texto: "x" }, /entre 2 y 120/],
    [{ proveedor_texto: "  y  " }, /entre 2 y 120/],
    [{ proveedor_texto: "a".repeat(121) }, /entre 2 y 120/],
    [{ proveedor_texto: "Casa\u0000Rara" }, /no es válido/],
    [{ proveedor_texto: "Casa �" }, /no es válido/],
    [{ proveedor_texto: { nombre: "x" } }, /no es válido/],
    [{ proveedor_clave: "yamaha", proveedor_texto: "Otro" }, /no los dos/],
    // Un nombre que en pantalla sale en blanco caería junto a las demandas viejas "Sin proveedor".
    [{ proveedor_texto: "​​" }, /no es válido/],
    [{ proveedor_texto: "Casa​Rara" }, /no es válido/],
    [{ proveedor_texto: "⁠­‮" }, /no es válido/],
    [{ proveedor_texto: "ㅤㅤ" }, /al menos 2 letras o números/],
    [{ proveedor_texto: "-- .." }, /al menos 2 letras o números/],
    [{ proveedor_texto: "a ." }, /al menos 2 letras o números/],
  ];
  for (const [datos, mensaje] of casos) {
    assert.throws(() => resolverProveedor(datos, LISTA), (e) => e.estatus === 400 && mensaje.test(e.message), JSON.stringify(datos));
  }
  assert.throws(() => resolverProveedor({ proveedor_clave: "yamaha" }, []), /no está en la lista/);
  assert.equal(resolverProveedor({ proveedor_texto: "ab" }, []).proveedor_nombre, "ab");
  assert.equal(resolverProveedor({ proveedor_texto: "a".repeat(120) }, []).proveedor_nombre.length, 120);
});

// Una pestaña abierta antes del despliegue traduce cualquier mensaje con "producto" a "Indica qué producto pidió el
// cliente." (y "motivo"/"describe" a otros avisos): el de proveedor faltante no puede llevar esas palabras.
test("sin proveedor, el mensaje se entiende solo y no lo confunde una pantalla vieja", () => {
  for (const datos of [{}, { proveedor_clave: "", proveedor_texto: "" }, { proveedor_clave: null }]) {
    assert.throws(() => resolverProveedor(datos, LISTA), (e) => {
      assert.equal(e.estatus, 400);
      assert.equal(e.message, "Campo obligatorio: elige el proveedor (si no aparece la opción, recarga la página)");
      assert.doesNotMatch(e.message, /producto|motivo|describe/i);
      return true;
    });
  }
});

function registro(id, cambios = {}) {
  return {
    id, sucursal_id: 1, producto_id: null, producto_buscado: "Cuerdas 010", marca_solicitada: "Ernie Ball",
    modelo_solicitado: "Regular Slinky", cantidad: 2, estado: "REGISTRADA", fecha_registro: "2026-10-20T18:00:00.000Z",
    proveedor_clave: "casa veerkamp", proveedor_nombre: "Casa Veerkamp", proveedor_por_revisar: false, ...cambios,
  };
}
const CONTEXTO = {
  fechaFin: "2026-10-23",
  sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }],
  productos: [{ id: 30, nombre: "Capotraste Kyser", sku: "KG6" }],
};

test("por proveedor: artículos con piezas, tiendas y días desde la demanda más vieja", () => {
  const grupos = agruparPorProveedor([
    registro(1),
    registro(2, { sucursal_id: 2, cantidad: 3, producto_buscado: "cuerdas  010", fecha_registro: "2026-10-03T18:00:00.000Z" }),
    registro(3, { producto_id: 30, producto_buscado: "", marca_solicitada: "", modelo_solicitado: "", cantidad: 1 }),
  ], CONTEXTO);
  assert.equal(grupos.length, 1);
  const [casa] = grupos;
  assert.deepEqual({ ...casa, articulos: undefined }, {
    clave: "casa veerkamp", nombre: "Casa Veerkamp", sin_proveedor: false, por_revisar: false,
    solicitudes: 3, solicitudes_por_revisar: 0, piezas: 6, sucursales: ["Ocosingo", "Yajalón"], dias_mas_vieja: 20,
    articulos: undefined,
  });
  assert.deepEqual(casa.articulos, [
    { producto_id: null, descripcion: "Cuerdas 010", marca: "Ernie Ball", modelo: "Regular Slinky", solicitudes: 2, piezas: 5,
      sucursales: ["Ocosingo", "Yajalón"], dias_mas_vieja: 20 },
    { producto_id: 30, descripcion: "Capotraste Kyser", marca: "", modelo: "", solicitudes: 1, piezas: 1,
      sucursales: ["Ocosingo"], dias_mas_vieja: 3 },
  ]);
});

test("por proveedor: solo pendientes; sin proveedor al final; otro proveedor marcado por revisar", () => {
  const grupos = agruparPorProveedor([
    registro(1, { estado: "CONVERTIDA" }),
    registro(2, { estado: "CANCELADA" }),
    registro(3, { estado: "NO_CONVERTIDA" }),
    registro(4, { estado: "EN_SEGUIMIENTO", cantidad: 1 }),
    registro(5, { estado: "RARO" }),
    registro(6, { proveedor_clave: undefined, proveedor_nombre: undefined, proveedor_por_revisar: undefined, cantidad: 9 }),
    registro(7, { proveedor_clave: "distribuidora del sur", proveedor_nombre: "Distribuidora del Sur", proveedor_por_revisar: true }),
    registro(8, { estado: "PRODUCTO_DISPONIBLE", cantidad: 1 }),
    registro(9, { estado: "CLIENTE_CONTACTADO", cantidad: 1 }),
  ], CONTEXTO);
  assert.deepEqual(grupos.map((g) => [g.nombre, g.piezas, g.por_revisar, g.sin_proveedor]), [
    ["Casa Veerkamp", 3, false, false],
    ["Distribuidora del Sur", 2, true, false],
    ["Sin proveedor", 9, false, true],
  ]);
  assert.equal(grupos[2].clave, null);
  assert.equal(grupos[1].solicitudes_por_revisar, 1);
});

test("por proveedor: una fecha que no se entiende no inventa días", () => {
  const [grupo] = agruparPorProveedor([registro(1, { fecha_registro: "no es fecha" })], CONTEXTO);
  assert.equal(grupo.dias_mas_vieja, null);
  assert.equal(grupo.articulos[0].dias_mas_vieja, null);
});
