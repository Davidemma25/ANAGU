import {
  getLocationReferenceMetadata,
  isLocationReferenceSchemaMissing,
  LOCATION_REFERENCE_MIGRATION_ERROR,
  listCommunities,
  listLocalGovernmentAreas,
  listStates,
} from '../models/locationModel.js';

function handleReferenceError(res, error, fallbackMessage, logMessage) {
  if (isLocationReferenceSchemaMissing(error)) {
    return res.status(503).json({
      error: LOCATION_REFERENCE_MIGRATION_ERROR,
      code: 'GIS_REFERENCE_MIGRATION_REQUIRED',
    });
  }
  console.error(logMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

export async function getStates(_req, res) {
  try {
    const states = await listStates();
    return res.json({ locations: states, source: getLocationReferenceMetadata() });
  } catch (error) {
    return handleReferenceError(
      res,
      error,
      'Failed to load geographic states.',
      'List geographic states error:'
    );
  }
}

export async function getLgas(req, res) {
  try {
    const lgas = await listLocalGovernmentAreas(req.params.stateId);
    return res.json({ locations: lgas, source: getLocationReferenceMetadata() });
  } catch (error) {
    if (/valid state ID/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return handleReferenceError(
      res,
      error,
      'Failed to load local government areas.',
      'List geographic LGAs error:'
    );
  }
}

export async function getCommunities(req, res) {
  try {
    const communities = await listCommunities(req.params.lgaId);
    return res.json({
      locations: communities,
      source: getLocationReferenceMetadata(),
      coverageNote: getLocationReferenceMetadata().note,
    });
  } catch (error) {
    if (/valid LGA ID/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return handleReferenceError(
      res,
      error,
      'Failed to load community and ward records.',
      'List geographic communities error:'
    );
  }
}
