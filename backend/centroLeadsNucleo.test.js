const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const {
  VERSION_ESQUEMA,
  MIGRACIONES,
  inicializarPersistenciaCentroLeads,
} = require("./centroLeads/persistencia");
const {
  crearLead,
  obtenerLead,
  actualizarLead,
  cambiarEstadoLead,
} = require("./centroLeads/leads");
const { obtenerHistorialLead } = require("./centroLeads/historial");
const {
  agregarSeguimiento,
  listarSeguimientosLead,
} = require("./centroLeads/seguimientos");
const {
  ESTADOS_TERMINALES,
  ESTADOS_LEAD,
  validarTransicion,
} = require("./centroLeads/validaciones");

const AHORA = "2026-08-21T15:30:00.000Z";

function conBase(fn) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-nucleo-"));
  const ruta = path.join(carpeta, "datos.sqlite");
  const sqlite = new Database(ruta);
  inicializarPersistenciaCentroLeads(sqlite);
  try {
    return fn(sqlite, { carpeta, ruta });
  } finally {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function contexto(usuarioId = 7, ahora = AHORA) {
  return { usuario_id: usuarioId, ahora: () => new Date(ahora) };
}

test("crearLead persiste datos normalizados con estado NUEVO y origen separado de asignación", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {
      nombre: "  Ana Pérez  ",
      telefono: "+52 (961) 123-4567",
      email: " ANA@EJEMPLO.COM ",
      cliente_id: 91,
      producto_id: 42,
      interes: "  Consola digital  ",
      ubicacion: "  Tuxtla  ",
      origen: "mostrador",
      vendedor_origen_id: 11,
      sucursal_origen_id: 2,
      vendedor_asignado_id: 15,
      sucursal_asignada_id: 3,
    }, contexto());

    assert.strictEqual(lead.id, 1);
    assert.strictEqual(lead.estado, "NUEVO");
    assert.strictEqual(lead.nombre, "Ana Pérez");
    assert.strictEqual(lead.telefono, "+529611234567");
    assert.strictEqual(lead.email, "ana@ejemplo.com");
    assert.strictEqual(lead.interes, "Consola digital");
    assert.strictEqual(lead.ubicacion, "Tuxtla");
    assert.strictEqual(lead.vendedor_origen_id, 11);
    assert.strictEqual(lead.sucursal_origen_id, 2);
    assert.strictEqual(lead.vendedor_asignado_id, 15);
    assert.strictEqual(lead.sucursal_asignada_id, 3);
    assert.strictEqual(lead.creado_en, AHORA);
    assert.strictEqual(lead.actualizado_en, AHORA);
    assert.strictEqual(lead.ultima_interaccion_en, AHORA);
  });
});

test("crearLead permite cliente, teléfono, email y producto ausentes", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, { origen: "manual" }, contexto());

    assert.strictEqual(lead.cliente_id, null);
    assert.strictEqual(lead.producto_id, null);
    assert.strictEqual(lead.telefono, null);
    assert.strictEqual(lead.email, null);
  });
});

test("obtenerLead devuelve el lead persistido y rechaza un ID inexistente", () => {
  conBase((sqlite) => {
    crearLead(sqlite, { nombre: "Laura" }, contexto());

    assert.strictEqual(obtenerLead(sqlite, 1).nombre, "Laura");
    assert.throws(() => obtenerLead(sqlite, 999), /lead.*no existe/i);
  });
});

test("crearLead registra LEAD_CREADO dentro del historial", () => {
  conBase((sqlite) => {
    crearLead(sqlite, { nombre: "Luis" }, contexto());

    const historial = obtenerHistorialLead(sqlite, 1);
    assert.strictEqual(historial.length, 1);
    assert.strictEqual(historial[0].tipo, "LEAD_CREADO");
    assert.strictEqual(historial[0].actor_usuario_id, 7);
    assert.strictEqual(historial[0].ocurrido_en, AHORA);
  });
});

test("actualizarLead modifica solamente campos permitidos y registra valores anteriores y nuevos", () => {
  conBase((sqlite) => {
    crearLead(sqlite, { nombre: "Luis", producto_id: 10 }, contexto());

    const actualizado = actualizarLead(sqlite, 1, {
      nombre: "  Luis Alberto ",
      telefono: "961 222 3344",
      email: "LUIS@EJEMPLO.COM",
      cliente_id: 8,
      producto_id: 12,
      interes: "Mezcladora",
      ubicacion: "Ocosingo",
      prioridad: "alta",
    }, contexto(9, "2026-08-21T16:00:00.000Z"));

    assert.strictEqual(actualizado.nombre, "Luis Alberto");
    assert.strictEqual(actualizado.telefono, "9612223344");
    assert.strictEqual(actualizado.email, "luis@ejemplo.com");
    assert.strictEqual(actualizado.actualizado_en, "2026-08-21T16:00:00.000Z");
    const evento = obtenerHistorialLead(sqlite, 1)[1];
    assert.strictEqual(evento.tipo, "DATOS_ACTUALIZADOS");
    assert.deepStrictEqual(evento.datos.cambios.nombre, { anterior: "Luis", nuevo: "Luis Alberto" });
    assert.deepStrictEqual(evento.datos.cambios.producto_id, { anterior: 10, nuevo: 12 });
  });
});

test("actualizarLead protege identidad, estado, fechas, origen, asignación e historial", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {
      origen: "facebook",
      vendedor_origen_id: 1,
      sucursal_origen_id: 2,
      vendedor_asignado_id: 3,
      sucursal_asignada_id: 4,
    }, contexto());
    const protegidos = [
      "id", "estado", "creado_en", "actualizado_en", "ultima_interaccion_en",
      "cerrado_en", "origen", "vendedor_origen_id", "sucursal_origen_id",
      "vendedor_asignado_id", "sucursal_asignada_id", "historial",
    ];

    for (const campo of protegidos) {
      assert.throws(
        () => actualizarLead(sqlite, 1, { [campo]: "alterado" }, contexto()),
        new RegExp(`${campo}.*protegido`, "i")
      );
    }
    const lead = obtenerLead(sqlite, 1);
    assert.strictEqual(lead.origen, "facebook");
    assert.strictEqual(lead.vendedor_origen_id, 1);
    assert.strictEqual(lead.vendedor_asignado_id, 3);
    assert.strictEqual(obtenerHistorialLead(sqlite, 1).length, 1);
  });
});

test("actualizarLead sin cambios efectivos no crea historial artificial", () => {
  conBase((sqlite) => {
    crearLead(sqlite, { nombre: "Eva" }, contexto());

    actualizarLead(sqlite, 1, { nombre: " Eva " }, contexto());

    assert.strictEqual(obtenerHistorialLead(sqlite, 1).length, 1);
  });
});

test("validaciones rechazan IDs lógicos, teléfono y email inválidos", () => {
  conBase((sqlite) => {
    assert.throws(() => crearLead(sqlite, { cliente_id: 0 }, contexto()), /cliente_id.*entero positivo/i);
    assert.throws(() => crearLead(sqlite, { telefono: "123" }, contexto()), /teléfono.*7.*15/i);
    assert.throws(() => crearLead(sqlite, { email: "correo-invalido" }, contexto()), /email.*formato/i);
  });
});

test("cambiarEstadoLead recorre la ruta comercial y registra cada transición", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    const ruta = ["ASIGNADO", "CONTACTADO", "CALIFICADO", "COTIZACION", "NEGOCIACION", "GANADO"];

    for (const estado of ruta) cambiarEstadoLead(sqlite, 1, estado, contexto());

    const lead = obtenerLead(sqlite, 1);
    assert.strictEqual(lead.estado, "GANADO");
    assert.strictEqual(lead.cerrado_en, AHORA);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_relaciones_ventas").pluck().get(), 0);
    const cambios = obtenerHistorialLead(sqlite, 1).filter((evento) => evento.tipo === "CAMBIO_ESTADO");
    assert.strictEqual(cambios.length, 6);
    assert.deepStrictEqual(cambios[0].datos, { estado_anterior: "NUEVO", estado_nuevo: "ASIGNADO" });
    assert.deepStrictEqual(cambios[5].datos, { estado_anterior: "NEGOCIACION", estado_nuevo: "GANADO" });
  });
});

test("COTIZACION puede cerrar directamente como GANADO sin venta asociada", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    for (const estado of ["ASIGNADO", "CONTACTADO", "CALIFICADO", "COTIZACION", "GANADO"]) {
      cambiarEstadoLead(sqlite, 1, estado, contexto());
    }
    assert.strictEqual(obtenerLead(sqlite, 1).estado, "GANADO");
  });
});

test("una transición inválida o un estado arbitrario no modifica el lead ni el historial", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());

    assert.throws(() => cambiarEstadoLead(sqlite, 1, "CONTACTADO", contexto()), /transición.*no permitida/i);
    assert.throws(() => cambiarEstadoLead(sqlite, 1, "INVENTADO", contexto()), /estado.*inválido/i);
    assert.throws(() => cambiarEstadoLead(sqlite, 1, "NUEVO", contexto()), /transición.*no permitida/i);
    assert.strictEqual(obtenerLead(sqlite, 1).estado, "NUEVO");
    assert.strictEqual(obtenerHistorialLead(sqlite, 1).length, 1);
  });
});

test("los cinco estados terminales no tienen transiciones de salida", () => {
  assert.deepStrictEqual(ESTADOS_TERMINALES, [
    "GANADO", "PERDIDO", "NO_RESPONDE", "NO_CALIFICADO", "DUPLICADO",
  ]);
  for (const terminal of ESTADOS_TERMINALES) {
    assert.throws(() => validarTransicion(terminal, "ASIGNADO"), /transición.*no permitida/i);
  }
});

test("la máquina de estados acepta exactamente la matriz comercial aprobada", () => {
  const permitidas = {
    NUEVO: ["ASIGNADO", "NO_CALIFICADO", "DUPLICADO"],
    ASIGNADO: ["CONTACTADO", "NO_RESPONDE", "NO_CALIFICADO", "PERDIDO", "DUPLICADO"],
    CONTACTADO: ["CALIFICADO", "NO_RESPONDE", "NO_CALIFICADO", "PERDIDO", "DUPLICADO"],
    CALIFICADO: ["COTIZACION", "PERDIDO", "DUPLICADO"],
    COTIZACION: ["NEGOCIACION", "GANADO", "PERDIDO", "DUPLICADO"],
    NEGOCIACION: ["GANADO", "PERDIDO", "DUPLICADO"],
    GANADO: [],
    PERDIDO: [],
    NO_RESPONDE: [],
    NO_CALIFICADO: [],
    DUPLICADO: [],
  };

  for (const actual of ESTADOS_LEAD) {
    for (const siguiente of ESTADOS_LEAD) {
      if (permitidas[actual].includes(siguiente)) {
        assert.strictEqual(validarTransicion(actual, siguiente), siguiente);
      } else {
        assert.throws(() => validarTransicion(actual, siguiente), /transición.*no permitida/i);
      }
    }
  }
});

test("DUPLICADO es terminal sin ejecutar detección ni fusión", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    cambiarEstadoLead(sqlite, 1, "DUPLICADO", contexto());

    assert.throws(() => cambiarEstadoLead(sqlite, 1, "ASIGNADO", contexto()), /transición.*no permitida/i);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_fusiones").pluck().get(), 0);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_posibles_duplicados").pluck().get(), 0);
  });
});

test("si falla el historial, cambiarEstadoLead revierte estado y fecha de cierre", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    sqlite.exec(`
      CREATE TRIGGER bloquear_historial_estado
      BEFORE INSERT ON lead_historial
      BEGIN SELECT RAISE(ABORT, 'historial bloqueado'); END
    `);

    assert.throws(() => cambiarEstadoLead(sqlite, 1, "DUPLICADO", contexto()), /historial bloqueado/);
    const lead = obtenerLead(sqlite, 1);
    assert.strictEqual(lead.estado, "NUEVO");
    assert.strictEqual(lead.cerrado_en, null);
    assert.strictEqual(obtenerHistorialLead(sqlite, 1).length, 1);
  });
});

test("agregarSeguimiento exige comentario, normaliza UTC y admite próxima fecha opcional", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    assert.throws(
      () => agregarSeguimiento(sqlite, 1, { usuario_id: 4, fecha: AHORA, comentario: "  " }, contexto()),
      /comentario.*obligatorio/i
    );

    const seguimiento = agregarSeguimiento(sqlite, 1, {
      usuario_id: 4,
      fecha: "2026-08-21T10:30:00-06:00",
      comentario: "  Llamada contestada  ",
      proxima_fecha: "2026-08-23T09:00:00-06:00",
    }, contexto());
    const sinProxima = agregarSeguimiento(sqlite, 1, {
      usuario_id: 4,
      fecha: "2026-08-21T17:00:00.000Z",
      comentario: "Envió información",
    }, contexto());

    assert.strictEqual(seguimiento.usuario_id, 4);
    assert.strictEqual(seguimiento.fecha, "2026-08-21T16:30:00.000Z");
    assert.strictEqual(seguimiento.comentario, "Llamada contestada");
    assert.strictEqual(seguimiento.proxima_fecha, "2026-08-23T15:00:00.000Z");
    assert.strictEqual(sinProxima.proxima_fecha, null);
  });
});

test("seguimiento actualiza última interacción solo cuando su fecha es posterior", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    agregarSeguimiento(sqlite, 1, {
      usuario_id: 4,
      fecha: "2026-08-20T10:00:00.000Z",
      comentario: "Seguimiento anterior",
    }, contexto());
    assert.strictEqual(obtenerLead(sqlite, 1).ultima_interaccion_en, AHORA);

    agregarSeguimiento(sqlite, 1, {
      usuario_id: 4,
      fecha: "2026-08-22T10:00:00.000Z",
      comentario: "Seguimiento posterior",
    }, contexto());
    assert.strictEqual(obtenerLead(sqlite, 1).ultima_interaccion_en, "2026-08-22T10:00:00.000Z");
  });
});

test("seguimientos generan historial append-only y se listan por fecha e ID", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    agregarSeguimiento(sqlite, 1, {
      usuario_id: 4, fecha: "2026-08-22T10:00:00.000Z", comentario: "Segundo cronológico",
    }, contexto());
    agregarSeguimiento(sqlite, 1, {
      usuario_id: 4, fecha: "2026-08-21T18:00:00.000Z", comentario: "Primero cronológico",
    }, contexto());

    assert.deepStrictEqual(
      listarSeguimientosLead(sqlite, 1).map((s) => s.comentario),
      ["Primero cronológico", "Segundo cronológico"]
    );
    assert.deepStrictEqual(
      obtenerHistorialLead(sqlite, 1).map((evento) => evento.tipo),
      ["LEAD_CREADO", "SEGUIMIENTO_AGREGADO", "SEGUIMIENTO_AGREGADO"]
    );
  });
});

test("si falla el historial, agregarSeguimiento revierte seguimiento y última interacción", () => {
  conBase((sqlite) => {
    crearLead(sqlite, {}, contexto());
    sqlite.exec(`
      CREATE TRIGGER bloquear_historial_seguimiento
      BEFORE INSERT ON lead_historial
      BEGIN SELECT RAISE(ABORT, 'historial bloqueado'); END
    `);

    assert.throws(() => agregarSeguimiento(sqlite, 1, {
      usuario_id: 4,
      fecha: "2026-08-22T10:00:00.000Z",
      comentario: "No debe persistir",
    }, contexto()), /historial bloqueado/);
    assert.strictEqual(listarSeguimientosLead(sqlite, 1).length, 0);
    assert.strictEqual(obtenerLead(sqlite, 1).ultima_interaccion_en, AHORA);
  });
});

test("dos leads mantienen datos, historial y seguimientos independientes", () => {
  conBase((sqlite) => {
    crearLead(sqlite, { nombre: "Uno" }, contexto());
    crearLead(sqlite, { nombre: "Dos" }, contexto());
    cambiarEstadoLead(sqlite, 1, "ASIGNADO", contexto());
    agregarSeguimiento(sqlite, 2, { usuario_id: 4, fecha: AHORA, comentario: "Solo lead dos" }, contexto());

    assert.strictEqual(obtenerLead(sqlite, 1).estado, "ASIGNADO");
    assert.strictEqual(obtenerLead(sqlite, 2).estado, "NUEVO");
    assert.strictEqual(listarSeguimientosLead(sqlite, 1).length, 0);
    assert.strictEqual(listarSeguimientosLead(sqlite, 2).length, 1);
  });
});

test("migración V2 actualiza una base V1, es idempotente y conserva datos", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-v1-"));
  const ruta = path.join(carpeta, "datos.sqlite");
  const sqlite = new Database(ruta);
  try {
    inicializarPersistenciaCentroLeads(sqlite, { migraciones: [MIGRACIONES[0]] });
    sqlite.prepare(`
      INSERT INTO leads (estado, creado_en, actualizado_en, ultima_interaccion_en)
      VALUES ('NUEVO', ?, ?, ?)
    `).run(AHORA, AHORA, AHORA);

    assert.strictEqual(
      sqlite.prepare("SELECT version FROM centro_leads_schema_version WHERE id = 1").pluck().get(),
      1
    );
    inicializarPersistenciaCentroLeads(sqlite);
    inicializarPersistenciaCentroLeads(sqlite);

    assert.strictEqual(
      sqlite.prepare("SELECT version FROM centro_leads_schema_version WHERE id = 1").pluck().get(),
      VERSION_ESQUEMA
    );
    assert.strictEqual(obtenerLead(sqlite, 1).estado, "NUEVO");
    assert.strictEqual(obtenerLead(sqlite, 1).nombre, null);
    assert.ok(sqlite.prepare("PRAGMA table_info(lead_seguimientos)").all().some((c) => c.name === "proxima_fecha"));
    assert.strictEqual(MIGRACIONES[0].version, 1);
    assert.strictEqual(MIGRACIONES[1].version, 2);
  } finally {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("lead e historial permanecen después de cerrar y reabrir SQLite", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-reinicio-"));
  const ruta = path.join(carpeta, "datos.sqlite");
  try {
    let sqlite = new Database(ruta);
    inicializarPersistenciaCentroLeads(sqlite);
    crearLead(sqlite, { nombre: "Reinicio" }, contexto());
    cambiarEstadoLead(sqlite, 1, "ASIGNADO", contexto());
    sqlite.close();

    sqlite = new Database(ruta);
    inicializarPersistenciaCentroLeads(sqlite);
    assert.strictEqual(obtenerLead(sqlite, 1).estado, "ASIGNADO");
    assert.strictEqual(obtenerHistorialLead(sqlite, 1).length, 2);
    sqlite.close();
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("operaciones del núcleo no modifican el documento JSON, CRM, ventas ni productos", () => {
  conBase((sqlite) => {
    const documento = JSON.stringify({
      crm: { clientes: [{ id: 4, nombre: "Cliente maestro" }] },
      pos: { ventas: [{ id: 8 }], productos: [{ id: 12, nombre: "Producto" }] },
    });
    sqlite.exec(`
      CREATE TABLE estado (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        datos TEXT NOT NULL,
        actualizado TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    sqlite.prepare("INSERT INTO estado (id, datos) VALUES (1, ?)").run(documento);

    crearLead(sqlite, { cliente_id: 4, producto_id: 12 }, contexto());
    actualizarLead(sqlite, 1, { interes: "Interés comercial" }, contexto());
    cambiarEstadoLead(sqlite, 1, "ASIGNADO", contexto());
    agregarSeguimiento(sqlite, 1, { usuario_id: 7, fecha: AHORA, comentario: "Contacto" }, contexto());

    assert.strictEqual(sqlite.prepare("SELECT datos FROM estado WHERE id = 1").pluck().get(), documento);
  });
});
