export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = String(value).replace(/[^\d,.-]/g, '');
  if (!text) return null;

  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoney(value) {
  if (value == null) return '-';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPercent(value) {
  if (value == null) return '-';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function cellToText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('text' in value && value.text != null) return String(value.text);
    if ('result' in value && value.result != null) return String(value.result);
    if ('formula' in value && value.result != null) return String(value.result);
  }
  return String(value);
}
