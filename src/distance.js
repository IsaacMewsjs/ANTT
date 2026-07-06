import { IBGE_COORDS_URL, ORS_API_KEY, ORS_PREFERENCE, ORS_PROFILE } from './config.js';

const IBGE_CACHE_KEY = 'antt:ibgeCoords:v1';
const ORS_TIMEOUT_MS = 15000;
const ORS_MAX_ATTEMPTS = 4;

const ibgeCache = { map: null, promise: null };
const routeCache = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeIbgeCode(value) {
  if (value == null) return null;
  const digits = String(value).match(/\d+/g)?.join('') ?? '';
  return digits ? digits : null;
}

function buildIbgeMap(records) {
  const map = new Map();
  for (const record of records) {
    const code = normalizeIbgeCode(record.codigo_ibge);
    const lat = Number(record.latitude);
    const lon = Number(record.longitude);
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    map.set(code, { lat, lon });
  }
  return map;
}

export async function loadIbgeCoordsMap() {
  if (ibgeCache.map) return ibgeCache.map;
  if (ibgeCache.promise) return ibgeCache.promise;

  ibgeCache.promise = (async () => {
    const cached = localStorage.getItem(IBGE_CACHE_KEY);
    if (cached) {
      try {
        const records = JSON.parse(cached);
        const map = buildIbgeMap(records);
        if (map.size) {
          ibgeCache.map = map;
          return map;
        }
      } catch (error) {
        localStorage.removeItem(IBGE_CACHE_KEY);
      }
    }

    const response = await fetch(IBGE_COORDS_URL);
    if (!response.ok) {
      throw new Error(`Falha ao baixar base IBGE (status ${response.status}).`);
    }

    const records = await response.json();
    localStorage.setItem(IBGE_CACHE_KEY, JSON.stringify(records));
    const map = buildIbgeMap(records);
    ibgeCache.map = map;
    return map;
  })().finally(() => {
    ibgeCache.promise = null;
  });

  return ibgeCache.promise;
}

export async function fetchOrsDistanceKm(originCode, destCode, apiKey = ORS_API_KEY, preference = ORS_PREFERENCE, timeoutMs = ORS_TIMEOUT_MS) {
  if (!apiKey) throw new Error('Chave OpenRouteService nao informada.');

  const key = `${originCode}|${destCode}`;
  if (routeCache.has(key)) return routeCache.get(key);

  const reverseKey = `${destCode}|${originCode}`;
  if (routeCache.has(reverseKey)) return routeCache.get(reverseKey);

  const map = await loadIbgeCoordsMap();
  const origin = map.get(originCode);
  const dest = map.get(destCode);

  if (!origin || !dest) {
    routeCache.set(key, null);
    const missingCode = !origin ? originCode : destCode;
    const error = new Error(`Coordenada IBGE nao encontrada para o codigo ${missingCode}.`);
    error.code = 'MISSING_COORD';
    error.missingCode = missingCode;
    throw error;
  }

  const url = `https://api.openrouteservice.org/v2/directions/${ORS_PROFILE}?start=${origin.lon},${origin.lat}&end=${dest.lon},${dest.lat}&preference=${encodeURIComponent(preference)}&format=geojson`;

  let lastError = null;

  for (let attempt = 1; attempt <= ORS_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { headers: { Authorization: apiKey }, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.status === 429 || response.status === 503) {
        lastError = new Error(`ORS indisponivel (status ${response.status}).`);
        lastError.code = 'ORS_RATE_LIMIT';
        if (attempt < ORS_MAX_ATTEMPTS) {
          await sleep(attempt * 3000);
          continue;
        }
        break;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Falha ao consultar rota (status ${response.status}): ${text}`);
      }

      const data = await response.json();
      const meters = data?.features?.[0]?.properties?.summary?.distance;
      const km = typeof meters === 'number' ? meters / 1000 : null;
      routeCache.set(key, km);
      return km;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error?.name === 'AbortError') {
        lastError = new Error(`Tempo esgotado consultando rota ${originCode} -> ${destCode}.`);
        lastError.code = 'ORS_TIMEOUT';
        if (attempt < ORS_MAX_ATTEMPTS) {
          await sleep(attempt * 2000);
          continue;
        }
        break;
      }
      lastError = error;
      break;
    }
  }

  routeCache.set(key, null);
  throw lastError ?? new Error(`Falha ao consultar rota ${originCode} -> ${destCode}.`);
}