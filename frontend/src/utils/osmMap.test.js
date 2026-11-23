import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OSM_BASE_LAYERS,
  pointsToClosedGeoJsonRing,
  parseRingToLatLngPoints,
  computeGeodesicAreaSqm,
  computeAreaFromPointsSqm,
  computeGeodesicPerimeterM,
  computePerimeterFromPointsM,
  formatNominatimSearchUrl,
  formatGeolocationError,
  requestCurrentPosition,
  isPointInGeoJsonPolygon,
  findLocalParcelMatch,
  buildRegisterHereUrl,
  parseLocatedCoordinatesParams,
  getBoundaryLatLngs,
  getDemarcationStyle,
} from './osmMap.js';

test('OSM_BASE_LAYERS exposes standard, satellite, humanitarian, and topo OpenStreetMap layers', () => {
  assert.ok(OSM_BASE_LAYERS.standard.url.includes('tile.openstreetmap.org'));
  assert.ok(OSM_BASE_LAYERS.satellite.url.includes('arcgisonline.com'));
  assert.ok(OSM_BASE_LAYERS.humanitarian.url.includes('tile.openstreetmap.fr'));
  assert.ok(OSM_BASE_LAYERS.topo.url.includes('tile.opentopomap.org'));
});

test('pointsToClosedGeoJsonRing converts lat/lng points to closed [lng, lat] GeoJSON ring', () => {
  const ring = pointsToClosedGeoJsonRing([
    { lat: 6.52, lng: 3.375 },
    { lat: 6.52, lng: 3.3765 },
    { lat: 6.5215, lng: 3.3765 },
    { lat: 6.5215, lng: 3.375 },
  ]);

  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], [3.375, 6.52]);
  assert.deepEqual(ring[4], [3.375, 6.52]);
});

test('parseRingToLatLngPoints parses raw ring JSON and GeoJSON Polygon and rejects invalid inputs', () => {
  const rawRing = JSON.stringify([
    [3.375, 6.52],
    [3.3765, 6.52],
    [3.3765, 6.5215],
    [3.375, 6.5215],
    [3.375, 6.52],
  ]);

  const parsed = parseRingToLatLngPoints(rawRing);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0], { lat: 6.52, lng: 3.375 });

  const polyParsed = parseRingToLatLngPoints({
    type: 'Polygon',
    coordinates: [JSON.parse(rawRing)],
  });
  assert.equal(polyParsed.length, 4);

  assert.equal(parseRingToLatLngPoints('{not valid json'), null);
  assert.equal(parseRingToLatLngPoints('[[999, 6.5]]'), null);
});

test('computeGeodesicAreaSqm and computeAreaFromPointsSqm calculate realistic parcel area in m²', () => {
  const points = [
    { lat: 6.52, lng: 3.375 },
    { lat: 6.52, lng: 3.3765 },
    { lat: 6.5215, lng: 3.3765 },
    { lat: 6.5215, lng: 3.375 },
  ];
  const ring = pointsToClosedGeoJsonRing(points);
  const areaFromRing = computeGeodesicAreaSqm(ring);
  const areaFromPoints = computeAreaFromPointsSqm(points);

  assert.equal(areaFromRing, areaFromPoints);
  assert.ok(areaFromPoints > 25000 && areaFromPoints < 30000);
  const perimeterFromRing = computeGeodesicPerimeterM(ring);
  assert.equal(perimeterFromRing, computePerimeterFromPointsM(points));
  assert.ok(perimeterFromRing > 600 && perimeterFromRing < 700);
  assert.equal(computeAreaFromPointsSqm(points.slice(0, 2)), 0);
  assert.equal(computePerimeterFromPointsM(points.slice(0, 2)), 0);
});

test('formatNominatimSearchUrl encodes place queries cleanly', () => {
  assert.equal(formatNominatimSearchUrl('   '), '');
  const url = formatNominatimSearchUrl('Yaba, Lagos');
  assert.match(url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.match(url, /format=jsonv2/);
  assert.match(url, /q=Yaba%2C\+Lagos/);
});

test('requestCurrentPosition resolves coordinates and maps Geolocation error codes cleanly', async () => {
  const pos = await requestCurrentPosition({
    getCurrentPosition(success) {
      success({ coords: { latitude: 6.6018, longitude: 3.3515, accuracy: 24.4 } });
    },
  });
  assert.deepEqual(pos, { lat: 6.6018, lng: 3.3515, accuracy: 24 });

  await assert.rejects(
    () =>
      requestCurrentPosition({
        getCurrentPosition(_success, error) {
          error({ code: 1 });
        },
      }),
    /permission denied/i
  );

  await assert.rejects(() => requestCurrentPosition(null), /not supported/i);
  assert.match(formatGeolocationError({ code: 3 }), /timed out/i);
});

test('isPointInGeoJsonPolygon and findLocalParcelMatch identify registered, pending, and unclaimed coordinates', () => {
  const polyA = {
    type: 'Polygon',
    coordinates: [
      [
        [3.375, 6.52],
        [3.3765, 6.52],
        [3.3765, 6.5215],
        [3.375, 6.5215],
        [3.375, 6.52],
      ],
    ],
  };

  assert.equal(isPointInGeoJsonPolygon(6.52075, 3.37575, polyA), true);
  assert.equal(isPointInGeoJsonPolygon(6.4541, 3.3947, polyA), false);

  const parcels = [
    {
      parcel_code: 'ANG-PARCEL-0001',
      parcel_name: 'Plot A',
      status: 'ACTIVE',
      area_sqm: 27650,
      boundary_geojson: polyA,
    },
  ];
  const pendingApps = [
    {
      id: 9,
      reference_code: 'ANG-APP-2026-0009',
      parcel_name: 'Plot B Pending',
      status: 'SUBMITTED',
      declared_area_sqm: 18000,
      coordinates_geojson: {
        type: 'Polygon',
        coordinates: [
          [
            [3.378, 6.52],
            [3.3795, 6.52],
            [3.3795, 6.5215],
            [3.378, 6.5215],
            [3.378, 6.52],
          ],
        ],
      },
    },
  ];

  const hit = findLocalParcelMatch(6.52075, 3.37575, parcels, pendingApps);
  assert.equal(hit.matched, true);
  assert.equal(hit.matchType, 'REGISTERED_PARCEL');
  assert.equal(hit.parcelCode, 'ANG-PARCEL-0001');

  const pendingHit = findLocalParcelMatch(6.52075, 3.37875, parcels, pendingApps);
  assert.equal(pendingHit.matched, true);
  assert.equal(pendingHit.matchType, 'PENDING_APPLICATION');
  assert.equal(pendingHit.referenceCode, 'ANG-APP-2026-0009');

  const miss = findLocalParcelMatch(6.4541, 3.3947, parcels, pendingApps);
  assert.equal(miss.matched, false);
  assert.equal(miss.matchType, 'UNCLAIMED');
  assert.equal(miss.parcelCode, null);

  assert.equal(buildRegisterHereUrl(6.4541, 3.3947), '/register?lat=6.454100&lng=3.394700');
  assert.equal(buildRegisterHereUrl(null, null), '/register');
});

test('parseLocatedCoordinatesParams validates map focus without inventing parcel boundaries', () => {
  assert.deepEqual(parseLocatedCoordinatesParams('?lat=6.535000&lng=3.385000'), {
    lat: 6.535,
    lng: 3.385,
  });
  assert.equal(parseLocatedCoordinatesParams('?lat=&lng=3.385'), null);
  assert.equal(parseLocatedCoordinatesParams('?lat=999&lng=3.385'), null);
  assert.deepEqual(parseRingToLatLngPoints('[]'), []);
});

test('getBoundaryLatLngs and getDemarcationStyle convert owner boundary coordinates and status styles', () => {
  const geojson = {
    type: 'Polygon',
    coordinates: [
      [
        [3.391, 6.531],
        [3.3925, 6.531],
        [3.3925, 6.5325],
        [3.391, 6.5325],
        [3.391, 6.531],
      ],
    ],
  };

  const latLngs = getBoundaryLatLngs(geojson);
  assert.equal(latLngs.length, 4);
  assert.deepEqual(latLngs[0], [6.531, 3.391]);
  assert.deepEqual(latLngs[2], [6.5325, 3.3925]);
  assert.deepEqual(getBoundaryLatLngs(null), []);
  assert.deepEqual(getBoundaryLatLngs([[3.391, 6.531], [3.3925, 6.531]]), []);

  const verifiedStyle = getDemarcationStyle({ isBlocked: false, isPendingVerification: false });
  assert.equal(verifiedStyle.color, '#047857');
  assert.equal(verifiedStyle.dashArray, null);

  const pendingStyle = getDemarcationStyle({ isBlocked: false, isPendingVerification: true });
  assert.equal(pendingStyle.color, '#b45309');
  assert.equal(pendingStyle.dashArray, '6 4');

  const blockedStyle = getDemarcationStyle({ isBlocked: true, isPendingVerification: false });
  assert.equal(blockedStyle.color, '#b91c1c');
});
