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
const { crearLead, obtenerLead } = require("./centroLeads/leads");
const { crearFuente, obtenerFuente } = require("./centroLeads/fuentes");
const { crearContenido, obtenerContenido } = require("./centroLeads/contenidos");
const {
  generarEnlaceRastreado,
  resolverEnlaceRastreado,
} = require("./centroLeads/enlacesRastreados");
const {
  registrarAtribucion,
  obtenerAtribucionPrincipal,
  listarAtribuciones,
  corregirAtribucionLead,
} = require("./centroLeads/atribuciones");
const { obtenerHistorialLead } = require("./centroLeads/historial");

const AHORA = "2026-08-21T18:00:00.000Z";
const TOKEN_FIJO = "A".repeat(43);

function contexto(usuarioId = 7, ahora = AHORA) {
  return {
    usuario_id: usuarioId,
    ahora: () => new Date(ahora),
    generarToken: () => TOKEN_FIJO,
  };
}

function conBase(fn) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-f3-"));
  const ruta = path.join(carpeta, "datos.sqlite");
  const sqlite = new Database(ruta);
  inicializarPersistenciaCentroLeads(sqlite);
  try {
    return fn(sqlite, { carpeta, ruta });
  } finally {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

function fuenteBase(sqlite, extra = {}) {
  return crearFuente(sqlite, {
    canal: "comentarios",
    plataforma: "facebook",
    proveedor: "meta",
    identificador_externo: "pagina-ocosingo",
    nombre: "Facebook Ocosingo",
    sucursal_id: 2,
    vendedor_id: 11,
    metadata: { categoria: "pagina_comercial" },
    ...extra,
  }, contexto());
}

function contenidoBase(sqlite, extra = {}) {
  const fuente = fuenteBase(sqlite);
  return crearContenido(sqlite, {
    fuente_id: fuente.id,
    tipo: "VIDEO",
    identificador_externo: "video-jbl-prx",
    titulo: "Video JBL PRX",
    url: "https://example.test/video-jbl-prx",
    campana: "campana-jbl",
    producto_id: 42,
    vendedor_origen_id: 11,
    sucursal_origen_id: 2,
    publicado_en: "2026-08-20T12:00:00-06:00",
    ...extra,
  }, contexto());
}

function eventoExterno(sqlite, fuenteId, identificador = "evento-1", tipo = "comentario") {
  const resultado = sqlite.prepare(`
    INSERT INTO lead_eventos_externos (
      fuente_id, proveedor, identificador_evento_externo, tipo, recibido_en, ocurrido_en
    ) VALUES (?, 'meta', ?, ?, ?, ?)
  `).run(fuenteId, identificador, tipo, AHORA, AHORA);
  return Number(resultado.lastInsertRowid);
}

function atribucionBase(sqlite, leadId, contenido, extra = {}, ctx = contexto()) {
  return registrarAtribucion(sqlite, leadId, {
    fuente_id: contenido.fuente_id,
    contenido_id: contenido.id,
    evento_externo_id: eventoExterno(sqlite, contenido.fuente_id),
    metodo: "DIRECTA",
    clave_idempotencia: `directa:${leadId}:${contenido.id}`,
    correlacion_id: `recorrido:${leadId}`,
    evidencia: { external_content_id: contenido.identificador_externo },
    ...extra,
  }, ctx);
}

test("migración V3 actualiza una base V2 sin reconstruir V1/V2 y es idempotente", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-v2-v3-"));
  const ruta = path.join(carpeta, "datos.sqlite");
  const sqlite = new Database(ruta);
  try {
    inicializarPersistenciaCentroLeads(sqlite, { migraciones: MIGRACIONES.slice(0, 2) });
    sqlite.prepare(`
      INSERT INTO leads (estado, creado_en, actualizado_en, ultima_interaccion_en)
      VALUES ('NUEVO', ?, ?, ?)
    `).run(AHORA, AHORA, AHORA);
    assert.strictEqual(sqlite.prepare("SELECT version FROM centro_leads_schema_version WHERE id = 1").pluck().get(), 2);

    inicializarPersistenciaCentroLeads(sqlite);
    inicializarPersistenciaCentroLeads(sqlite);

    assert.strictEqual(VERSION_ESQUEMA, 3);
    assert.strictEqual(sqlite.prepare("SELECT version FROM centro_leads_schema_version WHERE id = 1").pluck().get(), 3);
    assert.strictEqual(sqlite.prepare("SELECT estado FROM leads WHERE id = 1").pluck().get(), "NUEVO");
    assert.ok(sqlite.prepare("PRAGMA table_info(leads)").all().some((c) => c.name === "atribucion_origen_id"));
    assert.ok(sqlite.prepare("PRAGMA table_info(lead_atribuciones)").all().some((c) => c.name === "clave_idempotencia"));
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lead_enlaces_rastreados'").get());
  } finally {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("crearFuente guarda plataforma, responsable lógico y metadata no sensible", () => {
  conBase((sqlite) => {
    const fuente = fuenteBase(sqlite);

    assert.strictEqual(fuente.canal, "comentarios");
    assert.strictEqual(fuente.plataforma, "facebook");
    assert.strictEqual(fuente.proveedor, "meta");
    assert.strictEqual(fuente.sucursal_id, 2);
    assert.strictEqual(fuente.vendedor_id, 11);
    assert.deepStrictEqual(fuente.metadata, { categoria: "pagina_comercial" });
    assert.strictEqual(fuente.activa, true);
    assert.deepStrictEqual(obtenerFuente(sqlite, fuente.id), fuente);
  });
});

test("fuente externa duplicada es idempotente y no crea una segunda fila", () => {
  conBase((sqlite) => {
    const primera = fuenteBase(sqlite);
    const segunda = fuenteBase(sqlite, { nombre: "Nombre reenviado" });

    assert.strictEqual(segunda.id, primera.id);
    assert.strictEqual(segunda.nombre, "Facebook Ocosingo");
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_fuentes").pluck().get(), 1);
  });
});

test("fuente rechaza secretos y metadata excesiva", () => {
  conBase((sqlite) => {
    assert.throws(() => fuenteBase(sqlite, { metadata: { access_token: "secreto" } }), /metadata.*sensible/i);
    assert.throws(() => fuenteBase(sqlite, { metadata: { nota: "x".repeat(5000) } }), /metadata.*4096/i);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_fuentes").pluck().get(), 0);
  });
});

test("crearContenido soporta los siete tipos y conserva creador, sucursal y producto", () => {
  conBase((sqlite) => {
    const fuente = fuenteBase(sqlite);
    const tipos = ["VIDEO", "REEL", "PUBLICACION", "ANUNCIO", "CAMPAÑA", "QR", "ENLACE"];
    for (const [indice, tipo] of tipos.entries()) {
      crearContenido(sqlite, {
        fuente_id: fuente.id,
        tipo,
        identificador_externo: `contenido-${indice}`,
        producto_id: 42,
        vendedor_origen_id: 11,
        sucursal_origen_id: 2,
      }, contexto());
    }

    const video = obtenerContenido(sqlite, 1);
    assert.strictEqual(video.tipo, "VIDEO");
    assert.strictEqual(video.producto_id, 42);
    assert.strictEqual(video.vendedor_origen_id, 11);
    assert.strictEqual(video.sucursal_origen_id, 2);
    assert.strictEqual(video.activa, true);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_contenidos").pluck().get(), 7);
  });
});

test("contenido duplicado es idempotente y un tipo arbitrario se rechaza", () => {
  conBase((sqlite) => {
    const primero = contenidoBase(sqlite);
    const segundo = crearContenido(sqlite, {
      fuente_id: primero.fuente_id,
      tipo: "VIDEO",
      identificador_externo: "video-jbl-prx",
      titulo: "No debe sobrescribir",
    }, contexto());

    assert.strictEqual(segundo.id, primero.id);
    assert.strictEqual(segundo.titulo, "Video JBL PRX");
    assert.throws(() => crearContenido(sqlite, {
      fuente_id: primero.fuente_id,
      tipo: "HISTORIA_INVENTADA",
      identificador_externo: "otro",
    }, contexto()), /tipo.*contenido.*inválido/i);
  });
});

test("generarEnlaceRastreado devuelve el token una vez y persiste solamente su hash", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const enlace = generarEnlaceRastreado(sqlite, {
      contenido_id: contenido.id,
      destino_tipo: "WHATSAPP",
      destino_url: "https://wa.me/529611112222",
    }, contexto());

    assert.strictEqual(enlace.token, TOKEN_FIJO);
    const fila = sqlite.prepare("SELECT * FROM lead_enlaces_rastreados WHERE id = ?").get(enlace.id);
    assert.notStrictEqual(fila.token_hash, TOKEN_FIJO);
    assert.strictEqual(fila.token_hash.length, 64);
    assert.ok(!JSON.stringify(fila).includes(TOKEN_FIJO));
    const resuelto = resolverEnlaceRastreado(sqlite, TOKEN_FIJO, contexto());
    assert.strictEqual(resuelto.contenido_id, contenido.id);
    assert.strictEqual(resuelto.vendedor_origen_id, 11);
    assert.strictEqual(resuelto.sucursal_origen_id, 2);
  });
});

test("resolverEnlaceRastreado rechaza token desconocido, expirado, inactivo o contenido archivado", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const enlace = generarEnlaceRastreado(sqlite, {
      contenido_id: contenido.id,
      destino_tipo: "LANDING",
      destino_url: "https://example.test/jbl",
      expira_en: "2026-08-22T18:00:00.000Z",
    }, contexto());

    assert.throws(() => resolverEnlaceRastreado(sqlite, "token-inexistente", contexto()), /enlace.*no existe/i);
    assert.throws(
      () => resolverEnlaceRastreado(sqlite, enlace.token, contexto(7, "2026-08-23T18:00:00.000Z")),
      /enlace.*expirado/i
    );
    sqlite.prepare("UPDATE lead_enlaces_rastreados SET activa = 0 WHERE id = ?").run(enlace.id);
    assert.throws(() => resolverEnlaceRastreado(sqlite, enlace.token, contexto()), /enlace.*inactivo/i);
    sqlite.prepare("UPDATE lead_enlaces_rastreados SET activa = 1 WHERE id = ?").run(enlace.id);
    sqlite.prepare("UPDATE lead_contenidos SET activa = 0 WHERE id = ?").run(contenido.id);
    assert.throws(() => resolverEnlaceRastreado(sqlite, enlace.token, contexto()), /contenido.*archivado/i);
  });
});

test("QR reutiliza el mismo mecanismo de enlace rastreado", () => {
  conBase((sqlite) => {
    const fuente = fuenteBase(sqlite);
    const qr = crearContenido(sqlite, {
      fuente_id: fuente.id,
      tipo: "QR",
      identificador_externo: "qr-aparador-1",
      vendedor_origen_id: 11,
      sucursal_origen_id: 2,
    }, contexto());
    const enlace = generarEnlaceRastreado(sqlite, {
      contenido_id: qr.id,
      destino_tipo: "WHATSAPP",
      destino_url: "https://wa.me/529611112222",
    }, contexto());

    assert.strictEqual(resolverEnlaceRastreado(sqlite, enlace.token, contexto()).contenido.tipo, "QR");
  });
});

test("catálogos y enlaces no modifican el documento JSON existente", () => {
  conBase((sqlite) => {
    const documento = JSON.stringify({ crm: { clientes: [{ id: 9 }] }, pos: { ventas: [{ id: 10 }] } });
    sqlite.exec("CREATE TABLE estado (id INTEGER PRIMARY KEY, datos TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO estado (id, datos) VALUES (1, ?)").run(documento);

    const contenido = contenidoBase(sqlite);
    generarEnlaceRastreado(sqlite, {
      contenido_id: contenido.id,
      destino_tipo: "MESSENGER",
      destino_url: "https://m.me/pagina",
    }, contexto());

    assert.strictEqual(sqlite.prepare("SELECT datos FROM estado WHERE id = 1").pluck().get(), documento);
  });
});

test("DECLARADA puede ser ORIGEN ACTIVA sin materializar vendedor ni sucursal en leads", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, { nombre: "Cliente declarado" }, contexto());
    const atribucion = registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      metodo: "DECLARADA",
      clave_idempotencia: "declarada:lead-1:video-jbl",
      evidencia: { resumen_declaracion: "Mencionó el video de Sergio" },
    }, contexto());

    assert.strictEqual(atribucion.metodo, "DECLARADA");
    assert.strictEqual(atribucion.rol, "ORIGEN");
    assert.strictEqual(atribucion.estado, "ACTIVA");
    assert.strictEqual(atribucion.vendedor_origen_id, 11);
    const actualizado = obtenerLead(sqlite, lead.id);
    assert.strictEqual(actualizado.atribucion_origen_id, atribucion.id);
    assert.strictEqual(actualizado.vendedor_origen_id, null);
    assert.strictEqual(actualizado.sucursal_origen_id, null);
  });
});

test("DESCONOCIDA representa origen activo temporal sin materializar snapshots", () => {
  conBase((sqlite) => {
    const fuente = fuenteBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const atribucion = registrarAtribucion(sqlite, lead.id, {
      fuente_id: fuente.id,
      metodo: "DESCONOCIDA",
      clave_idempotencia: "desconocida:lead-1",
      evidencia: { external_account_id: "pagina-ocosingo" },
    }, contexto());

    assert.strictEqual(atribucion.rol, "ORIGEN");
    assert.strictEqual(atribucion.estado, "ACTIVA");
    const actualizado = obtenerLead(sqlite, lead.id);
    assert.strictEqual(actualizado.atribucion_origen_id, atribucion.id);
    assert.strictEqual(actualizado.vendedor_origen_id, null);
    assert.strictEqual(actualizado.sucursal_origen_id, null);
  });
});

test("DIRECTA materializa automáticamente origen comprobado", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const atribucion = atribucionBase(sqlite, lead.id, contenido);

    const actualizado = obtenerLead(sqlite, lead.id);
    assert.strictEqual(atribucion.rol, "ORIGEN");
    assert.strictEqual(actualizado.atribucion_origen_id, atribucion.id);
    assert.strictEqual(actualizado.vendedor_origen_id, 11);
    assert.strictEqual(actualizado.sucursal_origen_id, 2);
  });
});

test("ENLACE_RASTREADO y CAMPAÑA también materializan origen comprobado", () => {
  for (const metodo of ["ENLACE_RASTREADO", "CAMPAÑA"]) {
    conBase((sqlite) => {
      const contenido = contenidoBase(sqlite);
      const lead = crearLead(sqlite, {}, contexto());
      const evidencia = metodo === "ENLACE_RASTREADO"
        ? { enlace_id: 91 }
        : { campana_externa_id: "campana-jbl" };
      const atribucion = registrarAtribucion(sqlite, lead.id, {
        fuente_id: contenido.fuente_id,
        contenido_id: contenido.id,
        evento_externo_id: eventoExterno(sqlite, contenido.fuente_id),
        metodo,
        clave_idempotencia: `${metodo}:lead-1`,
        evidencia,
      }, contexto());

      assert.strictEqual(atribucion.rol, "ORIGEN");
      assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_origen_id, 11);
      assert.strictEqual(obtenerLead(sqlite, lead.id).sucursal_origen_id, 2);
    });
  }
});

test("una evidencia técnica mejora DESCONOCIDA y conserva la anterior como SUPERADA", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const desconocida = registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      metodo: "DESCONOCIDA",
      clave_idempotencia: "desconocida:1",
    }, contexto());
    const directa = atribucionBase(sqlite, lead.id, contenido, {
      evento_externo_id: eventoExterno(sqlite, contenido.fuente_id, "evento-directo"),
      clave_idempotencia: "directa:mejora-desconocida",
    });

    assert.strictEqual(obtenerAtribucionPrincipal(sqlite, lead.id).id, directa.id);
    const anteriores = listarAtribuciones(sqlite, lead.id);
    assert.strictEqual(anteriores.length, 2);
    const conservada = anteriores.find((a) => a.id === desconocida.id);
    assert.strictEqual(conservada.estado, "SUPERADA");
    assert.strictEqual(conservada.superada_por_atribucion_id, directa.id);
    assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_origen_id, 11);
  });
});

test("una evidencia técnica mejora DECLARADA conforme a precedencia", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const declarada = registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      metodo: "DECLARADA",
      clave_idempotencia: "declarada:1",
      correlacion_id: "recorrido:1",
      evidencia: { resumen_declaracion: "Video Sergio" },
    }, contexto());
    const directa = atribucionBase(sqlite, lead.id, contenido, {
      clave_idempotencia: "directa:mejora-declarada",
      correlacion_id: "recorrido:1",
    });

    assert.strictEqual(obtenerAtribucionPrincipal(sqlite, lead.id).id, directa.id);
    assert.strictEqual(listarAtribuciones(sqlite, lead.id).find((a) => a.id === declarada.id).estado, "SUPERADA");
  });
});

test("precedencia técnica mejora solamente el mismo recorrido; otro recorrido queda ASISTIDA", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const campana = registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      evento_externo_id: eventoExterno(sqlite, contenido.fuente_id, "campana-1"),
      metodo: "CAMPAÑA",
      clave_idempotencia: "campana:1",
      correlacion_id: "recorrido:original",
      evidencia: { campana_externa_id: "campana-jbl" },
    }, contexto());
    const directaPosterior = atribucionBase(sqlite, lead.id, contenido, {
      evento_externo_id: eventoExterno(sqlite, contenido.fuente_id, "directa-otro-recorrido"),
      clave_idempotencia: "directa:otro-recorrido",
      correlacion_id: "recorrido:posterior",
    });

    assert.strictEqual(obtenerAtribucionPrincipal(sqlite, lead.id).id, campana.id);
    assert.strictEqual(directaPosterior.rol, "ASISTIDA");
    assert.strictEqual(directaPosterior.estado, "ACTIVA");
  });
});

test("una DIRECTA comprobada no puede reemplazarse automáticamente", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const directa = atribucionBase(sqlite, lead.id, contenido);
    const contradiccion = registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      metodo: "DECLARADA",
      clave_idempotencia: "declarada:contradice-directa",
      correlacion_id: "recorrido:1",
      evidencia: { resumen_declaracion: "Otro origen" },
    }, contexto());

    assert.strictEqual(obtenerAtribucionPrincipal(sqlite, lead.id).id, directa.id);
    assert.strictEqual(contradiccion.rol, "ASISTIDA");
    assert.strictEqual(listarAtribuciones(sqlite, lead.id).find((a) => a.id === directa.id).estado, "ACTIVA");
  });
});

test("atribución repetida por clave idempotente produce una sola fila y un solo evento efectivo", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const datos = {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      evento_externo_id: eventoExterno(sqlite, contenido.fuente_id),
      metodo: "DIRECTA",
      clave_idempotencia: "evento:meta:123:lead:1",
      correlacion_id: "recorrido:1",
      evidencia: { external_content_id: contenido.identificador_externo },
    };
    const primera = registrarAtribucion(sqlite, lead.id, datos, contexto());
    const segunda = registrarAtribucion(sqlite, lead.id, datos, contexto());

    assert.strictEqual(segunda.id, primera.id);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_atribuciones").pluck().get(), 1);
    assert.strictEqual(
      obtenerHistorialLead(sqlite, lead.id).filter((e) => e.tipo === "ATRIBUCION_ESTABLECIDA").length,
      1
    );
  });
});

test("métodos de atribución exigen evidencia mínima y rechazan método arbitrario", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    assert.throws(() => registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      metodo: "DIRECTA",
      clave_idempotencia: "directa:sin-evento",
    }, contexto()), /DIRECTA.*evento/i);
    assert.throws(() => registrarAtribucion(sqlite, lead.id, {
      metodo: "INVENTADA",
      clave_idempotencia: "inventada:1",
    }, contexto()), /método.*inválido/i);
  });
});

test("fallo de historial revierte por completo una atribución y sus snapshots", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, {}, contexto());
    const eventoId = eventoExterno(sqlite, contenido.fuente_id);
    sqlite.exec(`
      CREATE TRIGGER bloquear_historial_atribucion
      BEFORE INSERT ON lead_historial
      BEGIN SELECT RAISE(ABORT, 'historial atribución bloqueado'); END
    `);

    assert.throws(() => registrarAtribucion(sqlite, lead.id, {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      evento_externo_id: eventoId,
      metodo: "DIRECTA",
      clave_idempotencia: "directa:rollback",
    }, contexto()), /historial atribución bloqueado/);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_atribuciones").pluck().get(), 0);
    assert.strictEqual(obtenerLead(sqlite, lead.id).atribucion_origen_id, null);
    assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_origen_id, null);
  });
});

test("corregirAtribucionLead exige permiso, motivo y alcance de sucursal", () => {
  conBase((sqlite) => {
    const contenido = contenidoBase(sqlite);
    const lead = crearLead(sqlite, { sucursal_asignada_id: 2 }, contexto());
    atribucionBase(sqlite, lead.id, contenido);
    const correccion = {
      fuente_id: contenido.fuente_id,
      contenido_id: contenido.id,
      evento_externo_id: eventoExterno(sqlite, contenido.fuente_id, "evento-correccion"),
      metodo: "DIRECTA",
      clave_idempotencia: "correccion:1",
      motivo: "Contenido externo asociado incorrectamente",
    };

    assert.throws(() => corregirAtribucionLead(sqlite, lead.id, correccion, {
      ...contexto(), permisos: [], alcance: { verTodas: false, sucursalId: 2 },
    }), /permiso.*corregir_atribucion_lead/i);
    assert.throws(() => corregirAtribucionLead(sqlite, lead.id, { ...correccion, motivo: "" }, {
      ...contexto(), permisos: ["corregir_atribucion_lead"], alcance: { verTodas: false, sucursalId: 2 },
    }), /motivo.*obligatorio/i);
    assert.throws(() => corregirAtribucionLead(sqlite, lead.id, correccion, {
      ...contexto(), permisos: ["corregir_atribucion_lead"], alcance: { verTodas: false, sucursalId: 3 },
    }), /alcance.*sucursal/i);
  });
});

test("corrección entre sucursales requiere alcance global y conserva evidencia anterior", () => {
  conBase((sqlite) => {
    const original = contenidoBase(sqlite);
    const lead = crearLead(sqlite, { sucursal_asignada_id: 2 }, contexto());
    const anterior = atribucionBase(sqlite, lead.id, original);
    const fuentePalenque = crearFuente(sqlite, {
      canal: "social", plataforma: "instagram", proveedor: "meta",
      identificador_externo: "instagram-palenque", nombre: "Instagram Palenque",
      sucursal_id: 3, vendedor_id: 22,
    }, contexto());
    const contenidoPalenque = crearContenido(sqlite, {
      fuente_id: fuentePalenque.id, tipo: "REEL", identificador_externo: "reel-palenque",
      vendedor_origen_id: 22, sucursal_origen_id: 3,
    }, contexto());
    const correccion = {
      fuente_id: fuentePalenque.id,
      contenido_id: contenidoPalenque.id,
      evento_externo_id: eventoExterno(sqlite, fuentePalenque.id, "evento-palenque"),
      metodo: "DIRECTA",
      clave_idempotencia: "correccion:palenque",
      motivo: "La referencia externa correcta pertenece al Reel Palenque",
    };

    assert.throws(() => corregirAtribucionLead(sqlite, lead.id, correccion, {
      ...contexto(), permisos: ["corregir_atribucion_lead"], alcance: { verTodas: false, sucursalId: 2 },
    }), /alcance global/i);
    const nueva = corregirAtribucionLead(sqlite, lead.id, correccion, {
      ...contexto(), permisos: ["corregir_atribucion_lead"], alcance: { verTodas: true, sucursalId: null },
    });

    assert.strictEqual(nueva.reemplaza_atribucion_id, anterior.id);
    const conservada = listarAtribuciones(sqlite, lead.id).find((a) => a.id === anterior.id);
    assert.strictEqual(conservada.estado, "SUPERADA");
    assert.strictEqual(conservada.motivo_superacion, correccion.motivo);
    assert.strictEqual(obtenerLead(sqlite, lead.id).vendedor_origen_id, 22);
    assert.strictEqual(obtenerLead(sqlite, lead.id).sucursal_origen_id, 3);
    assert.ok(obtenerHistorialLead(sqlite, lead.id).some((e) => e.tipo === "ATRIBUCION_CORREGIDA"));
  });
});
