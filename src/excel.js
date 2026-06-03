import { cellToText, normalizeText } from './utils.js';

const KNOWN_HEADERS = [
  'TIPO DE OPERAÇÃO',
  'NEGÓCIO',
  'PRODUTO',
  'TIPO DE VEICULO',
  'VEÍCULO',
  'CAPACIDADE',
  'COD TRANSPORTADOR',
  'TRANSPORTADOR',
  'TRANSP.',
  'TRANSP',
  'FRETE - R$/VIAGEM',
  'FRETE - R$/TON',
  'FRETE TON/KM',
  'KM',
  'CID ORIG',
  'CID DEST',
  'ROTA',
];

export function getSheetNames(workbook) {
  return (workbook?.worksheets || []).map(sheet => sheet.name);
}

export function guessBaseSheet(names) {
  return names.find(name => normalizeText(name) === 'BASE DE DADOS') || names[0] || '';
}

export function guessAnttSheet(names) {
  return names.find(name => normalizeText(name) === 'TABELA ANTT') || '';
}

export function detectHeaderRow(worksheet) {
  let bestRow = 1;
  let bestScore = -1;

  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let score = 0;

    row.eachCell({ includeEmpty: false }, cell => {
      const text = normalizeText(cell.value);
      if (!text) return;
      if (KNOWN_HEADERS.includes(text)) score += 3;
      else if (text.includes('TIPO DE OPERA')) score += 2;
      else if (text.includes('TRANSPORTADOR')) score += 2;
      else if (text.includes('FRETE - R$/')) score += 2;
      else if (text === 'KM' || text === 'PRODUTO' || text === 'NEGÓCIO') score += 1;
    });

    if (score > bestScore) {
      bestScore = score;
      bestRow = rowNumber;
    }
  }

  return bestRow;
}

export function extractSheetRecords(worksheet) {
  if (!worksheet) return [];

  const headerRowNumber = detectHeaderRow(worksheet);
  const headerRow = worksheet.getRow(headerRowNumber);
  const headers = [];

  headerRow.eachCell((cell, index) => {
    headers[index - 1] = normalizeText(cell.value);
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const out = {};
    let hasValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const value = row.getCell(index + 1).value;
      const text = cellToText(value);
      if (text.trim() !== '') hasValue = true;
      out[header] = text;
    });

    if (hasValue) rows.push(out);
  });

  return rows;
}
