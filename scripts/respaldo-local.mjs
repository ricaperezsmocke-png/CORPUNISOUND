/**
 * respaldo-local.mjs — Baja a esta PC los puntos de restauración que le falten.
 *
 * Se pone AL CORRIENTE: compara lo que hay en la carpeta local contra lo que
 * hay en el servidor y baja todo lo que falte. Si la máquina estuvo apagada
 * tres días, al prender recupera los tres, no solo el de hoy.
 *
 * Los archivos quedan CIFRADOS. Para leerlos hace falta RESPALDO_LLAVE, que
 * Victor tiene anotada aparte. Una laptop robada no entrega la empresa.
 *
 * Configuración: archivo respaldo-local.config.json junto a este script:
 *   { "api": "https://punto-de-venta-backend.onrender.com/api",
 *     "token": "...",                      // TOKEN_DESCARGA_RESPALDOS de Render
 *     "carpeta": "C:\\Respaldos CORPUNISOUND",
 *     "diasAConservar": 90 }
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RUTA_CONFIG = path.join(AQUI, "respaldo-local.config.json");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  let contenido;
  try {
    contenido = await fs.readFile(RUTA_CONFIG, "utf8");
  } catch (e) {
    // e.message aquí es seguro: es un error de sistema de archivos (ENOENT,
    // permisos), nunca incluye contenido del archivo.
    log(`ERROR: no se pudo leer ${RUTA_CONFIG} — ${e.message}`);
    process.exit(1);
  }
  let config;
  try {
    config = JSON.parse(contenido);
  } catch (e) {
    // e.message de un JSON.parse fallido NO es seguro: V8 incrusta un
    // fragmento del archivo en el mensaje (y ese archivo lleva el token).
    // Mensaje fijo, sin e.message ni e.name.
    log(`ERROR: ${RUTA_CONFIG} no es JSON válido. Revisa que los valores tengan comillas.`);
    process.exit(1);
  }
  const { api, token, carpeta, diasAConservar = 90 } = config;
  if (!api || !token || !carpeta) {
    log("ERROR: la configuración necesita api, token y carpeta.");
    process.exit(1);
  }

  // Trampa real de JSON en rutas de Windows: si Victor escribe "C:\respaldos"
  // con UNA sola barra, `\r` es un escape VÁLIDO (retorno de carro) y JSON.parse
  // no se queja — la ruta queda corrupta en silencio, mkdir crea una carpeta
  // basura donde caiga, y el script reporta "Listo" como si todo estuviera bien.
  // Victor creería tener 90 días de respaldos en una carpeta vacía. Lo mismo con
  // \t (C:\temp), \b (C:\backup), \n (C:\nuevo) y \f. Solo "C:\Respaldos" con
  // mayúscula falla ruidosamente, porque \R no es un escape válido.
  if (/[\r\n\t\b\f\v]/.test(carpeta)) {
    log('ERROR: la ruta de "carpeta" tiene caracteres inválidos. En el archivo de');
    log('       configuración las barras van DOBLES: "C:\\\\Respaldos CORPUNISOUND"');
    process.exit(1);
  }
  if (!path.isAbsolute(carpeta)) {
    log(`ERROR: "carpeta" debe ser una ruta absoluta (empezando por C:\\), no "${carpeta}".`);
    process.exit(1);
  }

  await fs.mkdir(carpeta, { recursive: true });
  // Se registra la ruta REAL en cada corrida: si algún día los respaldos no
  // están donde Victor cree, el log dice exactamente dónde quedaron.
  log(`Carpeta de destino: ${path.resolve(carpeta)}`);
  const yaTengo = new Set(await fs.readdir(carpeta));

  // El índice se pide con el token de descarga, igual que los archivos.
  let r;
  try {
    r = await fetch(`${api}/respaldos/indice`, { headers: { "X-Token-Respaldo": token } });
  } catch (e) {
    // `fetch failed` a secas no le dice nada a nadie, y este log solo se lee el
    // día que algo va mal.
    log("ERROR: no se pudo conectar con el servidor. Revisa tu internet, o que el");
    log(`       sistema esté en línea (${api}). Se reintenta mañana.`);
    process.exit(1);
  }
  if (!r.ok) {
    if (r.status === 404) {
      // El 404 es a propósito en el backend (no confirma que la ruta exista),
      // pero en este log se lee como "la ruta no existe" y manda a buscar donde
      // no es.
      log("ERROR: el servidor respondió 404. Casi siempre significa que el token de");
      log("       este archivo no coincide con TOKEN_DESCARGA_RESPALDOS en Render,");
      log("       o que esa variable no está configurada allá.");
    } else if (r.status >= 500) {
      log(`ERROR: el servidor respondió ${r.status}. Puede estar reiniciándose o caído;`);
      log("       se reintenta mañana. Si sigue igual, revisa el panel de Render.");
    } else {
      log(`ERROR: el servidor respondió ${r.status} al pedir el índice.`);
    }
    process.exit(1);
  }
  const copias = await r.json();

  // Solo los puntos de restauración (los del día y los pre_restauracion). El
  // detalle por hora vive 7 días en Drive y no vale la pena duplicarlo aquí.
  const aBajar = copias
    .filter((c) => c.tipo !== "hora" && c.estado === "ok")
    .filter((c) => !yaTengo.has(c.nombre_archivo));

  if (!aBajar.length) {
    log(`Al corriente: ${yaTengo.size} respaldos locales, nada nuevo que bajar.`);
  }

  let bajados = 0;
  for (const c of aBajar) {
    // El nombre viene del servidor y esta tarea corre como administrador
    // (schtasks /RL HIGHEST): nunca se le pasa directo a path.join. Se toma
    // solo el nombre de archivo (sin ../ ni rutas) y se exige la forma que
    // realmente produce el servidor.
    const nombreSeguro = path.basename(c.nombre_archivo || "");
    if (!/^[\w.-]+\.respaldo$/.test(nombreSeguro)) {
      log(`AVISO: nombre_archivo sospechoso del servidor, se salta: ${JSON.stringify(c.nombre_archivo)}`);
      continue;
    }
    try {
      const rr = await fetch(`${api}/respaldos/${c.id}/descargar`, { headers: { "X-Token-Respaldo": token } });
      if (!rr.ok) { log(`AVISO: ${nombreSeguro} respondió ${rr.status}, se salta.`); continue; }
      const bytes = Buffer.from(await rr.arrayBuffer());
      // El índice ya trae el tamaño esperado: si no cuadra, el cuerpo no es
      // el respaldo completo (proxy caído, corte a medias) y no se debe
      // guardar como si ya lo tuviéramos, o nunca se vuelve a reintentar.
      if (typeof c.bytes === "number" && bytes.length !== c.bytes) {
        log(`AVISO: ${nombreSeguro} bajó con ${bytes.length} bytes, se esperaban ${c.bytes}; se descarta y se reintenta mañana.`);
        continue;
      }
      // Se escribe a un temporal y se renombra: así un corte a media descarga
      // nunca deja un archivo a medias con nombre de archivo bueno.
      const temporal = path.join(carpeta, `.${nombreSeguro}.parcial`);
      await fs.writeFile(temporal, bytes);
      await fs.rename(temporal, path.join(carpeta, nombreSeguro));
      log(`Bajado ${nombreSeguro} (${bytes.length} bytes)`);
      bajados++;
    } catch (e) {
      log(`AVISO: falló ${nombreSeguro} — ${e.message}`);
    }
  }

  // Limpieza local, con la misma red que el servidor: nunca dejar la carpeta
  // vacía. Si algo sale mal con las fechas, mejor archivos de más.
  // OJO (corregido por el escaneo previo, 2026-08-12): la versión anterior de
  // este bloque prometía "nunca dejar la carpeta vacía" y NO lo cumplía.
  // Comparaba `archivos.length > 1` dentro del loop contra una foto fija tomada
  // ANTES de empezar a borrar: ese número nunca bajaba, así que con 5 archivos
  // todos vencidos borraba los 5 y dejaba la carpeta vacía — justo el caso en
  // que la protección importa. Ahora se ordena por fecha y el índice 0 (el más
  // nuevo) queda fuera del loop: no hay conteo del que depender.
  const limite = Date.now() - diasAConservar * 24 * 60 * 60 * 1000;
  const nombres = (await fs.readdir(carpeta)).filter((n) => n.endsWith(".respaldo"));
  const conFecha = await Promise.all(
    nombres.map(async (n) => ({
      n,
      mtimeMs: (await fs.stat(path.join(carpeta, n))).mtimeMs,
    }))
  );
  conFecha.sort((a, b) => b.mtimeMs - a.mtimeMs); // el más nuevo primero
  for (let i = 1; i < conFecha.length; i++) {      // el índice 0 NUNCA se toca
    if (conFecha[i].mtimeMs < limite) {
      await fs.unlink(path.join(carpeta, conFecha[i].n));
      log(`Borrado por antigüedad: ${conFecha[i].n}`);
    }
  }

  // Los temporales de descargas cortadas se limpian: la poda de arriba solo mira
  // los `.respaldo`, así que un `.parcial` huérfano sobrevivía para siempre Y se
  // contaba en el "N en total" de abajo — que es justo la cifra tranquilizadora
  // que Victor lee. Con un `.parcial` y un respaldo real decía "2 en total".
  for (const n of await fs.readdir(carpeta)) {
    if (n.endsWith(".parcial")) {
      try { await fs.unlink(path.join(carpeta, n)); } catch (_) {}
    }
  }

  const finales = (await fs.readdir(carpeta)).filter((n) => n.endsWith(".respaldo"));
  log(`Listo. ${bajados} nuevos, ${finales.length} respaldos en total en la carpeta.`);
}

main().catch((e) => { log("ERROR: " + e.message); process.exit(1); });
