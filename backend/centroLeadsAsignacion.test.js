const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const { inicializarPersistenciaCentroLeads } = require("./centroLeads/persistencia");
const { crearLead, obtenerLead } = require("./centroLeads/leads");
const { obtenerHistorialLead } = require("./centroLeads/historial");
const {
  asignarLead,
  reasignarLead,
  obtenerAsignacionActual,
  listarAsignaciones,
  evaluarCreadorPrioritario,
} = require("./centroLeads/asignaciones");

const AHORA = "2026-08-21T18:00:00.000Z";

function contexto(usuarioId = 7, ahora = AHORA) {
  return { usuario_id: usuarioId, ahora: () => new Date(ahora) };
}

function conBase(fn) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-asignacion-"));
  const sqlite = new Database(path.join(carpeta, "datos.sqlite"));
  inicializarPersistenciaCentroLeads(sqlite);
  try {
    return fn(sqlite);
  } finally {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

test("asignarLead crea la asignación activa y lleva NUEVO a ASIGNADO atómicamente", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {}, contexto());
    const asignacion = asignarLead(sqlite, lead.id, {
      vendedor_id: 11,
      sucursal_id: 2,
      regla: "CREADOR_PRIORITARIO",
    }, contexto());

    assert.strictEqual(asignacion.vendedor_id, 11);
    assert.strictEqual(asignacion.sucursal_id, 2);
    assert.strictEqual(asignacion.finalizada_en, null);
    assert.strictEqual(obtenerLead(sqlite, lead.id).estado, "ASIGNADO");
    assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_asignado_id, 11);
    assert.strictEqual(obtenerLead(sqlite, lead.id).sucursal_asignada_id, 2);
    assert.strictEqual(obtenerAsignacionActual(sqlite, lead.id).id, asignacion.id);
    assert.deepStrictEqual(
      obtenerHistorialLead(sqlite, lead.id).map((evento) => evento.tipo),
      ["LEAD_CREADO", "ASIGNACION_REALIZADA", "CAMBIO_ESTADO"]
    );
  });
});

test("asignación nunca modifica vendedor ni sucursal de origen", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {
      vendedor_origen_id: 11,
      sucursal_origen_id: 2,
    }, contexto());
    asignarLead(sqlite, lead.id, {
      vendedor_id: 22,
      sucursal_id: 3,
      regla: "GEOGRAFIA_CLIENTE",
    }, contexto());

    const actualizado = obtenerLead(sqlite, lead.id);
    assert.strictEqual(actualizado.vendedor_origen_id, 11);
    assert.strictEqual(actualizado.sucursal_origen_id, 2);
    assert.strictEqual(actualizado.vendedor_asignado_id, 22);
    assert.strictEqual(actualizado.sucursal_asignada_id, 3);
  });
});

test("reasignarLead finaliza la anterior, exige motivo y conserva el mérito histórico", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, { vendedor_origen_id: 11, sucursal_origen_id: 2 }, contexto());
    asignarLead(sqlite, lead.id, { vendedor_id: 11, sucursal_id: 2, regla: "CREADOR_PRIORITARIO" }, contexto());
    assert.throws(() => reasignarLead(sqlite, lead.id, {
      vendedor_id: 22, sucursal_id: 3, regla: "SUPERVISOR", motivo: "  ",
    }, contexto()), /motivo.*obligatorio/i);

    const nueva = reasignarLead(sqlite, lead.id, {
      vendedor_id: 22,
      sucursal_id: 3,
      regla: "SUPERVISOR",
      motivo: "Atención geográfica en Palenque",
    }, contexto(8, "2026-08-21T19:00:00.000Z"));

    const asignaciones = listarAsignaciones(sqlite, lead.id);
    assert.strictEqual(asignaciones.length, 2);
    assert.strictEqual(asignaciones[0].finalizada_en, "2026-08-21T19:00:00.000Z");
    assert.strictEqual(nueva.vendedor_id, 22);
    const actualizado = obtenerLead(sqlite, lead.id);
    assert.strictEqual(actualizado.vendedor_origen_id, 11);
    assert.strictEqual(actualizado.sucursal_origen_id, 2);
    assert.strictEqual(actualizado.vendedor_asignado_id, 22);
    assert.strictEqual(actualizado.sucursal_asignada_id, 3);
    const evento = obtenerHistorialLead(sqlite, lead.id).find((e) => e.tipo === "REASIGNACION_REALIZADA");
    assert.deepStrictEqual(evento.datos, {
      vendedor_anterior_id: 11,
      vendedor_nuevo_id: 22,
      sucursal_anterior_id: 2,
      sucursal_nueva_id: 3,
      regla: "SUPERVISOR",
      motivo: "Atención geográfica en Palenque",
    });
  });
});

test("solo puede existir una asignación activa por lead", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {}, contexto());
    asignarLead(sqlite, lead.id, { vendedor_id: 11, sucursal_id: 2, regla: "MANUAL" }, contexto());

    assert.throws(
      () => asignarLead(sqlite, lead.id, { vendedor_id: 22, sucursal_id: 3, regla: "MANUAL" }, contexto()),
      /ya tiene una asignación activa/i
    );
    assert.throws(() => sqlite.prepare(`
      INSERT INTO lead_asignaciones
        (lead_id, vendedor_asignado_id, sucursal_asignada_id, regla, asignada_en)
      VALUES (?, 33, 4, 'DIRECTA_SQL', ?)
    `).run(lead.id, AHORA), /UNIQUE constraint failed/);
  });
});

test("snapshot FASE 2 puede consultarse y materializarse sin inventar fecha anterior", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {
      vendedor_asignado_id: 11,
      sucursal_asignada_id: 2,
    }, contexto());
    const legado = obtenerAsignacionActual(sqlite, lead.id);
    assert.strictEqual(legado.id, null);
    assert.strictEqual(legado.origen_registro, "SNAPSHOT_FASE2");

    const materializada = asignarLead(sqlite, lead.id, {
      vendedor_id: 11,
      sucursal_id: 2,
      regla: "MATERIALIZACION_LEGACY",
      motivo: "Registrar snapshot previo",
    }, contexto());
    assert.ok(materializada.id > 0);
    assert.strictEqual(materializada.asignada_en, AHORA);
    assert.strictEqual(listarAsignaciones(sqlite, lead.id).length, 1);
  });
});

test("reasignación desde snapshot legado conserva anterior en historial", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {
      vendedor_origen_id: 11,
      sucursal_origen_id: 2,
      vendedor_asignado_id: 11,
      sucursal_asignada_id: 2,
    }, contexto());
    const nueva = reasignarLead(sqlite, lead.id, {
      vendedor_id: 22,
      sucursal_id: 3,
      regla: "SUPERVISOR",
      motivo: "Cambio territorial",
    }, contexto());

    assert.strictEqual(nueva.vendedor_id, 22);
    const evento = obtenerHistorialLead(sqlite, lead.id).find((e) => e.tipo === "REASIGNACION_REALIZADA");
    assert.strictEqual(evento.datos.vendedor_anterior_id, 11);
    assert.strictEqual(evento.datos.sucursal_anterior_id, 2);
    assert.strictEqual(evento.datos.origen_registro_anterior, "SNAPSHOT_FASE2");
    assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_origen_id, 11);
  });
});

test("fallo de historial revierte asignación, snapshots y estado", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {}, contexto());
    sqlite.exec(`
      CREATE TRIGGER bloquear_historial_asignacion
      BEFORE INSERT ON lead_historial
      BEGIN SELECT RAISE(ABORT, 'historial asignación bloqueado'); END
    `);

    assert.throws(() => asignarLead(sqlite, lead.id, {
      vendedor_id: 11, sucursal_id: 2, regla: "MANUAL",
    }, contexto()), /historial asignación bloqueado/);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_asignaciones").pluck().get(), 0);
    const intacto = obtenerLead(sqlite, lead.id);
    assert.strictEqual(intacto.estado, "NUEVO");
    assert.strictEqual(intacto.vendedor_asignado_id, null);
    assert.strictEqual(intacto.sucursal_asignada_id, null);
  });
});

test("fallo de historial revierte una reasignación completa", () => {
  conBase((sqlite) => {
    const lead = crearLead(sqlite, {}, contexto());
    asignarLead(sqlite, lead.id, { vendedor_id: 11, sucursal_id: 2, regla: "MANUAL" }, contexto());
    sqlite.exec(`
      CREATE TRIGGER bloquear_historial_reasignacion
      BEFORE INSERT ON lead_historial
      BEGIN SELECT RAISE(ABORT, 'historial reasignación bloqueado'); END
    `);

    assert.throws(() => reasignarLead(sqlite, lead.id, {
      vendedor_id: 22, sucursal_id: 3, regla: "SUPERVISOR", motivo: "Cobertura",
    }, contexto()), /historial reasignación bloqueado/);
    assert.strictEqual(listarAsignaciones(sqlite, lead.id).length, 1);
    assert.strictEqual(obtenerAsignacionActual(sqlite, lead.id).vendedor_id, 11);
    assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_asignado_id, 11);
  });
});

test("evaluarCreadorPrioritario solo propone; nunca asigna automáticamente", () => {
  const casos = [
    {
      nombre: "elegible",
      datos: { vendedor_origen_id: 11, activo: true, puede_atender: true, disponible: true, tiene_capacidad: true, alcance_permitido: true },
      esperado: { es_candidato: true, motivo: "CREADOR_PRIORITARIO" },
    },
    {
      nombre: "inactivo",
      datos: { vendedor_origen_id: 11, activo: false, puede_atender: true, disponible: true, tiene_capacidad: true, alcance_permitido: true },
      esperado: { es_candidato: false, motivo: "VENDEDOR_INACTIVO" },
    },
    {
      nombre: "vacaciones",
      datos: { vendedor_origen_id: 11, activo: true, puede_atender: true, disponible: false, tiene_capacidad: true, alcance_permitido: true },
      esperado: { es_candidato: false, motivo: "VENDEDOR_NO_DISPONIBLE" },
    },
    {
      nombre: "sobrecarga",
      datos: { vendedor_origen_id: 11, activo: true, puede_atender: true, disponible: true, tiene_capacidad: false, alcance_permitido: true },
      esperado: { es_candidato: false, motivo: "SIN_CAPACIDAD" },
    },
    {
      nombre: "fuera de alcance",
      datos: { vendedor_origen_id: 11, activo: true, puede_atender: true, disponible: true, tiene_capacidad: true, alcance_permitido: false },
      esperado: { es_candidato: false, motivo: "FUERA_DE_ALCANCE" },
    },
  ];
  for (const caso of casos) {
    assert.deepStrictEqual(evaluarCreadorPrioritario(caso.datos), caso.esperado, caso.nombre);
  }
});

test("asignación y reasignación no escriben en CRM, ventas ni productos JSON", () => {
  conBase((sqlite) => {
    const documento = JSON.stringify({ crm: { clientes: [{ id: 1 }] }, pos: { ventas: [2], productos: [3] } });
    sqlite.exec("CREATE TABLE estado (id INTEGER PRIMARY KEY, datos TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO estado (id, datos) VALUES (1, ?)").run(documento);
    const lead = crearLead(sqlite, {}, contexto());
    asignarLead(sqlite, lead.id, { vendedor_id: 11, sucursal_id: 2, regla: "MANUAL" }, contexto());
    reasignarLead(sqlite, lead.id, {
      vendedor_id: 22, sucursal_id: 3, regla: "SUPERVISOR", motivo: "Cambio",
    }, contexto());

    assert.strictEqual(sqlite.prepare("SELECT datos FROM estado WHERE id = 1").pluck().get(), documento);
  });
});
