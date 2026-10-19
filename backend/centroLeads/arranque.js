const { inicializarPersistenciaCentroLeads } = require("./persistencia");

/**
 * Centro de Leads comparte el archivo SQLite con el POS, pero no puede impedir que el POS arranque:
 * una tienda que no puede cobrar por culpa de la bandeja de mensajes es peor que una bandeja apagada.
 * Si su migración falla, la transacción ya la deshizo; el módulo queda apagado y se avisa en el log.
 */
function iniciarCentroLeadsSeguro(sqlite, { inicializar = inicializarPersistenciaCentroLeads, avisar = console.error } = {}) {
  try {
    const { version } = inicializar(sqlite);
    return { disponible: true, version, error: null };
  } catch (e) {
    avisar("⚠️  Centro de Leads apagado: su base no se pudo preparar.", e.message);
    return { disponible: false, version: null, error: e.message };
  }
}

module.exports = { iniciarCentroLeadsSeguro };
