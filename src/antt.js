import { normalizeText, parseNumber } from './utils.js';

export const ANTT_URL = 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&link=S&tipo=POR&numeroAto=00000004&seqAto=000&valorAno=2026&orgao=SUROC/ANTT/MT&cod_modulo=161&cod_menu=7804';
const AXIS_ORDER = [2, 3, 4, 5, 6, 7, 9];

const anttCache = { tables: null, promise: null };

export function normalizeAnttLoadType(label) {
  const value = normalizeText(label);
  if (value.includes('PERIGOSA') && value.includes('GRANEL SOLID')) return 'granel-solido';
  if (value.includes('PERIGOSA') && value.includes('GRANEL LIQUID')) return 'granel-liquido';
  if (value.includes('PERIGOSA') && value.includes('FRIGORIFIC')) return 'frigorificada';
  if (value.includes('PERIGOSA') && (value.includes('CONTEINER') || value.includes('CNTR'))) return 'conteinerizada';
  if (value.includes('PERIGOSA') && value.includes('CARGA GERAL')) return 'carga-geral';
  if (value.includes('CONTEINER') || value.includes('CNTR') || value.includes('EXPORTACAO')) return 'conteinerizada';
  if (value.includes('FRIGORIFIC') || value.includes('AQUEC')) return 'frigorificada';
  if (value.includes('GRANEL LIQUID') || value.includes('AMONIA') || value.includes('ACIDO') || value.includes('BENZENO') || value.includes('TOLUENO') || value.includes('ACETONITRILA') || value.includes('LATEX GRANEL') || value.includes('ESTIRENO') || value.includes('ETILBENZENO')) return 'granel-liquido';
  if (value.includes('UREIA') && (value.includes('SACARIA') || value.includes('EMBALADO'))) return 'carga-geral';
  if (value.includes('MRO') || value.includes('ATIVOS') || value.includes('CARGA SECA') || value.includes('RESIDUOS') || value.includes('CABOTAGEM')) return 'carga-geral';
  if (value.includes('GRANEL LIQUID')) return 'granel-liquido';
  if (value.includes('GRANEL SOLID')) return 'granel-solido';
  if (value.includes('CARGA GERAL')) return 'carga-geral';
  if (value.includes('NEOGRANEL')) return 'neogranel';
  if (value.includes('GRANEL PRESSUR')) return 'granel-pressurizada';
  return null;
}

function ensureAnttEntry(tables, tableKey, loadType, dangerousLoad) {
  const key = `${loadType}-${dangerousLoad}`;
  if (!tables[tableKey][key]) tables[tableKey][key] = { ccd: {}, cc: {} };
  return tables[tableKey][key];
}

function parseAnttCellNumber(value) {
  const parsed = parseNumber(value);
  return parsed == null ? null : parsed;
}

export async function loadOfficialAnttTables() {
  if (anttCache.tables) return anttCache.tables;
  if (anttCache.promise) return anttCache.promise;

  anttCache.promise = fetch(ANTT_URL)
    .then(response => response.text())
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tables = { A: {}, B: {}, C: {}, D: {} };
      const htmlTables = Array.from(doc.querySelectorAll('table'));

      htmlTables.forEach((htmlTable, index) => {
        const tableKey = ['A', 'B', 'C', 'D'][index];
        if (!tableKey) return;
        const rows = Array.from(htmlTable.querySelectorAll('tr'));
        let currentLoadType = null;
        let currentDangerousLoad = false;

        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('th,td')).map(cell => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
          if (cells.length < 6) continue;

          const hasLoadLabel = /^\d+$/.test(cells[0] ?? '') && cells[1];
          if (hasLoadLabel) {
            currentLoadType = normalizeAnttLoadType(cells[1]);
            currentDangerousLoad = normalizeText(cells[1]).includes('PERIGOSA');
          }

          const metric = normalizeText(cells[2]);
          if (!currentLoadType || (!metric.includes('DESLOCAMENTO') && !metric.includes('CARGA E DESCARGA'))) continue;

          const values = cells.slice(4).map(parseAnttCellNumber);
          const entry = ensureAnttEntry(tables, tableKey, currentLoadType, currentDangerousLoad);

          AXIS_ORDER.forEach((axis, valueIndex) => {
            const value = values[valueIndex] ?? null;
            if (metric.includes('DESLOCAMENTO')) entry.ccd[axis] = value;
            if (metric.includes('CARGA E DESCARGA')) entry.cc[axis] = value;
          });
        }
      });

      anttCache.tables = tables;
      return tables;
    })
    .finally(() => {
      anttCache.promise = null;
    });

  return anttCache.promise;
}

export function selectTableKey(onlyTractionVehicle, highPerformance) {
  if (!onlyTractionVehicle && !highPerformance) return 'A';
  if (onlyTractionVehicle && !highPerformance) return 'B';
  if (!onlyTractionVehicle && highPerformance) return 'C';
  return 'D';
}

export function calculateAnttFromOfficialTables(params, tables) {
  const tableKey = selectTableKey(params.onlyTractionVehicle, params.highPerformance);
  const entryKey = `${params.loadType}-${params.dangerousLoad}`;
  const table = tables?.[tableKey] ?? {};
  let entry = table[entryKey];

  if (!entry) {
    const fallbackKey = Object.keys(table).find(key => key.startsWith(`${params.loadType}-`));
    if (fallbackKey) entry = table[fallbackKey];
  }

  if (!entry) return null;

  const ccd = entry.ccd[params.axis];
  const cc = entry.cc[params.axis];
  if (ccd == null || cc == null) return null;

  const effectiveDistance = params.emptyReturn ? params.distance * 1.92 : params.distance;
  return effectiveDistance * ccd + cc;
}

export function inferLoadType(text) {
  const value = normalizeText(text);
  if (!value) return null;
  if (value.includes('CONTEINER') || value.includes('CNTR') || value.includes('EXPORTACAO')) return 'conteinerizada';
  if (value.includes('FRIGORIFIC') || value.includes('AQUEC')) return 'frigorificada';
  if (value.includes('PERIGOSA') && value.includes('GRANEL SOLID')) return 'granel-solido';
  if (value.includes('PERIGOSA') && value.includes('GRANEL LIQUID')) return 'granel-liquido';
  if (value.includes('PERIGOSA') && value.includes('FRIGORIFIC')) return 'frigorificada';
  if (value.includes('PERIGOSA') && (value.includes('CONTEINER') || value.includes('CNTR'))) return 'conteinerizada';
  if (value.includes('PERIGOSA') && value.includes('CARGA GERAL')) return 'carga-geral';
  if (value.includes('GRANEL LIQUID') || value.includes('AMONIA') || value.includes('ACIDO') || value.includes('BENZENO') || value.includes('TOLUENO') || value.includes('ACETONITRILA') || value.includes('LATEX GRANEL') || value.includes('ESTIRENO') || value.includes('ETILBENZENO')) return 'granel-liquido';
  if (value.includes('UREIA') && (value.includes('SACARIA') || value.includes('EMBALADO'))) return 'carga-geral';
  if (value.includes('MRO') || value.includes('ATIVOS') || value.includes('CARGA SECA') || value.includes('RESIDUOS') || value.includes('CABOTAGEM')) return 'carga-geral';
  if (value.includes('GRANEL LIQUID')) return 'granel-liquido';
  if (value.includes('GRANEL SOLID')) return 'granel-solido';
  if (value.includes('CARGA GERAL')) return 'carga-geral';
  if (value.includes('NEOGRANEL')) return 'neogranel';
  if (value.includes('GRANEL PRESSUR')) return 'granel-pressurizada';
  return null;
}

export function inferAxis(text) {
  const value = normalizeText(text);
  if (!value) return null;
  if (value.includes('BI-TREM') || value.includes('BITREM')) return 9;
  if (value.includes('CNTR') || value.includes('CONTEINER')) return 9;

  const codeMatch = value.match(/\bE([0-5])\b/);
  if (codeMatch?.[1]) {
    const code = Number(codeMatch[1]);
    const axisMap = { 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
    return axisMap[code] ?? null;
  }

  const capacityMatch = value.match(/\b(20|30|35|40|45)\s*M3\b/);
  if (capacityMatch?.[1]) {
    const capacityAxisMap = { 20: 2, 30: 3, 35: 4, 40: 5, 45: 6 };
    return capacityAxisMap[Number(capacityMatch[1])] ?? null;
  }

  const eMatch = value.match(/\bE\s*([2345679])\b/);
  if (eMatch?.[1]) return Number(eMatch[1]);
  const axMatch = value.match(/\b([2345679])\s*EIXOS?\b/);
  if (axMatch?.[1]) return Number(axMatch[1]);
  const numberMatch = value.match(/\b([2345679])\b/);
  if (numberMatch?.[1]) return Number(numberMatch[1]);
  return null;
}

export function inferOnlyTraction(...texts) {
  return texts.some(text => {
    const value = normalizeText(text);
    return value.includes('RETORNO VAZIO') || value === 'RV' || value.includes('SOMENTE TRACAO') || value.includes('UNIDADE DE TRACAO');
  });
}

export function inferDangerousLoad(...texts) {
  return texts.some(text => normalizeText(text).includes('PERIGOS'));
}

export function deriveCompanyValue(row, selectedHeader) {
  const sources = [
    selectedHeader,
    'FRETE - R$/VIAGEM',
    'VALOR VEICULO FIXO',
    'FRETE MINIMO',
  ];

  for (const source of sources) {
    const value = parseNumber(row[source]);
    if (value != null) {
      return { value, source };
    }
  }

  const tonnage = parseNumber(row.CAPACIDADE) ?? parseNumber(row['QUANTIDADE MINIMO']);
  const tonRate = parseNumber(row['FRETE - R$/TON']);
  if (tonnage != null && tonRate != null) {
    return {
      value: tonRate * tonnage,
      source: `FRETE - R$/TON × ${tonnage} TON`,
    };
  }

  const distance = parseNumber(row.KM);
  const tonKm = parseNumber(row['FRETE TON/KM']);
  if (distance != null && tonKm != null) {
    return {
      value: distance * tonKm,
      source: 'FRETE TON/KM × KM',
    };
  }

  return { value: null, source: '' };
}

export function classifyDifference(companyValue, anttValue, belowThresholdReal, aboveThresholdReal) {
  if (companyValue == null || anttValue == null || anttValue === 0) {
    return { classification: 'sem cálculo', diff: null, diffPct: null };
  }

  const diff = companyValue - anttValue;
  const diffPct = (diff / anttValue) * 100;
  const below = Math.abs(belowThresholdReal);
  const above = Math.abs(aboveThresholdReal);

  if (diff <= -below) return { classification: 'frete 1', diff, diffPct };
  if (diff >= above) return { classification: 'frete 2', diff, diffPct };
  return { classification: 'conforme', diff, diffPct };
}
