const EARTH_RADIUS_M = 6378137;

export const DEFAULT_MAP_CENTER = [6.521, 3.377];

export const OSM_BASE_LAYERS = {
  standard: {
    id: 'standard',
    label: 'OSM Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  humanitarian: {
    id: 'humanitarian',
    label: 'Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, Humanitarian OpenStreetMap Team',
    maxZoom: 19,
  },
  topo: {
    id: 'topo',
    label: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Style: &copy; OpenTopoMap',
    maxZoom: 17,
  },
};

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function roundCoord(value) {
  return Number(Number(value).toFixed(7));
}

/**
 * Converts [{ lat, lng }, ...] points into a closed WGS84 [lng, lat] ring.
 */
export function pointsToClosedGeoJsonRing(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const coords = points.map((pt) => [roundCoord(pt.lng), roundCoord(pt.lat)]);
  if (coords.length >= 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([first[0], first[1]]);
    }
  }
  return coords;
}

/**
 * Parses either raw JSON text or a GeoJSON/ring object into an open [{ lat, lng }, ...] array.
 * Returns null if input is invalid or malformed.
 */
export function parseRingToLatLngPoints(rawInput) {
  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  let ring = null;
  if (Array.isArray(parsed)) {
    ring = parsed;
  } else if (parsed && parsed.type === 'Polygon' && Array.isArray(parsed.coordinates?.[0])) {
    ring = parsed.coordinates[0];
  } else {
    return null;
  }

  const points = [];
  for (const item of ring) {
    if (!Array.isArray(item) || item.length < 2) return null;
    const lng = Number(item[0]);
    const lat = Number(item[1]);
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return null;
    }
    points.push({ lat, lng });
  }

  if (points.length >= 4) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9) {
      points.pop();
    }
  }

  return points;
}

/**
 * Extracts Leaflet-ready [lat, lng] polygon vertices from GeoJSON Polygon, ring array, or JSON string.
 * Returns [] if fewer than 3 valid vertices exist.
 */
export function getBoundaryLatLngs(boundaryInput) {
  const points = parseRingToLatLngPoints(boundaryInput);
  if (!Array.isArray(points) || points.length < 3) return [];
  return points.map((pt) => [pt.lat, pt.lng]);
}

/**
 * Returns Leaflet polygon style options for parcel demarcation based on verification state.
 */
export function getDemarcationStyle({ isBlocked = false, isPendingVerification = false } = {}) {
  if (isBlocked) {
    return {
      color: '#b91c1c',
      weight: 3,
      fillColor: '#ef4444',
      fillOpacity: 0.25,
      dashArray: null,
    };
  }
  if (isPendingVerification) {
    return {
      color: '#b45309',
      weight: 3,
      fillColor: '#f59e0b',
      fillOpacity: 0.24,
      dashArray: '6 4',
    };
  }
  return {
    color: '#047857',
    weight: 3,
    fillColor: '#10b981',
    fillOpacity: 0.26,
    dashArray: null,
  };
}

/**
 * Computes approximate geodesic area (m²) on WGS84 sphere (matches backend gisService).
 */
export function computeGeodesicAreaSqm(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area += toRadians(lng2 - lng1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Number(Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2).toFixed(2));
}

export function computeAreaFromPointsSqm(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  return computeGeodesicAreaSqm(pointsToClosedGeoJsonRing(points));
}

export function formatNominatimSearchUrl(query) {
  const clean = String(query || '').trim();
  if (!clean) return '';
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
    q: clean,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

export async function searchNominatimPlaces(query, signal) {
  const url = formatNominatimSearchUrl(query);
  if (!url) return [];
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`OpenStreetMap Nominatim returned status ${res.status}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const bbox =
        Array.isArray(item.boundingbox) && item.boundingbox.length === 4
          ? [
              [Number(item.boundingbox[0]), Number(item.boundingbox[2])],
              [Number(item.boundingbox[1]), Number(item.boundingbox[3])],
            ]
          : null;
      return {
        id: String(item.place_id || `${lat},${lng}`),
        shortLabel: item.name || item.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        displayName: item.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
        boundingBox: bbox,
      };
    })
    .filter(Boolean);
}

export function formatGeolocationError(err) {
  if (!err || typeof err !== 'object') {
    return 'Unable to determine your current location.';
  }
  if (err.code === 1) {
    return 'Location permission denied. Allow location access in your browser to use Locate Me.';
  }
  if (err.code === 2) {
    return 'Current position is unavailable from your device sensors.';
  }
  if (err.code === 3) {
    return 'Location lookup timed out. Please try again.';
  }
  return err.message || 'Unable to determine your current location.';
}

export function requestCurrentPosition(
  geolocationObj = typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
  options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
) {
  return new Promise((resolve, reject) => {
    if (!geolocationObj || typeof geolocationObj.getCurrentPosition !== 'function') {
      reject(new Error('Browser Geolocation API is not supported in this environment.'));
      return;
    }
    geolocationObj.getCurrentPosition(
      (position) => {
        const lat = Number(position?.coords?.latitude);
        const lng = Number(position?.coords?.longitude);
        const accuracy = Number(position?.coords?.accuracy);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          reject(new Error('Invalid coordinates returned by browser Geolocation API.'));
          return;
        }
        resolve({
          lat,
          lng,
          accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        });
      },
      (err) => {
        reject(new Error(formatGeolocationError(err)));
      },
      options
    );
  });
}

function pointOnSegment(a, b, p) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-11) return false;
  return (
    p[0] <= Math.max(a[0], b[0]) + 1e-11 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-11 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-11 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-11
  );
}

/**
 * Checks whether (lat, lng) falls inside or on the edge of a WGS84 GeoJSON Polygon.
 */
export function isPointInGeoJsonPolygon(lat, lng, geojson) {
  const ring = geojson?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  for (let i = 0; i < ring.length - 1; i++) {
    if (pointOnSegment(ring[i], ring[i + 1], [x, y])) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Client-side fallback point-in-polygon matcher across loaded parcels and pending applications.
 */
export function findLocalParcelMatch(lat, lng, parcels = [], pendingApps = []) {
  for (const parcel of parcels) {
    if (isPointInGeoJsonPolygon(lat, lng, parcel.boundary_geojson)) {
      return {
        matched: true,
        matchType: 'REGISTERED_PARCEL',
        parcelCode: parcel.parcel_code,
        referenceCode: parcel.reference_code || null,
        parcelName: parcel.parcel_name || parcel.parcel_code,
        status: parcel.status,
        areaSqm: Number(parcel.area_sqm) || null,
        region: parcel.region || null,
        applicationId: parcel.application_id || null,
        source: 'REGISTERED_PARCEL',
      };
    }
  }

  for (const app of pendingApps) {
    if (isPointInGeoJsonPolygon(lat, lng, app.coordinates_geojson)) {
      return {
        matched: true,
        matchType: 'PENDING_APPLICATION',
        parcelCode: null,
        referenceCode: app.reference_code,
        parcelName: app.parcel_name,
        status: app.status,
        areaSqm: Number(app.declared_area_sqm) || null,
        region: app.region || null,
        applicationId: app.id || null,
        source: 'PENDING_APPLICATION',
      };
    }
  }

  return {
    matched: false,
    matchType: 'UNCLAIMED',
    parcelCode: null,
    referenceCode: null,
    parcelName: null,
    status: 'UNCLAIMED',
    areaSqm: null,
    region: null,
    applicationId: null,
    source: null,
  };
}

export function parseLocatedCoordinatesParams(input) {
  if (!input) return null;
  const params =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input;
  if (typeof params?.get !== 'function') return null;

  const rawLat = params.get('lat');
  const rawLng = params.get('lng');
  if (rawLat === null || rawLng === null || rawLat === '' || rawLng === '') return null;

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function toValidCoordinate(value, maxAbs) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || Math.abs(num) > maxAbs) return null;
  return num;
}

export function buildRegisterHereUrl(lat, lng) {
  const numLat = toValidCoordinate(lat, 90);
  const numLng = toValidCoordinate(lng, 180);
  if (numLat === null || numLng === null) {
    return '/register';
  }
  const params = new URLSearchParams({
    lat: numLat.toFixed(6),
    lng: numLng.toFixed(6),
  });
  return `/register?${params.toString()}`;
}

export async function lookupParcelByCoordinates(lat, lng, signal) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return null;
  }
  const params = new URLSearchParams({
    lat: String(numLat),
    lng: String(numLng),
  });
  try {
    const res = await fetch(`/api/gis/lookup?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
