import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getPgPool, loadLocalStore, saveLocalStore, nextSequence } from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';
import {
  recordLocalApplicationStatusHistory,
  transitionApplicationStatus,
} from '../models/applicationModel.js';

export const OVERLAP_TOLERANCE_SQM = 1.0;
const EARTH_RADIUS_M = 6378137;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Computes approximate geodesic area (m²) on WGS84 sphere using Chamberlain-Duquette formula.
 */
export function computeGeodesicAreaSqm(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area += toRadians(lng2 - lng1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function computeGeodesicPerimeterM(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  const distance = (a, b) => {
    const [lng1, lat1] = a.map(toRadians);
    const [lng2, lat2] = b.map(toRadians);
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const haversine =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine));
  };
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    perimeter += distance(ring[i], ring[i + 1]);
  }
  return Number(perimeter.toFixed(2));
}

export function computeCentroid(ring) {
  const pts = ring.slice(0, -1);
  if (!pts.length) return { lat: 0, lng: 0 };
  const sum = pts.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 }
  );
  return {
    lng: Number((sum.lng / pts.length).toFixed(7)),
    lat: Number((sum.lat / pts.length).toFixed(7)),
  };
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return (
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-12 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-12
  );
}

function segmentsProperlyCross(a1, a2, b1, b2) {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);

  if (((o1 > 1e-12 && o2 < -1e-12) || (o1 < -1e-12 && o2 > 1e-12)) &&
      ((o3 > 1e-12 && o4 < -1e-12) || (o3 < -1e-12 && o4 > 1e-12))) {
    return true;
  }
  return false;
}

function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);

  if (((o1 > 1e-12 && o2 < -1e-12) || (o1 < -1e-12 && o2 > 1e-12)) &&
      ((o3 > 1e-12 && o4 < -1e-12) || (o3 < -1e-12 && o4 > 1e-12))) {
    return true;
  }
  if (Math.abs(o1) <= 1e-12 && onSegment(a1, a2, b1)) return true;
  if (Math.abs(o2) <= 1e-12 && onSegment(a1, a2, b2)) return true;
  if (Math.abs(o3) <= 1e-12 && onSegment(b1, b2, a1)) return true;
  if (Math.abs(o4) <= 1e-12 && onSegment(b1, b2, a2)) return true;
  return false;
}

/**
 * Pure-JS ST_IsValid() equivalent: checks ring closure, zero-length edges,
 * non-zero area, and self-intersection between non-adjacent polygon edges.
 */
export function validatePolygonGeometry(geojson) {
  const ring = geojson?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return { isValid: false, validityReason: 'Polygon ring requires at least 4 coordinates.' };
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return { isValid: false, validityReason: 'Ring is not closed (first and last vertices differ).' };
  }

  const edgeCount = ring.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    if (Math.abs(p1[0] - p2[0]) < 1e-11 && Math.abs(p1[1] - p2[1]) < 1e-11) {
      return {
        isValid: false,
        validityReason: `Duplicate consecutive vertex at edge ${i + 1}.`,
      };
    }
  }

  for (let i = 0; i < edgeCount; i++) {
    for (let j = i + 1; j < edgeCount; j++) {
      // Skip adjacent edges and first/last shared vertex
      if (j === i + 1 || (i === 0 && j === edgeCount - 1)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        return {
          isValid: false,
          validityReason: `Self-intersection detected between edges ${i + 1} and ${j + 1} (invalid bowtie or crossing boundary).`,
        };
      }
    }
  }

  const areaSqm = computeGeodesicAreaSqm(ring);
  if (areaSqm < 1.0) {
    return {
      isValid: false,
      validityReason: 'Degenerate polygon with near-zero area (< 1.0 m²).',
    };
  }

  return {
    isValid: true,
    validityReason: 'Valid Geometry',
    areaSqm: Number(areaSqm.toFixed(2)),
    centroid: computeCentroid(ring),
  };
}

function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointStrictlyInsideRing(pt, ring) {
  // Check not on any edge first
  for (let i = 0; i < ring.length - 1; i++) {
    if (Math.abs(orient(ring[i], ring[i + 1], pt)) <= 1e-11 && onSegment(ring[i], ring[i + 1], pt)) {
      return false;
    }
  }
  return pointInRing(pt, ring);
}

export function isPointInPolygon(lat, lng, geojson) {
  const ring = geojson?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const pt = [Number(lng), Number(lat)];
  if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false;

  for (let i = 0; i < ring.length - 1; i++) {
    if (Math.abs(orient(ring[i], ring[i + 1], pt)) <= 1e-11 && onSegment(ring[i], ring[i + 1], pt)) {
      return true;
    }
  }
  return pointInRing(pt, ring);
}

function boundingBoxesOverlap(r1, r2) {
  const box = (r) =>
    r.reduce(
      (b, [x, y]) => ({
        minX: Math.min(b.minX, x),
        maxX: Math.max(b.maxX, x),
        minY: Math.min(b.minY, y),
        maxY: Math.max(b.maxY, y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
  const a = box(r1);
  const b = box(r2);
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

/**
 * Estimates overlap area in m² via fine grid sampling inside the overlapping bounding box
 * plus exact interior-vertex/crossing checks so shared boundary edges never false-positive.
 */
export function estimateOverlapSqm(ringA, ringB) {
  if (!boundingBoxesOverlap(ringA, ringB)) return 0;

  // Check if any edges properly cross or any vertex lies strictly inside the other polygon
  let hasInteriorContact = false;
  for (let i = 0; i < ringA.length - 1 && !hasInteriorContact; i++) {
    if (pointStrictlyInsideRing(ringA[i], ringB)) hasInteriorContact = true;
    for (let j = 0; j < ringB.length - 1 && !hasInteriorContact; j++) {
      if (segmentsProperlyCross(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) {
        hasInteriorContact = true;
      }
    }
  }
  for (let j = 0; j < ringB.length - 1 && !hasInteriorContact; j++) {
    if (pointStrictlyInsideRing(ringB[j], ringA)) hasInteriorContact = true;
  }

  // Also handle identical/coincident polygons (all vertices on boundary, midpoints inside)
  const centroidA = computeCentroid(ringA);
  const centroidB = computeCentroid(ringB);
  if (
    pointStrictlyInsideRing([centroidA.lng, centroidA.lat], ringB) ||
    pointStrictlyInsideRing([centroidB.lng, centroidB.lat], ringA)
  ) {
    hasInteriorContact = true;
  }

  if (!hasInteriorContact) return 0;

  const box = (r) =>
    r.reduce(
      (b, [x, y]) => ({
        minX: Math.min(b.minX, x),
        maxX: Math.max(b.maxX, x),
        minY: Math.min(b.minY, y),
        maxY: Math.max(b.maxY, y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
  const a = box(ringA);
  const b = box(ringB);
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);

  if (maxX <= minX || maxY <= minY) return 0;

  const boxRing = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
  const boxAreaSqm = computeGeodesicAreaSqm(boxRing);
  const steps = 24;
  let insideHits = 0;
  for (let ix = 0; ix < steps; ix++) {
    const x = minX + ((ix + 0.5) / steps) * (maxX - minX);
    for (let iy = 0; iy < steps; iy++) {
      const y = minY + ((iy + 0.5) / steps) * (maxY - minY);
      if (pointInRing([x, y], ringA) && pointInRing([x, y], ringB)) {
        insideHits += 1;
      }
    }
  }
  return Number(((insideHits / (steps * steps)) * boxAreaSqm).toFixed(2));
}

/**
 * Pure-JS ST_Intersects() + documented 1.0 m² tolerance check.
 */
export function detectPolygonOverlap(
  geojson,
  existingParcels,
  excludeApplicationId = null,
  toleranceSqm = OVERLAP_TOLERANCE_SQM
) {
  const ring = geojson?.coordinates?.[0];
  const overlappingParcels = [];

  for (const parcel of existingParcels) {
    if (!['VALIDATED', 'ACTIVE'].includes(parcel.status)) continue;
    if (excludeApplicationId && parcel.application_id === excludeApplicationId) continue;

    const existingRing = parcel.boundary_geojson?.coordinates?.[0];
    if (!existingRing) continue;

    const overlapAreaSqm = estimateOverlapSqm(ring, existingRing);
    if (overlapAreaSqm > toleranceSqm) {
      overlappingParcels.push({
        parcelCode: parcel.parcel_code,
        applicationId: parcel.application_id,
        overlapAreaSqm,
      });
    }
  }

  return {
    hasOverlap: overlappingParcels.length > 0,
    overlappingParcels,
    toleranceSqm,
  };
}

export function generateParcelCode(id) {
  return `ANG-PARCEL-${String(id).padStart(4, '0')}`;
}

function recordLocalBoundaryVersion(store, parcel, application, surveyorId, now, reason) {
  const boundary = JSON.parse(JSON.stringify(application.coordinates_geojson));
  const serializedBoundary = JSON.stringify(boundary);
  const geometryHash = crypto.createHash('sha256').update(serializedBoundary).digest('hex');
  if (parcel.geometry_hash === geometryHash) return;

  const versions = store.tables.parcel_boundary_versions || [];
  const matchingVersion = versions
    .filter(
      (version) =>
        version.application_id === application.id && version.geometry_hash === geometryHash
    )
    .sort((a, b) => b.version_number - a.version_number)[0];
  if (matchingVersion) {
    matchingVersion.parcel_id = parcel.id;
    parcel.boundary_version = matchingVersion.version_number;
    parcel.geometry_hash = geometryHash;
    parcel.boundary_change_reason = matchingVersion.change_reason;
    store.tables.parcel_boundary_versions = versions;
    return;
  }

  const latestVersion = versions
    .filter((version) => version.application_id === application.id)
    .reduce((latest, version) => Math.max(latest, version.version_number), 0);
  parcel.boundary_version = Math.max(latestVersion, parcel.boundary_version || 0) + 1;
  parcel.geometry_hash = geometryHash;
  parcel.boundary_change_reason = reason;
  versions.push({
    id: nextSequence(store, 'parcel_boundary_versions'),
    parcel_id: parcel.id,
    application_id: application.id,
    version_number: parcel.boundary_version,
    boundary_geojson: boundary,
    geometry_hash: geometryHash,
    boundary_source: parcel.boundary_source,
    change_reason: reason,
    changed_by: surveyorId,
    created_at: now,
  });
  store.tables.parcel_boundary_versions = versions;
}

export async function validateAndRegisterParcel({
  application,
  surveyorId,
  actorRole = 'SYSTEM',
}) {
  const startedAt = performance.now();

  if (env.pg.enabled) {
    const pool = getPgPool();
    const geojsonText = JSON.stringify(application.coordinates_geojson);
    const valRes = await pool.query(
      'SELECT * FROM anagu_validate_parcel_polygon_phase4($1, $2, $3)',
      [geojsonText, application.id, OVERLAP_TOLERANCE_SQM]
    );
    const row = valRes.rows[0];
    const validationTimeMs = Number((performance.now() - startedAt).toFixed(2));

    if (!row.is_valid) {
      await transitionApplicationStatus({
        applicationId: application.id,
        expectedStatus: application.status,
        nextStatus: 'GIS_REJECTED',
        changedBy: surveyorId,
        actorRole,
        reason: `Invalid geometry (ST_IsValid): ${row.validity_reason}`,
      });
      return {
        passed: false,
        status: 'GIS_REJECTED',
        validationTimeMs,
        validation: {
          isValid: false,
          validityReason: row.validity_reason,
          hasOverlap: false,
          overlappingParcels: [],
          toleranceSqm: OVERLAP_TOLERANCE_SQM,
        },
      };
    }

    if (row.has_overlap) {
      const codes = (row.overlapping_parcel_codes || []).join(', ');
      const reason = `Boundary overlap detected via PostGIS ST_Intersects() with existing parcel(s): ${codes} (exceeds ${OVERLAP_TOLERANCE_SQM} m² tolerance).`;
      await transitionApplicationStatus({
        applicationId: application.id,
        expectedStatus: application.status,
        nextStatus: 'GIS_REJECTED',
        changedBy: surveyorId,
        actorRole,
        reason,
      });
      return {
        passed: false,
        status: 'GIS_REJECTED',
        validationTimeMs,
        validation: {
          isValid: true,
          validityReason: row.validity_reason,
          hasOverlap: true,
          overlappingParcels: (row.overlapping_parcel_codes || []).map((c) => ({ parcelCode: c })),
          toleranceSqm: OVERLAP_TOLERANCE_SQM,
        },
      };
    }

    const existingParcelRes = await pool.query(
      'SELECT * FROM land_parcels WHERE application_id = $1 LIMIT 1',
      [application.id]
    );
    let parcel;
    if (existingParcelRes.rows[0]) {
      const upd = await pool.query(
        `UPDATE land_parcels
         SET boundary = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
             boundary_geojson = $1::jsonb,
             area_sqm = $2,
             perimeter_m = $3,
             centroid_lat = $4,
             centroid_lng = $5,
             state_id = $6,
             lga_id = $7,
             community_id = $8,
             boundary_source = $9,
             boundary_change_reason = 'GIS boundary revalidation',
             is_geometry_valid = TRUE,
             overlap_checked = TRUE,
             status = 'VALIDATED',
             validated_by = $10,
             validated_at = NOW()
         WHERE id = $11
         RETURNING *, ST_AsGeoJSON(boundary)::jsonb AS boundary_geojson`,
        [
          geojsonText,
          Number(row.computed_area_sqm).toFixed(2),
          Number(row.computed_perimeter_m).toFixed(2),
          row.centroid_lat,
          row.centroid_lng,
          application.state_id || null,
          application.lga_id || null,
          application.community_id || null,
          application.boundary_source || 'USER_SUBMITTED',
          surveyorId,
          existingParcelRes.rows[0].id,
        ]
      );
      parcel = upd.rows[0];
    } else {
      const tempCode = `ANG-PARCEL-PENDING-${Date.now()}`;
      const ins = await pool.query(
        `INSERT INTO land_parcels (
          application_id, parcel_code, boundary, boundary_geojson,
          area_sqm, perimeter_m, centroid_lat, centroid_lng, state_id, lga_id, community_id,
          boundary_source, boundary_change_reason,
          is_geometry_valid, overlap_checked, status, validated_by, validated_at
        ) VALUES (
          $1,$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326),$3::jsonb,
          $4,$5,$6,$7,$8,$9,$10,$11,'Initial GIS validation',
          TRUE,TRUE,'VALIDATED',$12,NOW()
        )
        RETURNING *`,
        [
          application.id,
          tempCode,
          geojsonText,
          Number(row.computed_area_sqm).toFixed(2),
          Number(row.computed_perimeter_m).toFixed(2),
          row.centroid_lat,
          row.centroid_lng,
          application.state_id || null,
          application.lga_id || null,
          application.community_id || null,
          application.boundary_source || 'USER_SUBMITTED',
          surveyorId,
        ]
      );
      const code = generateParcelCode(ins.rows[0].id);
      const updCode = await pool.query(
        `UPDATE land_parcels SET parcel_code = $1 WHERE id = $2
         RETURNING *, ST_AsGeoJSON(boundary)::jsonb AS boundary_geojson`,
        [code, ins.rows[0].id]
      );
      parcel = updCode.rows[0];
    }

    await transitionApplicationStatus({
      applicationId: application.id,
      expectedStatus: application.status,
      nextStatus: 'GIS_VALIDATED',
      changedBy: surveyorId,
      actorRole,
      reason: 'GIS geometry and overlap validation passed',
    });

    return {
      passed: true,
      status: 'GIS_VALIDATED',
      validationTimeMs,
      parcel,
      validation: {
        isValid: true,
        validityReason: 'Valid Geometry',
        hasOverlap: false,
        overlappingParcels: [],
        computedAreaSqm: Number(Number(row.computed_area_sqm).toFixed(2)),
        computedPerimeterM: Number(Number(row.computed_perimeter_m).toFixed(2)),
        centroid: { lat: row.centroid_lat, lng: row.centroid_lng },
        toleranceSqm: OVERLAP_TOLERANCE_SQM,
      },
    };
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const geojsonText = JSON.stringify(application.coordinates_geojson);
    const { data, error } = await sb.rpc('anagu_validate_parcel_polygon_phase4', {
      p_geojson_text: geojsonText,
      p_exclude_application_id: application.id,
      p_overlap_tolerance_sqm: OVERLAP_TOLERANCE_SQM,
    });
    assertNoSupabaseError(error, 'Validate parcel using PostGIS Phase 4 function');
    const postgisRow = Array.isArray(data) ? data[0] : null;
    if (!postgisRow) throw new Error('PostGIS Phase 4 validation returned no result.');

    const isValid = Boolean(postgisRow.is_valid);
    const validityReason =
      postgisRow.validity_reason || (isValid ? 'Valid Geometry' : 'Invalid geometry');
    const hasOverlap = Boolean(postgisRow.has_overlap);
    const overlappingParcels = (postgisRow.overlapping_parcel_codes || []).map((parcelCode) => ({
      parcelCode,
    }));
    const areaSqm = Number(Number(postgisRow.computed_area_sqm || 0).toFixed(2));
    const perimeterM = Number(Number(postgisRow.computed_perimeter_m || 0).toFixed(2));
    const centroid = {
      lat: Number(postgisRow.centroid_lat || 0),
      lng: Number(postgisRow.centroid_lng || 0),
    };

    const validationTimeMs = Number((performance.now() - startedAt).toFixed(2));
    const now = new Date().toISOString();

    if (!isValid) {
      await transitionApplicationStatus({
        applicationId: application.id,
        expectedStatus: application.status,
        nextStatus: 'GIS_REJECTED',
        changedBy: surveyorId,
        actorRole,
        reason: `Invalid geometry (ST_IsValid): ${validityReason}`,
      });

      return {
        passed: false,
        status: 'GIS_REJECTED',
        validationTimeMs,
        validation: {
          isValid: false,
          validityReason,
          hasOverlap: false,
          overlappingParcels: [],
          toleranceSqm: OVERLAP_TOLERANCE_SQM,
        },
      };
    }

    if (hasOverlap) {
      const detailText = overlappingParcels
        .map((p) => (p.overlapAreaSqm ? `${p.parcelCode} (~${p.overlapAreaSqm} m²)` : p.parcelCode))
        .join(', ');
      const reason = `Boundary overlap detected via PostGIS ST_Intersects() with existing parcel(s): ${detailText} (exceeds ${OVERLAP_TOLERANCE_SQM} m² tolerance).`;
      await transitionApplicationStatus({
        applicationId: application.id,
        expectedStatus: application.status,
        nextStatus: 'GIS_REJECTED',
        changedBy: surveyorId,
        actorRole,
        reason,
      });

      return {
        passed: false,
        status: 'GIS_REJECTED',
        validationTimeMs,
        validation: {
          isValid: true,
          validityReason,
          hasOverlap: true,
          overlappingParcels,
          computedAreaSqm: areaSqm,
          computedPerimeterM: perimeterM,
          centroid,
          toleranceSqm: OVERLAP_TOLERANCE_SQM,
        },
      };
    }

    const { data: existingParcel, error: findErr } = await sb
      .from('land_parcels')
      .select('*')
      .eq('application_id', application.id)
      .maybeSingle();
    assertNoSupabaseError(findErr, 'Lookup existing parcel');

    let parcel;
    if (existingParcel) {
      const { data: updated, error: updErr } = await sb
        .from('land_parcels')
        .update({
          boundary_geojson: application.coordinates_geojson,
          area_sqm: areaSqm,
          perimeter_m: perimeterM,
          centroid_lat: centroid.lat,
          centroid_lng: centroid.lng,
          state_id: application.state_id || null,
          lga_id: application.lga_id || null,
          community_id: application.community_id || null,
          boundary_source: application.boundary_source || 'USER_SUBMITTED',
          boundary_change_reason: 'GIS boundary revalidation',
          is_geometry_valid: true,
          overlap_checked: true,
          status: 'VALIDATED',
          validated_by: surveyorId,
          validated_at: now,
        })
        .eq('id', existingParcel.id)
        .select('*')
        .single();
      assertNoSupabaseError(updErr, 'Update validated parcel');
      parcel = updated;
    } else {
      const tempCode = `ANG-PARCEL-PENDING-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      const { data: inserted, error: insErr } = await sb
        .from('land_parcels')
        .insert({
          application_id: application.id,
          parcel_code: tempCode,
          boundary_geojson: application.coordinates_geojson,
          area_sqm: areaSqm,
          perimeter_m: perimeterM,
          centroid_lat: centroid.lat,
          centroid_lng: centroid.lng,
          state_id: application.state_id || null,
          lga_id: application.lga_id || null,
          community_id: application.community_id || null,
          boundary_source: application.boundary_source || 'USER_SUBMITTED',
          boundary_change_reason: 'Initial GIS validation',
          is_geometry_valid: true,
          overlap_checked: true,
          status: 'VALIDATED',
          validated_by: surveyorId,
          validated_at: now,
        })
        .select('*')
        .single();
      assertNoSupabaseError(insErr, 'Insert validated parcel');

      const finalCode = generateParcelCode(inserted.id);
      const { data: updatedCode, error: codeErr } = await sb
        .from('land_parcels')
        .update({ parcel_code: finalCode })
        .eq('id', inserted.id)
        .select('*')
        .single();
      assertNoSupabaseError(codeErr, 'Set final parcel code');
      parcel = updatedCode;
    }

    await transitionApplicationStatus({
      applicationId: application.id,
      expectedStatus: application.status,
      nextStatus: 'GIS_VALIDATED',
      changedBy: surveyorId,
      actorRole,
      reason: 'GIS geometry and overlap validation passed',
    });

    return {
      passed: true,
      status: 'GIS_VALIDATED',
      validationTimeMs,
      parcel,
      validation: {
        isValid: true,
        validityReason: 'Valid Geometry',
        hasOverlap: false,
        overlappingParcels: [],
        computedAreaSqm: areaSqm,
        computedPerimeterM: perimeterM,
        centroid,
        toleranceSqm: OVERLAP_TOLERANCE_SQM,
      },
    };
  }

  // Container prototype spatial engine
  const store = loadLocalStore();
  const appRecord = store.tables.land_applications.find((a) => a.id === application.id);
  const geomResult = validatePolygonGeometry(application.coordinates_geojson);

  if (!geomResult.isValid) {
    const validationTimeMs = Number((performance.now() - startedAt).toFixed(2));
    const previousStatus = appRecord.status;
    appRecord.status = 'GIS_REJECTED';
    appRecord.rejection_reason = `Invalid geometry (ST_IsValid): ${geomResult.validityReason}`;
    appRecord.updated_at = new Date().toISOString();
    recordLocalApplicationStatusHistory(
      store,
      appRecord,
      previousStatus,
      appRecord.status,
      surveyorId,
      actorRole,
      appRecord.rejection_reason
    );
    saveLocalStore(store);

    return {
      passed: false,
      status: 'GIS_REJECTED',
      validationTimeMs,
      validation: {
        isValid: false,
        validityReason: geomResult.validityReason,
        hasOverlap: false,
        overlappingParcels: [],
        toleranceSqm: OVERLAP_TOLERANCE_SQM,
      },
    };
  }

  const overlapResult = detectPolygonOverlap(
    application.coordinates_geojson,
    store.tables.land_parcels || [],
    application.id,
    OVERLAP_TOLERANCE_SQM
  );
  const validationTimeMs = Number((performance.now() - startedAt).toFixed(2));

  if (overlapResult.hasOverlap) {
    const detailText = overlapResult.overlappingParcels
      .map((p) => `${p.parcelCode} (~${p.overlapAreaSqm} m²)`)
      .join(', ');
    const previousStatus = appRecord.status;
    appRecord.status = 'GIS_REJECTED';
    appRecord.rejection_reason = `Boundary overlap detected via ST_Intersects() with existing parcel(s): ${detailText} (exceeds ${OVERLAP_TOLERANCE_SQM} m² tolerance).`;
    appRecord.updated_at = new Date().toISOString();
    recordLocalApplicationStatusHistory(
      store,
      appRecord,
      previousStatus,
      appRecord.status,
      surveyorId,
      actorRole,
      appRecord.rejection_reason
    );
    saveLocalStore(store);

    return {
      passed: false,
      status: 'GIS_REJECTED',
      validationTimeMs,
      validation: {
        isValid: true,
        validityReason: geomResult.validityReason,
        hasOverlap: true,
        overlappingParcels: overlapResult.overlappingParcels,
        computedAreaSqm: geomResult.areaSqm,
        centroid: geomResult.centroid,
        toleranceSqm: OVERLAP_TOLERANCE_SQM,
      },
    };
  }

  let parcel = (store.tables.land_parcels || []).find((p) => p.application_id === application.id);
  const now = new Date().toISOString();
  const perimeterM = computeGeodesicPerimeterM(
    application.coordinates_geojson.coordinates[0]
  );
  const boundarySource = application.boundary_source || 'USER_SUBMITTED';
  if (parcel) {
    parcel.boundary_geojson = JSON.parse(JSON.stringify(application.coordinates_geojson));
    parcel.area_sqm = geomResult.areaSqm;
    parcel.perimeter_m = perimeterM;
    parcel.centroid_lat = geomResult.centroid.lat;
    parcel.centroid_lng = geomResult.centroid.lng;
    parcel.state_id = application.state_id || null;
    parcel.lga_id = application.lga_id || null;
    parcel.community_id = application.community_id || null;
    parcel.boundary_source = boundarySource;
    parcel.is_geometry_valid = true;
    parcel.overlap_checked = true;
    parcel.status = 'VALIDATED';
    parcel.validated_by = surveyorId;
    parcel.validated_at = now;
  } else {
    const id = nextSequence(store, 'land_parcels');
    parcel = {
      id,
      application_id: application.id,
      parcel_code: generateParcelCode(id),
      boundary_geojson: JSON.parse(JSON.stringify(application.coordinates_geojson)),
      area_sqm: geomResult.areaSqm,
      perimeter_m: perimeterM,
      centroid_lat: geomResult.centroid.lat,
      centroid_lng: geomResult.centroid.lng,
      state_id: application.state_id || null,
      lga_id: application.lga_id || null,
      community_id: application.community_id || null,
      boundary_source: boundarySource,
      is_geometry_valid: true,
      overlap_checked: true,
      status: 'VALIDATED',
      validated_by: surveyorId,
      validated_at: now,
      created_at: now,
    };
    store.tables.land_parcels.push(parcel);
  }

  recordLocalBoundaryVersion(
    store,
    parcel,
    application,
    surveyorId,
    now,
    parcel.boundary_version ? 'GIS boundary revalidation' : 'Initial GIS validation'
  );

  const previousStatus = appRecord.status;
  appRecord.status = 'GIS_VALIDATED';
  appRecord.rejection_reason = null;
  appRecord.updated_at = now;
  recordLocalApplicationStatusHistory(
    store,
    appRecord,
    previousStatus,
    appRecord.status,
    surveyorId,
    actorRole,
    'GIS geometry and overlap validation passed'
  );
  saveLocalStore(store);

  return {
    passed: true,
    status: 'GIS_VALIDATED',
    validationTimeMs,
    parcel,
    validation: {
      isValid: true,
      validityReason: 'Valid Geometry',
      hasOverlap: false,
      overlappingParcels: [],
      computedAreaSqm: geomResult.areaSqm,
      computedPerimeterM: perimeterM,
      centroid: geomResult.centroid,
      toleranceSqm: OVERLAP_TOLERANCE_SQM,
    },
  };
}

export async function listBoundaryHistory(applicationId) {
  const numericId = Number(applicationId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    throw new Error('A valid application ID is required.');
  }

  if (env.pg.enabled) {
    const { rows } = await getPgPool().query(
      `SELECT id, parcel_id, application_id, version_number, boundary_geojson,
              geometry_hash, boundary_source, change_reason, changed_by, created_at
       FROM parcel_boundary_versions
       WHERE application_id = $1
       ORDER BY version_number ASC`,
      [numericId]
    );
    return rows;
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabaseClient()
      .from('parcel_boundary_versions')
      .select(
        'id, parcel_id, application_id, version_number, boundary_geojson, geometry_hash, boundary_source, change_reason, changed_by, created_at'
      )
      .eq('application_id', numericId)
      .order('version_number', { ascending: true });
    assertNoSupabaseError(error, 'List parcel boundary history');
    return data || [];
  }

  const store = loadLocalStore();
  return (store.tables.parcel_boundary_versions || [])
    .filter((version) => version.application_id === numericId)
    .sort((a, b) => a.version_number - b.version_number);
}

export async function listMapParcels(user) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const parcelsRes = await pool.query(
      `SELECT lp.*, ST_AsGeoJSON(lp.boundary)::jsonb AS boundary_geojson,
              la.reference_code, la.parcel_name, la.claimant_name, la.region, la.status AS application_status
       FROM land_parcels lp
       JOIN land_applications la ON la.id = lp.application_id
       ORDER BY lp.id DESC`
    );
    const pendingRes = await pool.query(
      `SELECT la.* FROM land_applications la
       WHERE la.status IN ('SUBMITTED', 'AWAITING_GIS_REVIEW', 'GIS_REJECTED')
         AND ($1 <> 'CITIZEN' OR la.applicant_id = $2)
       ORDER BY la.submitted_at DESC`,
      [user.roleCode, user.id]
    );
    return { parcels: parcelsRes.rows, pendingApplications: pendingRes.rows };
  }

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const [parcelsRes, appsRes] = await Promise.all([
      sb.from('land_parcels').select('*').order('id', { ascending: false }),
      sb.from('land_applications').select('*').order('submitted_at', { ascending: false }),
    ]);
    assertNoSupabaseError(parcelsRes.error, 'List map parcels');
    assertNoSupabaseError(appsRes.error, 'List map applications');

    const appsById = new Map((appsRes.data || []).map((a) => [a.id, a]));
    const parcels = (parcelsRes.data || []).map((p) => {
      const app = appsById.get(p.application_id);
      return {
        ...p,
        reference_code: app?.reference_code || '',
        parcel_name: app?.parcel_name || '',
        claimant_name: app?.claimant_name || '',
        region: app?.region || '',
        application_status: app?.status || '',
      };
    });

    const pendingApplications = (appsRes.data || []).filter(
      (a) =>
        ['SUBMITTED', 'AWAITING_GIS_REVIEW', 'GIS_REJECTED'].includes(a.status) &&
        (user.roleCode !== 'CITIZEN' || a.applicant_id === user.id)
    );

    return { parcels, pendingApplications };
  }

  const store = loadLocalStore();
  const appsById = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const parcels = (store.tables.land_parcels || []).map((p) => {
    const app = appsById.get(p.application_id);
    return {
      ...p,
      reference_code: app?.reference_code || '',
      parcel_name: app?.parcel_name || '',
      claimant_name: app?.claimant_name || '',
      region: app?.region || '',
      application_status: app?.status || '',
    };
  });

  const pendingApplications = (store.tables.land_applications || []).filter(
    (a) =>
      ['SUBMITTED', 'AWAITING_GIS_REVIEW', 'GIS_REJECTED'].includes(a.status) &&
      (user.roleCode !== 'CITIZEN' || a.applicant_id === user.id)
  );

  return { parcels, pendingApplications };
}

export async function findParcelAtCoordinates({ lat, lng }) {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  if (
    !Number.isFinite(numericLat) ||
    !Number.isFinite(numericLng) ||
    Math.abs(numericLat) > 90 ||
    Math.abs(numericLng) > 180
  ) {
    throw new Error('Valid WGS84 latitude and longitude coordinates are required.');
  }

  if (env.pg.enabled) {
    const pool = getPgPool();
    const parcelRes = await pool.query(
      `SELECT lp.id, lp.application_id, lp.parcel_code, lp.area_sqm, lp.status,
              la.reference_code, la.parcel_name, la.region
       FROM land_parcels lp
       JOIN land_applications la ON la.id = lp.application_id
       WHERE ST_Covers(lp.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       ORDER BY CASE lp.status WHEN 'ACTIVE' THEN 0 WHEN 'VALIDATED' THEN 1 ELSE 2 END, lp.id DESC
       LIMIT 1`,
      [numericLng, numericLat]
    );
    if (parcelRes.rows[0]) {
      const p = parcelRes.rows[0];
      return {
        matched: true,
        matchType: 'REGISTERED_PARCEL',
        parcelCode: p.parcel_code,
        referenceCode: p.reference_code,
        parcelName: p.parcel_name,
        status: p.status,
        areaSqm: Number(p.area_sqm),
        region: p.region,
        applicationId: p.application_id,
        source: 'REGISTERED_PARCEL',
      };
    }

    const appRes = await pool.query(
      `SELECT id, reference_code, parcel_name, region, declared_area_sqm, status
       FROM land_applications
       WHERE status IN ('SUBMITTED', 'GIS_REJECTED')
         AND ST_Covers(
           ST_SetSRID(ST_GeomFromGeoJSON(coordinates_geojson::text), 4326),
           ST_SetSRID(ST_MakePoint($1, $2), 4326)
         )
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [numericLng, numericLat]
    );
    if (appRes.rows[0]) {
      const a = appRes.rows[0];
      return {
        matched: true,
        matchType: 'PENDING_APPLICATION',
        parcelCode: null,
        referenceCode: a.reference_code,
        parcelName: a.parcel_name,
        status: a.status,
        areaSqm: Number(a.declared_area_sqm),
        region: a.region,
        applicationId: a.id,
        source: 'PENDING_APPLICATION',
      };
    }

    const recRes = await pool.query(
      `SELECT record_source, source_reference, parcel_code, claim_status, notes,
              ST_Area(ST_GeogFromWKB(ST_AsEWKB(boundary))) AS area_sqm
       FROM ownership_records
       WHERE ST_Covers(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       LIMIT 1`,
      [numericLng, numericLat]
    );
    if (recRes.rows[0]) {
      const r = recRes.rows[0];
      return {
        matched: true,
        matchType: 'INSTITUTIONAL_RECORD',
        parcelCode: r.parcel_code,
        referenceCode: r.source_reference,
        parcelName: r.notes || r.source_reference,
        status: r.claim_status,
        areaSqm: Number(Number(r.area_sqm || 0).toFixed(2)),
        region: null,
        applicationId: null,
        source: r.record_source,
      };
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

  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    try {
      const { data: rpcRows, error: rpcErr } = await sb.rpc('anagu_find_parcel_at_coordinates', {
        p_lat: numericLat,
        p_lng: numericLng,
      });
      if (!rpcErr && Array.isArray(rpcRows) && rpcRows[0]) {
        const hit = rpcRows[0];
        return {
          matched: Boolean(hit.matched),
          matchType: hit.match_type || 'UNCLAIMED',
          parcelCode: hit.parcel_code || null,
          referenceCode: hit.reference_code || null,
          parcelName: hit.parcel_name || null,
          status: hit.status || 'UNCLAIMED',
          areaSqm: hit.area_sqm != null ? Number(hit.area_sqm) : null,
          region: hit.region || null,
          applicationId: hit.application_id || null,
          source: hit.source || null,
        };
      }
    } catch {
      // Fall back to GeoJSON point-in-polygon lookup
    }

    const [parcelsRes, appsRes, recsRes] = await Promise.all([
      sb.from('land_parcels').select('*'),
      sb.from('land_applications').select('*'),
      sb.from('ownership_records').select('*'),
    ]);
    assertNoSupabaseError(parcelsRes.error, 'Lookup parcel polygons');
    assertNoSupabaseError(appsRes.error, 'Lookup parcel applications');
    assertNoSupabaseError(recsRes.error, 'Lookup institutional records');

    const appsById = new Map((appsRes.data || []).map((a) => [a.id, a]));
    const statusRank = { ACTIVE: 0, VALIDATED: 1, REVOKED: 2 };
    const sortedParcels = [...(parcelsRes.data || [])].sort(
      (a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || b.id - a.id
    );

    for (const parcel of sortedParcels) {
      if (isPointInPolygon(numericLat, numericLng, parcel.boundary_geojson)) {
        const app = appsById.get(parcel.application_id);
        return {
          matched: true,
          matchType: 'REGISTERED_PARCEL',
          parcelCode: parcel.parcel_code,
          referenceCode: app?.reference_code || null,
          parcelName: app?.parcel_name || parcel.parcel_code,
          status: parcel.status,
          areaSqm: Number(parcel.area_sqm),
          region: app?.region || null,
          applicationId: parcel.application_id,
          source: 'REGISTERED_PARCEL',
        };
      }
    }

    for (const app of appsRes.data || []) {
      if (!['SUBMITTED', 'GIS_REJECTED'].includes(app.status)) continue;
      if (isPointInPolygon(numericLat, numericLng, app.coordinates_geojson)) {
        return {
          matched: true,
          matchType: 'PENDING_APPLICATION',
          parcelCode: null,
          referenceCode: app.reference_code,
          parcelName: app.parcel_name,
          status: app.status,
          areaSqm: Number(app.declared_area_sqm),
          region: app.region,
          applicationId: app.id,
          source: 'PENDING_APPLICATION',
        };
      }
    }

    for (const record of recsRes.data || []) {
      if (isPointInPolygon(numericLat, numericLng, record.boundary_geojson)) {
        const ring = record.boundary_geojson?.coordinates?.[0] || [];
        return {
          matched: true,
          matchType: 'INSTITUTIONAL_RECORD',
          parcelCode: record.parcel_code,
          referenceCode: record.source_reference,
          parcelName: record.notes || record.source_reference,
          status: record.claim_status,
          areaSqm: Number(computeGeodesicAreaSqm(ring).toFixed(2)),
          region: null,
          applicationId: null,
          source: record.record_source,
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

  // Container prototype lookup
  const store = loadLocalStore();
  const appsById = new Map((store.tables.land_applications || []).map((a) => [a.id, a]));
  const statusRank = { ACTIVE: 0, VALIDATED: 1, REVOKED: 2 };
  const sortedParcels = [...(store.tables.land_parcels || [])].sort(
    (a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || b.id - a.id
  );

  for (const parcel of sortedParcels) {
    if (isPointInPolygon(numericLat, numericLng, parcel.boundary_geojson)) {
      const app = appsById.get(parcel.application_id);
      return {
        matched: true,
        matchType: 'REGISTERED_PARCEL',
        parcelCode: parcel.parcel_code,
        referenceCode: app?.reference_code || null,
        parcelName: app?.parcel_name || parcel.parcel_code,
        status: parcel.status,
        areaSqm: Number(parcel.area_sqm),
        region: app?.region || null,
        applicationId: parcel.application_id,
        source: 'REGISTERED_PARCEL',
      };
    }
  }

  for (const app of store.tables.land_applications || []) {
    if (!['SUBMITTED', 'GIS_REJECTED'].includes(app.status)) continue;
    if (isPointInPolygon(numericLat, numericLng, app.coordinates_geojson)) {
      return {
        matched: true,
        matchType: 'PENDING_APPLICATION',
        parcelCode: null,
        referenceCode: app.reference_code,
        parcelName: app.parcel_name,
        status: app.status,
        areaSqm: Number(app.declared_area_sqm),
        region: app.region,
        applicationId: app.id,
        source: 'PENDING_APPLICATION',
      };
    }
  }

  for (const record of store.tables.ownership_records || []) {
    if (isPointInPolygon(numericLat, numericLng, record.boundary_geojson)) {
      const ring = record.boundary_geojson?.coordinates?.[0] || [];
      return {
        matched: true,
        matchType: 'INSTITUTIONAL_RECORD',
        parcelCode: record.parcel_code,
        referenceCode: record.source_reference,
        parcelName: record.notes || record.source_reference,
        status: record.claim_status,
        areaSqm: Number(computeGeodesicAreaSqm(ring).toFixed(2)),
        region: null,
        applicationId: null,
        source: record.record_source,
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
