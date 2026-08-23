const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-radar-cinco-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-radar-cinco-sucursales";
process.env.NODE_ENV = "test";

const app = require("./server");
const { firmarToken } = require("./auth");

const SUCURSALES = [101, 102, 103, 104, 105];
const ROL_RADAR = 9901;
const PERMISOS_RADAR = [
  "ver_radar_demanda", "registrar_demanda", "dar_seguimiento_demanda",
  "cerrar_demanda", "ver_resumen_demanda",
];

let servidor;
let base;
let tokensLimitados;
let tokenGlobal;

function agregarSiFalta(lista, item) {
  if (!lista.some((existente) => existente.id === item.id)) lista.push(item);
}

async function pedir(ruta, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const respuesta = await fetch(base + ruta, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

function demandaValida(sucursalId, extra = {}) {
  return {
    producto_buscado: `Producto solicitado S${sucursalId}`,
    cantidad: 1,
    motivo_no_venta: "NO_MANEJAMOS",
    ...extra,
  };
}

function resumenEsperado(registros) {
  const por_estado = {};
  const por_motivo = {};
  const por_sucursal = {};
  let cantidad_solicitada = 0;
  for (const item of registros) {
    por_estado[item.estado] = (por_estado[item.estado] || 0) + 1;
    por_motivo[item.motivo_no_venta] = (por_motivo[item.motivo_no_venta] || 0) + 1;
    por_sucursal[item.sucursal_id] = (por_sucursal[item.sucursal_id] || 0) + 1;
    cantidad_solicitada += Number(item.cantidad) || 0;
  }
  const convertidas = por_estado.CONVERTIDA || 0;
  const no_convertidas = por_estado.NO_CONVERTIDA || 0;
  const pendientes = ["REGISTRADA", "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO"]
    .reduce((total, estado) => total + (por_estado[estado] || 0), 0);
  const denominador_conversion = convertidas + no_convertidas;
  const denominador_recuperacion = pendientes + convertidas + no_convertidas;
  return {
    total: registros.length,
    cantidad_solicitada,
    convertidas,
    tasa_conversion: ((por_estado.CONVERTIDA || 0) + (por_estado.NO_CONVERTIDA || 0))
      ? Math.round(((por_estado.CONVERTIDA || 0) /
          ((por_estado.CONVERTIDA || 0) + (por_estado.NO_CONVERTIDA || 0))) * 10000) / 100
      : 0,
    conversion_detalle: { numerador: convertidas, denominador: denominador_conversion },
    tasa_recuperacion: denominador_recuperacion
      ? Math.round((convertidas / denominador_recuperacion) * 10000) / 100
      : 0,
    recuperacion_detalle: { numerador: convertidas, denominador: denominador_recuperacion },
    por_estado,
    por_motivo,
    por_sucursal,
  };
}

before(async () => {
  app.DB.radar_demanda = { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 };
  agregarSiFalta(app.DB.admin.roles, {
    id: ROL_RADAR, nombre: "Radar cinco sucursales", permisos: PERMISOS_RADAR, modulos: ["radar_demanda"],
  });

  tokensLimitados = new Map();
  for (let i = 0; i < SUCURSALES.length; i += 1) {
    const sucursalId = SUCURSALES[i];
    const usuarioId = 1001 + i;
    const vendedorId = 2001 + i;
    const clienteId = 3001 + i;
    const ventaId = 4001 + i;
    agregarSiFalta(app.DB.pos.sucursales, { id: sucursalId, nombre: `Sucursal ${i + 1}` });
    agregarSiFalta(app.DB.pos.vendedores, { id: vendedorId, nombre: `Vendedor ${i + 1}`, sucursal_id: sucursalId });
    agregarSiFalta(app.DB.crm.clientes, { id: clienteId, nombre: `Cliente ${i + 1}`, sucursal_id: sucursalId });
    agregarSiFalta(app.DB.pos.ventas, {
      id: ventaId, sucursal_id: sucursalId, cliente_id: clienteId,
      vendedor_id: vendedorId, fecha: "2026-08-20", total: 1000 + i,
    });
    agregarSiFalta(app.DB.admin.usuarios, {
      id: usuarioId, nombre: `Usuario ${i + 1}`, usuario: `radar.cinco.${i + 1}`,
      rol_id: ROL_RADAR, sucursal_id: sucursalId, vendedor_id: vendedorId, activo: true,
    });
    tokensLimitados.set(sucursalId, firmarToken({
      id: usuarioId, nombre: `Usuario ${i + 1}`, rol_id: ROL_RADAR, sucursal_id: sucursalId,
    }));
  }

  agregarSiFalta(app.DB.admin.usuarios, {
    id: 1, nombre: "Administrador global", usuario: "admin.global.radar",
    rol_id: 1, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  tokenGlobal = firmarToken({ id: 1, nombre: "Administrador global", rol_id: 1, sucursal_id: 1 });

  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  for (const sufijo of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(BASE_DESECHABLE + sufijo); } catch { /* no existe */ }
  }
});

test("Radar mantiene aislamiento integral entre cinco sucursales", async () => {
  const demandas = new Map();

  // Cada cuenta crea en su alcance aunque intente inyectar otra sucursal, y
  // puede completar todas las operaciones autorizadas sobre su propio registro.
  for (let i = 0; i < SUCURSALES.length; i += 1) {
    const sucursalId = SUCURSALES[i];
    const sucursalInyectada = SUCURSALES[(i + 1) % SUCURSALES.length];
    const token = tokensLimitados.get(sucursalId);
    const creada = await pedir("/api/radar-demanda", {
      token, method: "POST", body: demandaValida(sucursalId, { sucursal_id: sucursalInyectada }),
    });
    assert.equal(creada.status, 200);
    assert.equal(creada.cuerpo.sucursal_id, sucursalId);
    demandas.set(sucursalId, creada.cuerpo.id);

    const lista = await pedir(`/api/radar-demanda?sucursal_id=${sucursalInyectada}`, { token });
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.cuerpo.map((item) => item.id), [creada.cuerpo.id]);
    assert.ok(lista.cuerpo.every((item) => item.sucursal_id === sucursalId));

    assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, { token })).status, 200);
    const editada = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
      token, method: "PATCH", body: { notas: `Nota propia ${sucursalId}` },
    });
    assert.equal(editada.status, 200);
    assert.equal(editada.cuerpo.notas, `Nota propia ${sucursalId}`);

    assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}/seguimientos`, {
      token, method: "POST", body: { comentario: `Seguimiento propio ${sucursalId}` },
    })).status, 200);
    assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
      token, method: "PATCH", body: { estado: "CLIENTE_CONTACTADO" },
    })).status, 200);
    assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}/historial`, { token })).status, 200);

    const candidatas = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas`, { token });
    assert.equal(candidatas.status, 200);
    assert.ok(candidatas.cuerpo.some((venta) => venta.id === 4001 + i));
    assert.ok(candidatas.cuerpo.every((venta) => venta.id === 4001 + i));

    const cerrada = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
      token, method: "PATCH", body: { estado: "NO_CONVERTIDA" },
    });
    assert.equal(cerrada.status, 200);
    assert.equal(cerrada.cuerpo.estado, "NO_CONVERTIDA");
  }

  // Cada usuario recibe 404 en todas las lecturas y escrituras dirigidas por ID
  // a la siguiente sucursal; la lista sigue mostrando únicamente su alcance.
  for (let i = 0; i < SUCURSALES.length; i += 1) {
    const propia = SUCURSALES[i];
    const ajena = SUCURSALES[(i + 1) % SUCURSALES.length];
    const idAjeno = demandas.get(ajena);
    const token = tokensLimitados.get(propia);
    const lista = await pedir(`/api/radar-demanda?sucursal_id=${ajena}`, { token });
    assert.equal(lista.status, 200);
    assert.ok(lista.cuerpo.every((item) => item.sucursal_id === propia));

    const intentos = [
      pedir(`/api/radar-demanda/${idAjeno}`, { token }),
      pedir(`/api/radar-demanda/${idAjeno}`, { token, method: "PATCH", body: { notas: "Intrusión" } }),
      pedir(`/api/radar-demanda/${idAjeno}/seguimientos`, { token, method: "POST", body: { comentario: "Intrusión" } }),
      pedir(`/api/radar-demanda/${idAjeno}`, { token, method: "PATCH", body: { estado: "EN_SEGUIMIENTO" } }),
      pedir(`/api/radar-demanda/${idAjeno}`, { token, method: "PATCH", body: { estado: "CANCELADA" } }),
      pedir(`/api/radar-demanda/${idAjeno}/historial`, { token }),
      pedir(`/api/radar-demanda/${idAjeno}/ventas-candidatas`, { token }),
    ];
    for (const respuesta of await Promise.all(intentos)) assert.equal(respuesta.status, 404);
  }

  // Una demanda contactada en S1 solo acepta la venta S1. Los cuatro rechazos
  // cruzados no mutan estado, referencia, historial ni contador.
  const tokenS1 = tokensLimitados.get(101);
  const recuperable = await pedir("/api/radar-demanda", {
    token: tokenS1, method: "POST", body: demandaValida(101, { producto_buscado: "Venta recuperable S1" }),
  });
  await pedir(`/api/radar-demanda/${recuperable.cuerpo.id}`, {
    token: tokenS1, method: "PATCH", body: { estado: "CLIENTE_CONTACTADO" },
  });
  for (const ventaAjena of [4002, 4003, 4004, 4005]) {
    const antes = JSON.stringify(app.DB.radar_demanda.seguimientos);
    const contadorAntes = app.DB.radar_demanda.ultimo_seguimiento_id;
    const rechazada = await pedir(`/api/radar-demanda/${recuperable.cuerpo.id}`, {
      token: tokenS1, method: "PATCH",
      body: { estado: "CONVERTIDA", venta_recuperada_id: ventaAjena },
    });
    assert.equal(rechazada.status, 400);
    const actual = app.DB.radar_demanda.registros.find((item) => item.id === recuperable.cuerpo.id);
    assert.equal(actual.estado, "CLIENTE_CONTACTADO");
    assert.equal(actual.venta_recuperada_id, null);
    assert.equal(JSON.stringify(app.DB.radar_demanda.seguimientos), antes);
    assert.equal(app.DB.radar_demanda.ultimo_seguimiento_id, contadorAntes);
  }
  const convertida = await pedir(`/api/radar-demanda/${recuperable.cuerpo.id}`, {
    token: tokenS1, method: "PATCH", body: { estado: "CONVERTIDA", venta_recuperada_id: 4001 },
  });
  assert.equal(convertida.status, 200);
  assert.equal(convertida.cuerpo.venta_recuperada_id, 4001);

  // Resúmenes limitados coinciden exactamente con su partición, incluidos
  // total, estados, motivos y sucursales.
  for (const sucursalId of SUCURSALES) {
    const registros = app.DB.radar_demanda.registros.filter((item) => item.sucursal_id === sucursalId);
    const resumen = await pedir(`/api/radar-demanda/resumen?sucursal_id=${SUCURSALES[0]}`, {
      token: tokensLimitados.get(sucursalId),
    });
    assert.equal(resumen.status, 200);
    assert.deepEqual(resumen.cuerpo, resumenEsperado(registros));
    assert.deepEqual(Object.keys(resumen.cuerpo.por_sucursal), [String(sucursalId)]);
  }

  // El administrador en Todas lee las cinco, filtra cualquiera y consulta
  // detalle/resumen. Sin selección no escribe; seleccionando S3 solo escribe S3.
  const listaGlobal = await pedir("/api/radar-demanda", { token: tokenGlobal });
  assert.equal(listaGlobal.status, 200);
  for (const sucursalId of SUCURSALES) {
    assert.ok(listaGlobal.cuerpo.some((item) => item.sucursal_id === sucursalId));
    const filtrada = await pedir(`/api/radar-demanda?sucursal_id=${sucursalId}`, { token: tokenGlobal });
    assert.ok(filtrada.cuerpo.length > 0);
    assert.ok(filtrada.cuerpo.every((item) => item.sucursal_id === sucursalId));
    assert.equal((await pedir(`/api/radar-demanda/${demandas.get(sucursalId)}`, { token: tokenGlobal })).status, 200);
    const resumen = await pedir(`/api/radar-demanda/resumen?sucursal_id=${sucursalId}`, { token: tokenGlobal });
    assert.deepEqual(resumen.cuerpo, resumenEsperado(
      app.DB.radar_demanda.registros.filter((item) => item.sucursal_id === sucursalId)
    ));
  }
  const resumenGlobal = await pedir("/api/radar-demanda/resumen", { token: tokenGlobal });
  assert.deepEqual(resumenGlobal.cuerpo, resumenEsperado(app.DB.radar_demanda.registros));
  for (const sucursalId of SUCURSALES) assert.ok(resumenGlobal.cuerpo.por_sucursal[sucursalId] > 0);

  const cantidadAntes = app.DB.radar_demanda.registros.length;
  const sinSeleccion = await pedir("/api/radar-demanda", {
    token: tokenGlobal, method: "POST", body: demandaValida(103),
  });
  assert.equal(sinSeleccion.status, 400);
  assert.equal(app.DB.radar_demanda.registros.length, cantidadAntes);

  const seleccionS3 = await pedir("/api/radar-demanda?sucursal_id=103", {
    token: tokenGlobal, method: "POST", body: demandaValida(103, { sucursal_id: 105 }),
  });
  assert.equal(seleccionS3.status, 200);
  assert.equal(seleccionS3.cuerpo.sucursal_id, 103);
  assert.equal(app.DB.radar_demanda.registros.length, cantidadAntes + 1);
});
