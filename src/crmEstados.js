export const ESTADOS = [
  { id: 'contactado', label: 'Contactado', color: '#94a3b8' },
  { id: 'interesado', label: 'Interesado', color: '#3b82f6' },
  { id: 'visito_tienda', label: 'En tienda', color: '#1d4ed8' },
  { id: 'compro', label: 'Compró', color: '#1e40af' },
  { id: 'perdido', label: 'Perdido', color: '#cbd5e1' },
];

export function numeroWhatsApp(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (/^\d{10}$/.test(digitos)) return `52${digitos}`;
  return /^52\d{10}$/.test(digitos) ? digitos : null;
}
