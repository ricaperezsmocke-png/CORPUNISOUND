const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { obtenerAnalisis, MOTIVOS_DEMANDA } = require("./radarDemanda");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-radar-analisis-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-radar-analisis";
process.env.NODE_ENV = "test";
const app = require("./server");
const { firmarToken } = require("./auth");

function registro(id, cambios = {}) {
  return {
    id, sucursal_id: 1, producto_id: 10, producto_nombre_registrado: "Bocina Uno",
    producto_sku_registrado: "BOC-1", producto_buscado: "", marca_solicitada: "",
    modelo_solicitado: "", variante_solicitada: "", categoria_solicitada: "Audio",
    cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA", estado: "REGISTRADA",
    requiere_seguimiento: false, fecha_seguimiento: null, fecha_registro: "2026-08-20T12:00:00.000Z",
    cliente_id: null, nombre_contacto: "", telefono_contacto: "", venta_recuperada_id: null,
    ...cambios,
  };
}

function base(registros = []) {
  return {
    radar_demanda: { registros, seguimientos: [] },
    pos: {
      sucursales: [{ id: 1, nombre: "Centro" }, { id: 2, nombre: "Norte" }],
      ventas: [{ id: 100, sucursal_id: 1, total: 2500 }, { id: 200, sucursal_id: 2, total: 9000 }],
    },
  };
}

const global = { verTodas: true, sucursalId: null };
const sucursal1 = { verTodas: false, sucursalId: 1 };
const analizar = (registros, filtros = { fecha_inicio: "2026-08-01", fecha_fin: "2026-08-20" }, alcance = global) => obtenerAnalisis(base(registros), alcance, filtros);

test("contrato superior exacto", () => assert.deepEqual(Object.keys(analizar([])), ["periodo","resumen","productos","productos_no_manejados","sucursales","motivos","recuperacion","evolucion","comparaciones"]));
test("rango incluye fecha inicial", () => assert.equal(analizar([registro(1, { fecha_registro: "2026-08-01T23:59:59Z" })]).resumen.total, 1));
test("rango incluye todo el día final", () => assert.equal(analizar([registro(1, { fecha_registro: "2026-08-20T23:59:59Z" })]).resumen.total, 1));
test("rango excluye fecha anterior", () => assert.equal(analizar([registro(1, { fecha_registro: "2026-07-31T23:59:59Z" })]).resumen.total, 0));
test("rango excluye fecha posterior", () => assert.equal(analizar([registro(1, { fecha_registro: "2026-08-21T06:00:00Z" })]).resumen.total, 0));
test("convierte el ISO UTC al día local antes de filtrar", () => assert.equal(analizar([registro(1, { fecha_registro: "2026-08-21T03:00:00Z" })]).resumen.total, 1));
test("rechaza fecha imposible", () => assert.throws(() => analizar([], { fecha_inicio: "2026-02-30", fecha_fin: "2026-08-20" }), /fecha válida/));
test("rechaza formato flexible", () => assert.throws(() => analizar([], { fecha_inicio: "20-08-2026", fecha_fin: "2026-08-20" }), /YYYY-MM-DD/));
test("rechaza inicio posterior al fin", () => assert.throws(() => analizar([], { fecha_inicio: "2026-08-21", fecha_fin: "2026-08-20" }), /anterior o igual/));
test("suma cantidad solicitada", () => assert.equal(analizar([registro(1,{cantidad:2}),registro(2,{cantidad:3})]).resumen.cantidad_solicitada, 5));
test("cuenta los cuatro estados pendientes", () => assert.equal(analizar(["REGISTRADA","EN_SEGUIMIENTO","PRODUCTO_DISPONIBLE","CLIENTE_CONTACTADO"].map((estado,i)=>registro(i+1,{estado}))).resumen.pendientes, 4));
test("cuenta convertidas", () => assert.equal(analizar([registro(1,{estado:"CONVERTIDA"})]).resumen.convertidas, 1));
test("cuenta no convertidas", () => assert.equal(analizar([registro(1,{estado:"NO_CONVERTIDA"})]).resumen.no_convertidas, 1));
test("cuenta canceladas", () => assert.equal(analizar([registro(1,{estado:"CANCELADA"})]).resumen.canceladas, 1));
test("conversión usa solo cierres decididos", () => assert.equal(analizar([registro(1,{estado:"CONVERTIDA"}),registro(2,{estado:"NO_CONVERTIDA"}),registro(3)]).resumen.tasa_conversion, 50));
test("conversión cero sin denominador", () => assert.equal(analizar([registro(1)]).resumen.tasa_conversion, 0));
test("recuperación incluye pendientes", () => assert.equal(analizar([registro(1,{estado:"CONVERTIDA"}),registro(2,{estado:"NO_CONVERTIDA"}),registro(3)]).resumen.tasa_recuperacion, 33.33));
test("canceladas no afectan tasas", () => assert.equal(analizar([registro(1,{estado:"CONVERTIDA"}),registro(2,{estado:"CANCELADA"})]).resumen.tasa_recuperacion, 100));
test("aislamiento por sucursal", () => assert.equal(analizar([registro(1),registro(2,{sucursal_id:2})], undefined, sucursal1).resumen.total, 1));
test("agrupa producto catalogado por id", () => assert.equal(analizar([registro(1),registro(2,{producto_nombre_registrado:"Snapshot nuevo"})]).productos.length, 1));
test("agrupa producto libre conservador", () => assert.equal(analizar([registro(1,{producto_id:null,producto_buscado:"  Mezcladora  X ",marca_solicitada:"Marca"}),registro(2,{producto_id:null,producto_buscado:"mezcladora x",marca_solicitada:" marca "})]).productos.length, 1));
test("no mezcla variantes libres", () => assert.equal(analizar([registro(1,{producto_id:null,producto_buscado:"Bocina",variante_solicitada:"Roja"}),registro(2,{producto_id:null,producto_buscado:"Bocina",variante_solicitada:"Azul"})]).productos.length, 2));
test("deduplica cliente identificado por grupo", () => assert.equal(analizar([registro(1,{cliente_id:8}),registro(2,{cliente_id:8})]).productos[0].contactos_identificados, 1));
test("deduplica teléfono cuando no hay cliente", () => assert.equal(analizar([registro(1,{telefono_contacto:"961 100"}),registro(2,{telefono_contacto:" 961 100 "})]).productos[0].contactos_identificados, 1));
test("anónimo no cuenta como contacto", () => assert.equal(analizar([registro(1)]).productos[0].contactos_identificados, 0));
test("NO_MANEJAMOS tiene bloque propio", () => assert.equal(analizar([registro(1,{motivo_no_venta:"NO_MANEJAMOS",producto_id:null,producto_buscado:"Consola"})]).productos_no_manejados[0].producto, "Consola"));
test("todos los motivos aparecen incluso en cero", () => assert.deepEqual(analizar([]).motivos.map((x)=>x.motivo), MOTIVOS_DEMANDA));
test("porcentaje de motivos usa total del rango", () => assert.equal(analizar([registro(1),registro(2,{motivo_no_venta:"PRECIO"})]).motivos.find((x)=>x.motivo==="PRECIO").porcentaje, 50));
test("venta recuperada se deduplica y suma una vez", () => { const DB=base([registro(1,{estado:"CONVERTIDA",venta_recuperada_id:100}),registro(2,{estado:"CONVERTIDA",venta_recuperada_id:100})]); const r=obtenerAnalisis(DB,global,{fecha_inicio:"2026-08-01",fecha_fin:"2026-08-20"}).recuperacion; assert.deepEqual([r.ventas_recuperadas,r.valor_recuperado],[1,2500]); });
test("venta ajena a la sucursal no se recupera", () => { const DB=base([registro(1,{estado:"CONVERTIDA",venta_recuperada_id:200})]); assert.equal(obtenerAnalisis(DB,global,{fecha_inicio:"2026-08-01",fecha_fin:"2026-08-20"}).recuperacion.ventas_recuperadas,0); });
test("evolución rellena días sin demanda", () => { const x=analizar([registro(1)],{fecha_inicio:"2026-08-18",fecha_fin:"2026-08-20"}); assert.deepEqual(x.evolucion.map((d)=>d.demandas),[0,0,1]); });
test("comparación de 7 días se ancla al fin", () => { const registros=[registro(1,{fecha_registro:"2026-08-20T10:00:00Z"}),registro(2,{fecha_registro:"2026-08-13T10:00:00Z"})]; const c=analizar(registros).comparaciones.ultimos_7_dias; assert.deepEqual([c.actual,c.anterior],[1,1]); });
test("comparación sin base devuelve porcentaje nulo", () => assert.equal(analizar([registro(1)]).comparaciones.ultimos_30_dias.variacion_porcentual,null));
test("seguimiento vencido exige pendiente y seguimiento", () => { const x=analizar([registro(1,{requiere_seguimiento:true,fecha_seguimiento:"2020-01-01"}),registro(2,{estado:"CONVERTIDA",requiere_seguimiento:true,fecha_seguimiento:"2020-01-01"})]); assert.equal(x.resumen.seguimientos_vencidos,1); });
test("BLX24 permanece separado de BLX288", () => assert.equal(analizar([registro(1,{producto_id:null,producto_buscado:"BLX24"}),registro(2,{producto_id:null,producto_buscado:"BLX288"})]).productos.length,2));
test("análisis no modifica DB", () => { const DB=base([registro(1)]); const antes=JSON.stringify(DB); obtenerAnalisis(DB,global,{fecha_inicio:"2026-08-01",fecha_fin:"2026-08-20"}); assert.equal(JSON.stringify(DB),antes); });
test("aísla cinco sucursales", () => { const registros=Array.from({length:5},(_,i)=>registro(i+1,{sucursal_id:i+1})); const x=obtenerAnalisis(base(registros),{verTodas:false,sucursalId:4},{fecha_inicio:"2026-08-01",fecha_fin:"2026-08-20"}); assert.deepEqual([x.resumen.total,x.sucursales[0].sucursal_id],[1,4]); });
test("comparación marca muestra suficiente con cinco demandas", () => { const registros=Array.from({length:5},(_,i)=>registro(i+1,{fecha_registro:`2026-08-${16+i}T10:00:00Z`})); assert.equal(analizar(registros).comparaciones.ultimos_7_dias.muestra_suficiente,true); });

let servidor, url, tokenLimitado, tokenSinPermiso, tokenAdmin;
before(async () => {
  app.DB.admin.roles.push(
    { id: 9801, nombre: "Analista Radar", permisos: ["ver_resumen_demanda"], modulos: ["radar_demanda"] },
    { id: 9802, nombre: "Sin análisis Radar", permisos: [], modulos: ["radar_demanda"] },
  );
  app.DB.admin.usuarios.push(
    { id: 9801, nombre: "Analista limitado", usuario: "analista.radar", rol_id: 9801, sucursal_id: 1, activo: true },
    { id: 9802, nombre: "Sin permiso", usuario: "sin.analisis", rol_id: 9802, sucursal_id: 1, activo: true },
  );
  if (!app.DB.admin.usuarios.some((u) => u.id === 1)) app.DB.admin.usuarios.push({ id: 1, nombre: "Admin", usuario: "admin", rol_id: 1, sucursal_id: 1, activo: true });
  app.DB.radar_demanda = { registros: [registro(9801), registro(9802, { sucursal_id: 2 })], seguimientos: [] };
  tokenLimitado = firmarToken({ id: 9801, nombre: "Analista limitado", rol_id: 9801, sucursal_id: 1 });
  tokenSinPermiso = firmarToken({ id: 9802, nombre: "Sin permiso", rol_id: 9802, sucursal_id: 1 });
  tokenAdmin = firmarToken({ id: 1, nombre: "Admin", rol_id: 1, sucursal_id: 1 });
  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  url = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  for (const sufijo of ["", "-wal", "-shm"]) { try { fs.unlinkSync(BASE_DESECHABLE + sufijo); } catch { /* no existe */ } }
});
async function pedirAnalisis(token, query = "") {
  const respuesta = await fetch(`${url}/api/radar-demanda/analisis${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}
test("endpoint de análisis requiere login", async () => assert.equal((await pedirAnalisis()).status, 401));
test("endpoint de análisis requiere ver_resumen_demanda", async () => assert.equal((await pedirAnalisis(tokenSinPermiso)).status, 403));
test("endpoint limita al usuario a su sucursal", async () => assert.equal((await pedirAnalisis(tokenLimitado, "?fecha_inicio=2026-08-01&fecha_fin=2026-08-20")).cuerpo.resumen.total, 1));
test("usuario limitado no manipula sucursal por query", async () => assert.equal((await pedirAnalisis(tokenLimitado, "?sucursal_id=2&fecha_inicio=2026-08-01&fecha_fin=2026-08-20")).cuerpo.resumen.total, 1));
test("usuario global consulta todas o filtra una sucursal", async () => { const todas=await pedirAnalisis(tokenAdmin,"?sucursal_id=todas&fecha_inicio=2026-08-01&fecha_fin=2026-08-20"); const una=await pedirAnalisis(tokenAdmin,"?sucursal_id=2&fecha_inicio=2026-08-01&fecha_fin=2026-08-20"); assert.deepEqual([todas.cuerpo.resumen.total,una.cuerpo.resumen.total],[2,1]); });
test("endpoint devuelve 400 para fecha imposible", async () => assert.equal((await pedirAnalisis(tokenAdmin,"?fecha_inicio=2026-02-30&fecha_fin=2026-08-20")).status,400));
