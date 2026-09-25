import { test } from "node:test";
import assert from "node:assert/strict";
import * as datos from "./datos.js";
import { diasDeAtraso, finDelMes, hoyLocal, leer, sugerenciaGuardada } from "./datos.js";

test("periodoEnTienda muestra fechas y motivo de baja sin cambiar el día por zona horaria", () => {
  assert.equal(datos.periodoEnTienda({ desde: "2026-09-01", hasta: "2026-09-15", motivo_baja: "Traslado" }),
    "01/09–15/09 · Traslado");
  assert.equal(datos.periodoEnTienda({ desde: "2026-09-03", hasta: null }), "desde 03/09");
  assert.equal(datos.periodoEnTienda({ desde: null, hasta: null }), "");
});

test("estadoReparto muestra faltante y exceso en pesos con centavos positivos", () => {
  assert.deepEqual(datos.estadoReparto({ meta: 100, sinAsignar: 12.51, unidad: "pesos" }), {
    tono: "falta", texto: "⚠ Faltan $12.51 por repartir",
  });
  assert.deepEqual(datos.estadoReparto({ meta: 100, sinAsignar: -0.01, unidad: "pesos" }), {
    tono: "exceso", texto: "✖ Asignaste $0.01 de más",
  });
});

test("estadoReparto compara pesos en centavos incluso con 0.1 + 0.2 frente a 0.3", () => {
  for (const sinAsignar of [0, 0.1 + 0.2 - 0.3, 0.3 - (0.1 + 0.2)]) {
    assert.deepEqual(datos.estadoReparto({ meta: 0.3, sinAsignar, unidad: "pesos" }), {
      tono: "completo", texto: "✔ Reparto completo",
    });
  }
});

test("estadoReparto da prioridad a meta cero en ambas unidades", () => {
  for (const unidad of ["pesos", "unidades"]) {
    for (const sinAsignar of [-10, 0, 10]) {
      assert.deepEqual(datos.estadoReparto({ meta: 0, sinAsignar, unidad }), {
        tono: "sin_meta", texto: "Sin meta de tienda",
      });
    }
  }
});

test("estadoReparto expresa unidades enteras sin formato de dinero", () => {
  for (const [sinAsignar, tono, texto] of [
    [10, "falta", "⚠ Faltan 10 por repartir"],
    [-3, "exceso", "✖ Asignaste 3 de más"],
    [0, "completo", "✔ Reparto completo"],
  ]) {
    assert.deepEqual(datos.estadoReparto({ meta: 20, sinAsignar, unidad: "unidades" }), { tono, texto });
  }
});

test("filasReparto conserva orden, baja y monto cero y une ids texto y número sin duplicados", () => {
  const baja = { vendedor_id: "9", desde: "2026-09-01", hasta: "2026-09-15", motivo_baja: "Traslado" };
  const plantilla = [baja, { vendedor_id: 2, desde: "2026-09-03", hasta: null, motivo_baja: null }];
  const lineas = [{ vendedor_id: 2, monto: 0 }, { vendedor_id: 9, monto: 12.51 }, { vendedor_id: "3", monto: 5 }];
  const copia = structuredClone({ plantilla, lineas });
  assert.deepEqual(datos.filasReparto({ plantilla, lineas }), [
    { ...baja, vendedor_id: 9, monto: 12.51 },
    { vendedor_id: 2, desde: "2026-09-03", hasta: null, motivo_baja: null, monto: 0 },
    { vendedor_id: 3, desde: null, hasta: null, motivo_baja: null, monto: 5 },
  ]);
  assert.deepEqual({ plantilla, lineas }, copia);
});

test("filasReparto distingue ausencia de línea y admite listas vacías", () => {
  assert.deepEqual(datos.filasReparto({ plantilla: [], lineas: [] }), []);
  assert.deepEqual(datos.filasReparto({ plantilla: [{ vendedor_id: "2", desde: "2026-09-01" }], lineas: [] }), [
    { vendedor_id: 2, desde: "2026-09-01", hasta: null, motivo_baja: null, monto: null },
  ]);
});

test("ventaDelDia distingue ausencia de venta cero y omite otras fechas y versiones", () => {
  const cero = { id: 3, fecha: "2026-09-25", tipo: "venta", vigente: 1, monto: 0 };
  const capturas = [
    { ...cero, id: 1, vigente: 0, monto: 20 },
    { ...cero, id: 2, fecha: "2026-09-24" }, cero,
  ];
  assert.equal(datos.ventaDelDia(capturas, "2026-09-25"), cero);
  assert.equal(datos.ventaDelDia(capturas, "2026-09-23"), null);
  assert.equal(datos.ventaDelDia([], "2026-09-25"), null);
});

test("ventaDelDia ignora marcas, productos y créditos y acepta venta histórica sin tipo", () => {
  const base = { fecha: "2026-09-25", vigente: 1, monto: 10 };
  const otras = ["marca", "producto", "credito"].map((tipo) => ({ ...base, tipo }));
  assert.equal(datos.ventaDelDia(otras, base.fecha), null);
  for (const tipo of [undefined, null, "venta"]) {
    const venta = { ...base, tipo };
    assert.equal(datos.ventaDelDia([...otras, venta], base.fecha), venta);
  }
});

test("resumenVenta conserva centavos y redondea el porcentaje sin limitarlo a cien", () => {
  assert.deepEqual(datos.resumenVenta({ meta: 26000, total: 18400 }), {
    texto: "Llevas $18,400.00 de $26,000.00 · 71 %", porcentaje: 71,
  });
  assert.deepEqual(datos.resumenVenta({ meta: 10, total: 12.51 }), {
    texto: "Llevas $12.51 de $10.00 · 125 %", porcentaje: 125,
  });
});

test("resumenVenta no inventa porcentaje ni ausencia de meta con meta cero o ausente", () => {
  for (const meta of [0, undefined]) {
    assert.deepEqual(datos.resumenVenta({ meta, total: 23.45 }), {
      texto: "Llevas $23.45 registrados", porcentaje: null,
    });
  }
});

test("fechaCorta conserva los ceros del día y del mes", () => {
  assert.equal(datos.fechaCorta("2026-09-21"), "21/09");
  assert.equal(datos.fechaCorta("2026-01-02"), "02/01");
});

test("fechaLarga calcula el día real incluso en límites de año y febrero bisiesto", () => {
  assert.equal(datos.fechaLarga("2026-09-25"), "viernes 25 de septiembre");
  assert.equal(datos.fechaLarga("2026-01-01"), "jueves 1 de enero");
  assert.equal(datos.fechaLarga("2024-02-29"), "jueves 29 de febrero");
});

test("hoy usa el día de Chiapas al cambiar el mes en UTC", () => {
  assert.equal(hoyLocal(new Date("2026-10-01T02:00:00Z")), "2026-09-30");
});

test("el atraso compara días de Chiapas y no el día UTC de la marca", () => {
  assert.equal(diasDeAtraso({ fecha: "2026-09-15", capturado_en: "2026-09-16T02:00:00Z" }), 0);
  assert.equal(diasDeAtraso({ fecha: "2026-09-13", capturado_en: "2026-09-16T02:00:00Z" }), 2);
  assert.equal(diasDeAtraso({ fecha: "2026-08-31", capturado_en: "2026-09-02T06:00:00Z" }), 2);
});

test("el límite de desde respeta febrero bisiesto y diciembre", () => {
  assert.equal(finDelMes("2024-02"), "2024-02-29");
  assert.equal(finDelMes("2026-02"), "2026-02-28");
  assert.equal(finDelMes("2026-12"), "2026-12-31");
});

test("la lectura conserva texto y 404 para avisar de una cuenta mal ligada", async () => {
  const respuesta = new Response(JSON.stringify({ error: "Vendedor no encontrado" }), { status: 404 });
  await assert.rejects(leer(respuesta, "Error genérico"), { message: "Vendedor no encontrado", status: 404 });
});

test("una sugerencia queda guardada solo al coincidir persona y monto vigente", () => {
  const lineas = [{ vendedor_id: 1, monto: 1 }, { vendedor_id: 2, monto: 0 }];
  assert.equal(sugerenciaGuardada({ vendedor_id: 1, monto: 1 }, lineas), true);
  assert.equal(sugerenciaGuardada({ vendedor_id: 2, monto: 2 }, lineas), false);
  assert.equal(sugerenciaGuardada({ vendedor_id: 2, monto: 1 }, lineas), false);
});

test("comparar sugerencias normaliza ids y montos numéricos recibidos como texto", () => {
  assert.equal(sugerenciaGuardada({ vendedor_id: "9", monto: "1250.50" }, [{ vendedor_id: 9, monto: 1250.5 }]), true);
  assert.equal(sugerenciaGuardada({ vendedor_id: 9, monto: 1250.5 }, [{ vendedor_id: "9", monto: "1250.50" }]), true);
  assert.equal(sugerenciaGuardada({ vendedor_id: 9, monto: 1250.5 }, [{ vendedor_id: 9, monto: 1250.51 }]), false);
});

test("cero coincide con cero vigente, pero una persona ausente no se considera guardada", () => {
  const sugerencia = { vendedor_id: 1, monto: 0 };
  assert.equal(sugerenciaGuardada(sugerencia, [{ vendedor_id: 1, monto: 0 }]), true);
  assert.equal(sugerenciaGuardada(sugerencia, []), false);
  assert.equal(sugerenciaGuardada(sugerencia, [{ vendedor_id: 2, monto: 0 }]), false);
});
