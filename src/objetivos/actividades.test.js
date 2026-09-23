import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { avanceActividad, leerArchivoComoBase64 } from "./actividades.js";

for (const tipo of ["image/jpeg", "image/png"]) {
  test(`convierte ${tipo} a base64 sin prefijo y conserva nombre y tipo`, async () => {
    const archivo = new File([new Uint8Array([0, 255, 128, 65])], "evidencia á.png", { type: tipo });
    assert.deepEqual(await leerArchivoComoBase64(archivo), {
      nombre_archivo: "evidencia á.png", tipo_mime: tipo, contenido_base64: "AP+AQQ==",
    });
  });
}

test("rechaza PDF, video y tipo vacío antes de leer el contenido", async () => {
  for (const type of ["application/pdf", "video/mp4", ""]) {
    const archivo = { type, size: 1, arrayBuffer: () => assert.fail("No debe leer un tipo rechazado") };
    await assert.rejects(leerArchivoComoBase64(archivo), { message: "Tipo de archivo no permitido: solo JPG o PNG" });
  }
});

test("rechaza más de 10 MB antes de leer el contenido", async () => {
  const archivo = {
    type: "image/jpeg", size: 10 * 1024 * 1024 + 1,
    arrayBuffer: () => assert.fail("No debe leer un archivo demasiado grande"),
  };
  await assert.rejects(leerArchivoComoBase64(archivo), { message: "El archivo no puede pesar más de 10 MB" });
});

test("acepta exactamente 10 MB sin truncar los bytes", async () => {
  const bytes = new Uint8Array(10 * 1024 * 1024).fill(255);
  const archivo = new File([bytes], "grande.jpg", { type: "image/jpeg" });
  const resultado = await leerArchivoComoBase64(archivo);
  assert.deepEqual(Buffer.from(resultado.contenido_base64, "base64"), Buffer.from(bytes));
});

test("pide una foto si falta el archivo o está vacío", async () => {
  for (const archivo of [null, undefined, new File([], "vacia.png", { type: "image/png" })]) {
    await assert.rejects(leerArchivoComoBase64(archivo), { message: "Adjunta una foto en JPG o PNG" });
  }
});

test("propaga un fallo de lectura sin producir evidencia incompleta", async () => {
  const archivo = {
    name: "foto.png", type: "image/png", size: 1,
    arrayBuffer: async () => { throw new Error("No se pudo leer la foto"); },
  };
  await assert.rejects(leerArchivoComoBase64(archivo), { message: "No se pudo leer la foto" });
});

for (const [nombre, datos, esperado] of [
  ["sin meta ni registros", { meta: 0, declaradas: 0 }, { porcentaje: 0, faltan: 0 }],
  ["sin meta con registros", { meta: 0, declaradas: 2 }, { porcentaje: 0, faltan: 0 }],
  ["avance parcial redondeado", { meta: 3, declaradas: 1 }, { porcentaje: 33, faltan: 2 }],
  ["meta alcanzada", { meta: 4, declaradas: 4 }, { porcentaje: 100, faltan: 0 }],
  ["meta superada sin faltantes negativos", { meta: 4, declaradas: 5 }, { porcentaje: 125, faltan: 0 }],
]) {
  test(nombre, () => assert.deepEqual(avanceActividad(datos), esperado));
}
