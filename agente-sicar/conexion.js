const { opcionesConexion } = require('./seguridad');
async function conectar(config) {
  const opciones = opcionesConexion(config);
  // Ninguna prueba ni módulo puro necesita mysql2 instalado.
  const mysql = require('mysql2/promise');
  return mysql.createConnection(opciones);
}
module.exports = { conectar };
