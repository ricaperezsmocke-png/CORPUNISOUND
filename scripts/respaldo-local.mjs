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
  let config;
  try {
    config = JSON.parse(await fs.readFile(RUTA_CONFIG, "utf8"));
  } catch (e) {
    log(`ERROR: no se pudo leer ${RUTA_CONFIG} — ${e.message}`);
    process.exit(1);
  }
  const { api, token, carpeta, diasAConservar = 90 } = config;
  if (!api || !token || !carpeta) {
    log("ERROR: la configuración necesita api, token y carpeta.");
    process.exit(1);
  }

  await fs.mkdir(carpeta, { recursive: true });
  const yaTengo = new Set(await fs.readdir(carpeta));

  // El índice se pide con el token de descarga, igual que los archivos.
  const r = await fetch(`${api}/respaldos/indice`, { headers: { "X-Token-Respaldo": token } });
  if (!r.ok) {
    log(`ERROR: el servidor respondió ${r.status} al pedir el índice.`);
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
    try {
      const rr = await fetch(`${api}/respaldos/${c.id}/descargar`, { headers: { "X-Token-Respaldo": token } });
      if (!rr.ok) { log(`AVISO: ${c.nombre_archivo} respondió ${rr.status}, se salta.`); continue; }
      const bytes = Buffer.from(await rr.arrayBuffer());
      // Se escribe a un temporal y se renombra: así un corte a media descarga
      // nunca deja un archivo a medias con nombre de archivo bueno.
      const temporal = path.join(carpeta, `.${c.nombre_archivo}.parcial`);
      await fs.writeFile(temporal, bytes);
      await fs.rename(temporal, path.join(carpeta, c.nombre_archivo));
      log(`Bajado ${c.nombre_archivo} (${bytes.length} bytes)`);
      bajados++;
    } catch (e) {
      log(`AVISO: falló ${c.nombre_archivo} — ${e.message}`);
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

  log(`Listo. ${bajados} nuevos, ${(await fs.readdir(carpeta)).length} en total.`);
}

main().catch((e) => { log("ERROR: " + e.message); process.exit(1); });
