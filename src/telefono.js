/**
 * Dígitos de un teléfono para validar en pantalla: sin espacios, guiones ni
 * paréntesis, y si sobran (+52, 044) solo los últimos 10. Misma regla que
 * `normalizarTelefono` en backend/clientes.js, que es quien decide de verdad.
 */
export function digitosTelefono(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length > 10 ? digitos.slice(-10) : digitos;
}
