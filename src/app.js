import { calculateAnttFromOfficialTables, classifyDifference, deriveCompanyValue, inferAxis, inferDangerousLoad, inferEmptyReturn, inferLoadType, inferOnlyTraction, loadOfficialAnttTables, selectTableKey } from './antt.js';
import { extractSheetRecords, getSheetNames, guessBaseSheet } from './excel.js';
import { ORS_API_KEY } from './config.js';
import { fetchOrsDistanceKm, loadIbgeCoordsMap, normalizeIbgeCode } from './distance.js';
import { formatMoney, formatPercent, parseNumber } from './utils.js';

const state = {
  workbook: null,
  sheetName: '',
  rows: [],
  fileName: 'antt.xlsx',
};

const els = {
  fileInput: document.getElementById('fileInput'),
  exportBtn: document.getElementById('exportBtn'),
  message: document.getElementById('message'),
  tbody: document.getElementById('tbody'),
  statTotal: document.getElementById('statTotal'),
  statFrete1: document.getElementById('statFrete1'),
  statFrete2: document.getElementById('statFrete2'),
  statConforme: document.getElementById('statConforme'),
  statSemCalculo: document.getElementById('statSemCalculo'),
  statAvg: document.getElementById('statAvg'),
};

function showMessage(text, type = 'info') {
  if (!text) {
    els.message.innerHTML = '';
    return;
  }

  els.message.innerHTML = type === 'error'
    ? `<div class="error">${text}</div>`
    : `<div class="notice">${text}</div>`;
}

function renderSummary(rows) {
  const total = rows.length;
  const frete1 = rows.filter(row => row.classification === 'frete 1').length;
  const frete2 = rows.filter(row => row.classification === 'frete 2').length;
  const conforme = rows.filter(row => row.classification === 'conforme').length;
  const semCalculo = rows.filter(row => row.classification === 'sem cálculo').length;
  const avgRows = rows.filter(row => row.diff != null);
  const avg = avgRows.length ? avgRows.reduce((sum, row) => sum + row.diff, 0) / avgRows.length : null;

  els.statTotal.textContent = total;
  els.statFrete1.textContent = frete1;
  els.statFrete2.textContent = frete2;
  els.statConforme.textContent = conforme;
  els.statSemCalculo.textContent = semCalculo;
  els.statAvg.textContent = avg == null ? '-' : formatMoney(avg);
}

function renderTable(rows) {
  if (!rows.length) {
    els.tbody.innerHTML = '<tr><td colspan="8" class="muted">Envie um arquivo para começar.</td></tr>';
    return;
  }

  const visible = rows.slice(0, 200);
  els.tbody.innerHTML = visible.map(row => {
    const pillClass = row.classification === 'frete 1' ? 'bad' : row.classification === 'frete 2' ? 'warn' : row.classification === 'conforme' ? 'good' : 'gray';
    return `<tr>
      <td>${row.rowNumber}</td>
      <td><span class="pill ${pillClass}">${row.classification}</span></td>
      <td>${formatMoney(row.anttValue)}</td>
      <td>${formatMoney(row.companyValue)}</td>
      <td>${formatMoney(row.diff)}</td>
      <td>${formatPercent(row.diffPct)}</td>
      <td>${row.companySource || '-'}</td>
      <td>${row.reason}</td>
    </tr>`;
  }).join('');

  if (rows.length > 200) {
    els.tbody.insertAdjacentHTML('beforeend', '<tr><td colspan="8" class="muted">Mostrando apenas 200 linhas. O Excel exportado contém tudo.</td></tr>');
  }
}

function setExportEnabled(enabled) {
  els.exportBtn.disabled = !enabled;
}

function getIbgeCodeFromRow(row, headers) {
  for (const header of headers) {
    const code = normalizeIbgeCode(row[header]);
    if (code) return code;
  }
  return null;
}

function collectIbgePairs(records) {
  const pairs = new Map();

  records.forEach(row => {
    const originCode = getIbgeCodeFromRow(row, ['IBGE CID ORG', 'IBGE CID ORIG', 'IBGE ORIG']);
    const destCode = getIbgeCodeFromRow(row, ['IBGE CID DEST', 'IBGE CID DESTINO', 'IBGE DEST']);
    if (!originCode || !destCode) return;
    const key = `${originCode}|${destCode}`;
    if (!pairs.has(key)) pairs.set(key, { key, originCode, destCode });
  });

  return Array.from(pairs.values());
}

const ORS_CONCURRENCY = 15;

async function buildDistanceLookup(records, onProgress) {
  const pairs = collectIbgePairs(records);
  if (!pairs.length) return { map: new Map(), reasons: new Map(), failures: 0, total: 0 };

  await loadIbgeCoordsMap();

  const map = new Map();
  const reasons = new Map();
  let failures = 0;
  let done = 0;
  const queue = [...pairs];

  async function worker() {
    while (queue.length) {
      const pair = queue.shift();
      try {
        const km = await fetchOrsDistanceKm(pair.originCode, pair.destCode);
        if (km == null) {
          failures += 1;
          reasons.set(pair.key, 'Rota nao encontrada pelo ORS.');
        }
        map.set(pair.key, km);
      } catch (error) {
        failures += 1;
        map.set(pair.key, null);
        reasons.set(pair.key, error?.code === 'MISSING_COORD'
          ? `Coordenada IBGE ausente (${error.missingCode}).`
          : error?.message || 'Falha ao consultar rota.');
      }
      done += 1;
      onProgress?.(done, pairs.length);
    }
  }

  const workerCount = Math.min(ORS_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { map, reasons, failures, total: pairs.length };
}

async function handleFile(file) {
  if (!file) return;
  if (/\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name)) {
    throw new Error('Esse MVP lê arquivos .xlsx. Se a Datasol exportou .xls, salve como .xlsx antes de subir.');
  }

  if (!ORS_API_KEY) {
    throw new Error('Defina ORS_API_KEY em src/config.js para calcular KM por IBGE.');
  }

  state.fileName = file.name;
  const data = await file.arrayBuffer();
  state.workbook = new ExcelJS.Workbook();
  await state.workbook.xlsx.load(data);

  const names = getSheetNames(state.workbook);
  state.sheetName = guessBaseSheet(names);

  const baseWorksheet = state.workbook.getWorksheet(state.sheetName) || state.workbook.worksheets[0];
  const baseRecords = extractSheetRecords(baseWorksheet);
  const officialTables = await loadOfficialAnttTables();

  showMessage('Calculando KM via ORS. Isso pode levar alguns minutos.');
  const distanceLookup = await buildDistanceLookup(baseRecords, (done, total) => {
    showMessage(`Calculando KM via ORS... ${done}/${total} rotas.`);
  });

  const rows = [];
  const belowThreshold = 50;
  const aboveThreshold = 50;
  const highPerformance = false;
  const onlyTractionMode = 'auto';

  for (let index = 0; index < baseRecords.length; index += 1) {
    const row = baseRecords[index];
    const rowNumber = index + 2;
    const productText = `${row['TIPO CARGA'] ?? ''} ${row['TIPO DE OPERACAO'] ?? ''} ${row.PRODUTO ?? ''} ${row.NEGOCIO ?? ''} ${row['TIPO DE NEGOCIACAO DE FRETE'] ?? ''}`;
    const vehicleText = String(row['TIPO DE VEICULO'] ?? row.VEICULO ?? '');
    const loadType = inferLoadType(productText);
    const axisFromColumn = Number(row.EIXO);
    const axis = Number.isFinite(axisFromColumn) && axisFromColumn > 0 ? axisFromColumn : inferAxis(vehicleText);
    const dangerousLoad = inferDangerousLoad(productText, vehicleText);
    const onlyTractionVehicle = onlyTractionMode === 'auto' ? inferOnlyTraction(vehicleText, String(row.TRANSP ?? '')) : onlyTractionMode === 'true';
    const emptyReturn = inferEmptyReturn(row['RETORNO VAZIO']);
    const knownKm = parseNumber(row.KM);
    const originCode = getIbgeCodeFromRow(row, ['IBGE CID ORG', 'IBGE CID ORIG', 'IBGE ORIG']);
    const destCode = getIbgeCodeFromRow(row, ['IBGE CID DEST', 'IBGE CID DESTINO', 'IBGE DEST']);
    const pairKey = originCode && destCode ? `${originCode}|${destCode}` : '';
    const orsDistance = pairKey ? distanceLookup.map.get(pairKey) ?? null : null;
    const distance = orsDistance ?? knownKm;
    const distanceSource = orsDistance != null ? 'ORS' : (distance != null ? 'PLANILHA' : '');
    const company = deriveCompanyValue(row, '');
    let anttValue = null;
    let anttDebug = { ccd: null, cc: null, tableKey: selectTableKey(onlyTractionVehicle, highPerformance), entryKey: null };

    if (loadType != null && axis != null && distance != null) {
      const anttResult = calculateAnttFromOfficialTables({
        distance,
        axis,
        loadType,
        onlyTractionVehicle,
        highPerformance,
        emptyReturn,
        dangerousLoad,
      }, officialTables);
      anttValue = anttResult.value;
      anttDebug = anttResult;
      anttDebug.distance = distance;
    }

    const result = classifyDifference(company.value, anttValue, belowThreshold, aboveThreshold);
    rows.push({
      rowNumber,
      companyValue: company.value,
      companySource: company.source,
      anttValue,
      anttTable: anttDebug.tableKey,
      anttEntryKey: anttDebug.entryKey,
      anttCcd: anttDebug.ccd,
      anttCc: anttDebug.cc,
      anttDistanceUsed: anttDebug.distance ?? null,
      anttDistanceSource: distanceSource,
      anttEmptyReturnApplied: emptyReturn,
      diff: result.diff,
      diffPct: result.diffPct,
      classification: result.classification,
      reason: !loadType
        ? 'Nao identifiquei o tipo de carga.'
        : distance == null
          ? (pairKey && distanceLookup.reasons.get(pairKey)) || 'Nao consegui calcular KM via IBGE.'
          : anttValue == null
            ? `Sem taxa ANTT para ${loadType}/${axis ?? '-'} (tabela ${selectTableKey(onlyTractionVehicle, highPerformance)}, perigosa=${dangerousLoad}, tracao=${onlyTractionVehicle}).`
            : company.value == null
              ? 'Nao encontrei valor da empresa nas colunas conhecidas.'
              : 'OK',
      raw: row,
    });
  }

  state.rows = rows;
  renderSummary(rows);
  renderTable(rows);
  setExportEnabled(true);
  const failureNote = distanceLookup.failures ? ` ${distanceLookup.failures} rotas sem KM.` : '';
  showMessage(`Processamento concluido: ${rows.length} linhas lidas.${failureNote}`);
}

async function exportWorkbook() {
  if (!state.workbook || !state.rows.length) return;

  const sheet = state.workbook.getWorksheet(state.sheetName) || state.workbook.worksheets[0];
  const original = extractSheetRecords(sheet);
  const exportRows = original.map((row, index) => {
    const processed = state.rows[index];
    return {
      ...row,
      'ANTT CALCULADO': processed?.anttValue ?? '',
      'ANTT TABELA': processed?.anttTable ?? '',
      'ANTT CHAVE': processed?.anttEntryKey ?? '',
      'ANTT CCD': processed?.anttCcd ?? '',
      'ANTT CC': processed?.anttCc ?? '',
      'ANTT KM USADO (ORS)': processed?.anttDistanceUsed ?? '',
      'ANTT FONTE KM': processed?.anttDistanceSource ?? '',
      'ANTT RETORNO VAZIO APLICADO': processed?.anttEmptyReturnApplied ? 'SIM' : 'NAO',
      'VALOR EMPRESA': processed?.companyValue ?? '',
      'FONTE EMPRESA': processed?.companySource ?? '',
      'DIFERENÇA R$': processed?.diff ?? '',
      'DIFERENÇA %': processed?.diffPct ?? '',
      'CLASSIFICAÇÃO': processed?.classification ?? '',
      'MOTIVO': processed?.reason ?? '',
    };
  });

  const outWb = new ExcelJS.Workbook();
  const outSheet = outWb.addWorksheet('RESULTADO ANTT');
  outSheet.addRow(Object.keys(exportRows[0] ?? {}));
  exportRows.forEach(row => outSheet.addRow(Object.values(row)));
  outSheet.columns.forEach(column => {
    if (!column) return;
    column.width = 20;
  });

  const buffer = await outWb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.fileName.replace(/\.xlsx?$/i, '') + '_antt_resultado.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.fileInput.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  state.rows = [];
  renderSummary([]);
  renderTable([]);
  setExportEnabled(false);

  if (!file) return;

  try {
    await handleFile(file);
  } catch (error) {
    console.error(error);
    showMessage(error instanceof Error ? error.message : 'Falha ao ler a planilha. Verifique se ela está fechada e no formato .xlsx.', 'error');
  }
});

els.exportBtn.addEventListener('click', exportWorkbook);

showMessage('Pronto. Carregue a planilha da Datasol e o resultado aparece automaticamente.');