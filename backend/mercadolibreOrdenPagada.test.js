const { test } = require("node:test");
const assert = require("node:assert");

const { validarOrdenImportable } = require("./mercadolibre");

/**
 * `importarOrdenComoVenta` nunca miraba `orden.status`: traia la orden y la
 * creaba como venta cerrada, descontando inventario. Una orden CANCELADA o
 * pendiente de pago entraba igual, y con ella salia mercancia del inventario por
 * dinero que nunca llego.
 */
test("una orden pagada se importa", () => {
  assert.doesNotThrow(() => validarOrdenImportable({ status: "paid" }));
  assert.doesNotThrow(() => validarOrdenImportable({ status: "PAID" }));
});

test("una orden que no esta pagada se rechaza, y el mensaje dice en que estado esta", () => {
  for (const estado of ["cancelled", "payment_required", "payment_in_process", "confirmed", "invalid"]) {
    assert.throws(
      () => validarOrdenImportable({ status: estado }),
      new RegExp(estado, "i"),
      `dejo pasar ${estado}`
    );
  }
});

/** Una orden sin estado no se asume pagada: se rechaza diciendo que no se sabe. */
test("una orden sin estado se rechaza", () => {
  for (const orden of [{}, null, undefined, { status: "" }]) {
    assert.throws(() => validarOrdenImportable(orden), /desconocido/i);
  }
});
