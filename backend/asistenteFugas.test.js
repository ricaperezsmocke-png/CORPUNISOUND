/**
 * asistenteFugas.test.js — Lo que el Asistente de IA NO puede entregar.
 *
 * `consultarModulo` acepta un nombre de tabla y devuelve las filas CRUDAS al
 * navegador (server.js las mete en `consultas` de la respuesta). El rol Cajero
 * tiene `usar_asistente_ia`, así que esa herramienta es una puerta lateral a
 * cualquier dato del sistema.
 *
 * Lo que salía por ahí, verificado en la auditoría: `admin.usuarios` COMPLETO,
 * con los hashes de contraseña de las compañeras y del dueño; los costos y
 * márgenes de los 6,229 productos; y los enlaces de Drive a los expedientes del
 * personal (actas, identificaciones).
 *
 * La lista era NEGRA, que es la forma equivocada para un límite de seguridad:
 * cada tabla nueva nacía expuesta. Ahora es BLANCA y lo nuevo nace negado.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { consultarModulo, tablasConsultables, TABLAS_PERMITIDAS } = require("./consultarModulo");

/** Un DB con TODAS las tablas pobladas. Poblarlas importa: una tabla vacía da
 *  un falso "seguro" porque no hay fila que inspeccionar. */
function nuevoDB() {
  return {
    admin: {
      usuarios: [{ id: 1, nombre: "Victor", usuario: "victor", password_hash: "$2b$10$HASH-SECRETO", rol_id: 1, sucursal_id: 1 }],
      roles: [{ id: 1, nombre: "Administrador", permisos: ["todo"] }],
      documentos_personal: [{ id: 1, usuario_id: 1, categoria: "acta_nacimiento", drive_file_id: "ID-SECRETO", drive_link: "https://drive.google.com/x" }],
      intentos_bloqueados_ubicacion: [{ id: 1, usuario: "ana" }],
    },
    drive: { cuenta: { access_token: "TOKEN-DRIVE", refresh_token: "REFRESH-ETERNO" } },
    ml: {
      cuenta: { access_token: "TOKEN-ML", refresh_token: "REFRESH-ML" },
      publicaciones: [{ ml_item_id: "MLM1", producto_id: 1, precio: 100 }],
      ordenes_importadas: [],
    },
    respaldos: { copias: [{ id: 1, nombre_archivo: "x.respaldo", drive_file_id: "SECRETO" }], movimientos: [] },
    "catalogo-productos": {
      productos: [{ id: 1, nombre: "Guitarra", costo: 9000, precio_venta: 15000, precios: [{ utilidad: 40, precioVenta: 15000 }] }],
      categorias: [], proveedores: [], departamentos: [], producto_proveedor: [],
    },
    pos: {
      ventas: [{ id: 1, sucursal_id: 1, total: 100 }],
      venta_detalle: [{ id: 1, venta_id: 1, producto_id: 1 }],
      vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1, meta_mensual: 50000 }],
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      cortes_caja: [], condiciones_pago: [], apartado_abonos: [],
      tareas_venta: { tareas: [], ultimo_id: 0 },
      configuracion: { cerrar_venta_con_enter: true },
    },
    crm: { clientes: [{ id: 1, nombre: "Cliente", sucursal_id: 1 }], contactos_cliente: [], oportunidades: [] },
    gastos: { gastos: [], categorias: [], gasto_movimientos: [], ultimo_id: 0 },
    cuenta_comun: { depositos: [], deposito_movimientos: [], ultimo_id: 0 },
    inventario: {
      existencias: [{ producto_id: 1, sucursal_id: 1, cantidad_actual: 5 }],
      movimientos_inventario: [], compras: [], compra_detalle: [],
      traspasos: [], garantias: [], garantia_movimientos: [], garantia_gastos: [],
    },
  };
}

const CAJERA = { verTodas: false, sucursalId: 1 };
const ADMIN = { verTodas: true, sucursalId: 1 };
const PERMISOS_CAJERA = ["usar_asistente_ia", "cerrar_venta"];
const PERMISOS_ADMIN = ["usar_asistente_ia", "ver_reportes", "ver_todas_las_sucursales"];

function pedir(modulo, tabla, alcance = CAJERA, permisos = PERMISOS_CAJERA) {
  return consultarModulo({ modulo, tabla }, alcance, nuevoDB(), permisos);
}

// ---------- Lo que NUNCA debe salir ----------

test("las CONTRASEÑAS no salen por el asistente", () => {
  // Lo más grave de la auditoría: una cajera pedía `admin.usuarios` y recibía
  // el hash del dueño. No es la contraseña en texto, pero es la huella con la
  // que se puede intentar adivinarla sin límite y sin que nadie se entere.
  assert.throws(() => pedir("admin", "usuarios"), /no está disponible|no existe/i);
});

test("los EXPEDIENTES del personal no salen", () => {
  // Actas de nacimiento e identificaciones, con su enlace de Drive.
  assert.throws(() => pedir("admin", "documentos_personal"), /no está disponible|no existe/i);
});

test("el mapa de permisos no sale", () => {
  assert.throws(() => pedir("admin", "roles"), /no está disponible|no existe/i);
});

test("los TOKENS de Google Drive y MercadoLibre no salen", () => {
  // Antes no salían por accidente —son objetos y no arreglos, y el código
  // reventaba antes de devolverlos—, pero eso era suerte, no un candado.
  assert.throws(() => pedir("drive", "cuenta"), /no está disponible|no existe/i);
  assert.throws(() => pedir("ml", "cuenta"), /no existe/i);
});

test("el índice de respaldos no sale", () => {
  assert.throws(() => pedir("respaldos", "copias"), /no está disponible|no existe/i);
});

test("un módulo entero que no esté en la lista se niega, y se dice cuáles sí", () => {
  try {
    pedir("admin", "usuarios");
    assert.fail("debió negarse");
  } catch (e) {
    assert.match(e.message, /Disponibles:/);
    // El mensaje repite el módulo pedido (así el modelo se corrige solo), pero
    // la lista de disponibles NO debe ofrecerlo.
    const disponibles = e.message.split("Disponibles:")[1];
    assert.ok(!disponibles.includes("admin"), `la lista ofrece un módulo negado: ${disponibles}`);
    assert.ok(disponibles.includes("pos"), "y sí debe ofrecer los legítimos");
  }
});

// ---------- Lo NUEVO nace negado ----------

test("una tabla que existe en el DB pero NO está en la lista blanca se niega", () => {
  // Es la razón de ser del cambio: con lista negra, cada tabla nueva nacía
  // expuesta y había que acordarse de taparla. Ya falló dos veces.
  assert.throws(() => pedir("pos", "configuracion"), /no existe/i);
  assert.throws(() => pedir("crm", "oportunidades"), /no existe/i);
  assert.throws(() => pedir("admin", "intentos_bloqueados_ubicacion"), /no está disponible|no existe/i);
});

test("lo que se le ANUNCIA al modelo es exactamente lo que puede leer", () => {
  // Si se le anuncian tablas que no puede leer, las intenta una y otra vez y
  // gasta turnos en errores. Y anunciar `admin.usuarios` era decirle al modelo
  // dónde estaban las contraseñas.
  const anunciadas = tablasConsultables(nuevoDB());
  const modulos = anunciadas.map((m) => m.id);
  for (const prohibido of ["admin", "drive", "respaldos"]) {
    assert.ok(!modulos.includes(prohibido), `no debe anunciarse ${prohibido}`);
  }
  for (const m of anunciadas) {
    for (const t of m.tablas) {
      assert.ok(
        TABLAS_PERMITIDAS[m.id].includes(t),
        `se anuncia ${m.id}.${t} y no está permitida`,
      );
      assert.doesNotThrow(() => pedir(m.id, t, ADMIN, PERMISOS_ADMIN), `${m.id}.${t} se anuncia pero no se puede leer`);
    }
  }
});

// ---------- Costos y márgenes: según quién pregunte ----------

test("una cajera NO ve el costo ni el margen de los productos", () => {
  // Con eso se sabe lo que Victor paga por cada cosa.
  const filas = pedir("catalogo-productos", "productos");
  assert.strictEqual(filas[0].costo, undefined, "el costo no debe salir");
  assert.strictEqual(filas[0].precios[0].utilidad, undefined, "el margen tampoco");
  // Lo que SÍ necesita para trabajar sigue ahí.
  assert.strictEqual(filas[0].precio_venta, 15000);
  assert.strictEqual(filas[0].nombre, "Guitarra");
});

test("quien puede ver Reportes SÍ ve costo y margen", () => {
  // Es el mismo dato que ya muestra el reporte de utilidad: negárselo aquí
  // sería incoherente y le quitaría al dueño la pregunta que más le importa.
  const filas = pedir("catalogo-productos", "productos", ADMIN, PERMISOS_ADMIN);
  assert.strictEqual(filas[0].costo, 9000);
  assert.strictEqual(filas[0].precios[0].utilidad, 40);
});

test("la meta mensual de las vendedoras sigue oculta", () => {
  // Era el único campo protegido antes; no se perdió en el cambio.
  const filas = pedir("pos", "vendedores");
  assert.strictEqual(filas[0].meta_mensual, undefined);
  assert.strictEqual(filas[0].nombre, "Ana", "el nombre sí, es lo que el asistente necesita");
});

// ---------- Lo que SÍ debe seguir funcionando ----------

test("el asistente sigue pudiendo responder sobre el negocio", () => {
  // Un candado que rompe la herramienta no sirve de nada.
  assert.ok(Array.isArray(pedir("pos", "ventas")));
  assert.ok(Array.isArray(pedir("crm", "clientes")));
  assert.ok(Array.isArray(pedir("inventario", "existencias")));
  assert.ok(Array.isArray(pedir("catalogo-productos", "productos")));
  assert.ok(Array.isArray(pedir("gastos", "gastos")));
});

test("el alcance por sucursal se sigue aplicando encima de todo esto", () => {
  const DB = nuevoDB();
  DB.crm.clientes.push({ id: 2, nombre: "De Yajalón", sucursal_id: 2 });
  const filas = consultarModulo({ modulo: "crm", tabla: "clientes" }, CAJERA, DB, PERMISOS_CAJERA);
  assert.ok(filas.every((c) => c.sucursal_id === 1), "no debe colarse otra sucursal");
});
