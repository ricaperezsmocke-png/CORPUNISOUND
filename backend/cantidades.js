// "12.3400" -> 123400n (diezmilesimas), exacto y sin flotantes.
function aDiezmilesimas(texto) {
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(texto));
  if (!m) return 0n;
  const n = BigInt(m[2]) * 10000n + BigInt((m[3] ?? '').padEnd(4, '0'));
  return m[1] ? -n : n;
}

module.exports = { aDiezmilesimas };
