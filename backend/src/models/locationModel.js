import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { getPgPool } from '../config/db.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

const referencePath = fileURLToPath(
  new URL('../../../database/seeds/nigeria-geographic-reference.json', import.meta.url)
);
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
export const LOCATION_REFERENCE_MIGRATION_ERROR =
  'Geographic reference data is not installed. Apply migration 012_nigeria_geographic_reference.sql.';
const missingReferenceSchemaCodes = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);
const localStates = reference.states.map((state, index) => ({
  id: index + 1,
  code: state.sourceCode,
  name: state.name,
  source_code: state.sourceCode,
  center_lat: state.centerLat,
  center_lng: state.centerLng,
  is_active: true,
}));
const localStateIds = new Map(localStates.map((state) => [state.source_code, state.id]));
const localLgas = reference.lgas.map((lga, index) => ({
  id: index + 1,
  state_id: localStateIds.get(lga.stateCode),
  name: lga.name,
  source_code: lga.sourceCode,
  center_lat: lga.centerLat,
  center_lng: lga.centerLng,
  is_active: true,
}));
const localLgaIds = new Map(localLgas.map((lga) => [lga.source_code, lga.id]));
const localCommunities = reference.wards.map((ward, index) => ({
  id: index + 1,
  lga_id: localLgaIds.get(ward.lgaCode),
  name: ward.name,
  source_code: ward.sourceCode,
  center_lat: ward.centerLat,
  center_lng: ward.centerLng,
  place_type: 'WARD',
  is_active: true,
}));

export function getLocationReferenceMetadata() {
  return {
    ...reference.metadata,
    recordCounts: {
      states: reference.states.length,
      localGovernmentAreas: reference.lgas.length,
      partialCoverageWards: reference.wards.length,
    },
  };
}

export function isLocationReferenceSchemaMissing(error) {
  return missingReferenceSchemaCodes.has(error?.code);
}

function positiveId(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sortByName(rows) {
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export async function listStates() {
  if (env.pg.enabled) {
    const { rows } = await getPgPool().query(
      `SELECT id, code, name, source_code, center_lat, center_lng
       FROM states WHERE is_active = TRUE ORDER BY name`
    );
    return rows;
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabaseClient()
      .from('states')
      .select('id, code, name, source_code, center_lat, center_lng')
      .eq('is_active', true)
      .order('name');
    assertNoSupabaseError(error, 'List geographic states');
    return data || [];
  }

  return sortByName([...localStates]);
}

export async function listLocalGovernmentAreas(stateId) {
  const normalizedStateId = positiveId(stateId);
  if (!normalizedStateId) throw new Error('A valid state ID is required.');

  if (env.pg.enabled) {
    const { rows } = await getPgPool().query(
      `SELECT id, state_id, name, source_code, center_lat, center_lng
       FROM local_government_areas
       WHERE state_id = $1 AND is_active = TRUE
       ORDER BY name`,
      [normalizedStateId]
    );
    return rows;
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabaseClient()
      .from('local_government_areas')
      .select('id, state_id, name, source_code, center_lat, center_lng')
      .eq('state_id', normalizedStateId)
      .eq('is_active', true)
      .order('name');
    assertNoSupabaseError(error, 'List local government areas');
    return data || [];
  }

  return sortByName(localLgas.filter((lga) => lga.state_id === normalizedStateId));
}

export async function listCommunities(lgaId) {
  const normalizedLgaId = positiveId(lgaId);
  if (!normalizedLgaId) throw new Error('A valid LGA ID is required.');

  if (env.pg.enabled) {
    const { rows } = await getPgPool().query(
      `SELECT id, lga_id, name, source_code, center_lat, center_lng, place_type
       FROM communities
       WHERE lga_id = $1 AND is_active = TRUE
       ORDER BY place_type, name`,
      [normalizedLgaId]
    );
    return rows;
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabaseClient()
      .from('communities')
      .select('id, lga_id, name, source_code, center_lat, center_lng, place_type')
      .eq('lga_id', normalizedLgaId)
      .eq('is_active', true)
      .order('place_type')
      .order('name');
    assertNoSupabaseError(error, 'List community and ward records');
    return data || [];
  }

  return sortByName(localCommunities.filter((community) => community.lga_id === normalizedLgaId));
}

export async function validateLocationSelection({ stateId, lgaId, communityId }) {
  const hasSelection = [stateId, lgaId, communityId].some(
    (value) => value !== undefined && value !== null && value !== ''
  );
  if (!hasSelection) return { stateId: null, lgaId: null, communityId: null };

  const normalizedStateId = positiveId(stateId);
  const normalizedLgaId = positiveId(lgaId);
  const normalizedCommunityId = positiveId(communityId);
  if (!normalizedStateId || !normalizedLgaId) {
    throw new Error('Select both a valid state and an LGA.');
  }
  if (communityId !== undefined && communityId !== null && communityId !== '' && !normalizedCommunityId) {
    throw new Error('Select a valid community or ward.');
  }

  if (env.pg.enabled) {
    const pool = getPgPool();
    const lga = await pool.query(
      `SELECT id FROM local_government_areas
       WHERE id = $1 AND state_id = $2 AND is_active = TRUE`,
      [normalizedLgaId, normalizedStateId]
    );
    if (!lga.rows[0]) throw new Error('The selected LGA does not belong to the selected state.');
    if (normalizedCommunityId) {
      const community = await pool.query(
        `SELECT c.id FROM communities c
         JOIN local_government_areas lga ON lga.id = c.lga_id
         WHERE c.id = $1 AND c.lga_id = $2 AND lga.state_id = $3
           AND c.is_active = TRUE AND lga.is_active = TRUE`,
        [normalizedCommunityId, normalizedLgaId, normalizedStateId]
      );
      if (!community.rows[0]) {
        throw new Error('The selected community or ward does not belong to the selected LGA.');
      }
    }
  } else if (isSupabaseActive()) {
    const supabase = getSupabaseClient();
    const { data: lga, error: lgaError } = await supabase
      .from('local_government_areas')
      .select('id')
      .eq('id', normalizedLgaId)
      .eq('state_id', normalizedStateId)
      .eq('is_active', true)
      .maybeSingle();
    assertNoSupabaseError(lgaError, 'Validate selected local government area');
    if (!lga) throw new Error('The selected LGA does not belong to the selected state.');
    if (normalizedCommunityId) {
      const { data: community, error: communityError } = await supabase
        .from('communities')
        .select('id')
        .eq('id', normalizedCommunityId)
        .eq('lga_id', normalizedLgaId)
        .eq('is_active', true)
        .maybeSingle();
      assertNoSupabaseError(communityError, 'Validate selected community or ward');
      if (!community) {
        throw new Error('The selected community or ward does not belong to the selected LGA.');
      }
    }
  } else {
    const lga = localLgas.find(
      (row) => row.id === normalizedLgaId && row.state_id === normalizedStateId
    );
    if (!lga) throw new Error('The selected LGA does not belong to the selected state.');
    if (
      normalizedCommunityId &&
      !localCommunities.some(
        (row) => row.id === normalizedCommunityId && row.lga_id === normalizedLgaId
      )
    ) {
      throw new Error('The selected community or ward does not belong to the selected LGA.');
    }
  }

  return {
    stateId: normalizedStateId,
    lgaId: normalizedLgaId,
    communityId: normalizedCommunityId,
  };
}
