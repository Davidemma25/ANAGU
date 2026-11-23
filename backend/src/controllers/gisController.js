import {
  findApplicationById,
  normalizeBoundarySource,
  normalizeGeoJsonPolygon,
  updateApplicationBoundary,
} from '../models/applicationModel.js';
import {
  findParcelAtCoordinates,
  listBoundaryHistory,
  listMapParcels,
  validateAndRegisterParcel,
} from '../services/gisService.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';

const missingGisSchemaCodes = new Set([
  '42703',
  '42883',
  '42P01',
  'PGRST202',
  'PGRST204',
  'PGRST205',
]);

function handleGisError(res, error, fallbackMessage, logMessage) {
  if (missingGisSchemaCodes.has(error?.code)) {
    return res.status(503).json({
      error: 'GIS Phase 4 schema is not installed. Apply migrations 012_nigeria_geographic_reference.sql and 013_gis_measurements_and_boundary_history.sql.',
      code: 'GIS_PHASE4_MIGRATION_REQUIRED',
    });
  }
  console.error(logMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

export async function lookupParcelByCoordinates(req, res) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      req.query.lat === undefined ||
      req.query.lng === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return res.status(400).json({
        error: 'Valid lat (-90..90) and lng (-180..180) query parameters are required.',
      });
    }

    const result = await findParcelAtCoordinates({ lat, lng });
    return res.json({
      coordinates: { lat, lng },
      ...result,
    });
  } catch (error) {
    return handleGisError(
      res,
      error,
      'Failed to look up parcel at coordinates.',
      'GIS parcel lookup error:'
    );
  }
}

export async function getGisMapData(req, res) {
  try {
    const data = await listMapParcels(req.user);
    return res.json(data);
  } catch (error) {
    return handleGisError(res, error, 'Failed to load GIS parcel data.', 'GIS map fetch error:');
  }
}

export async function getApplicationBoundaryHistory(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    if (req.user.roleCode === 'CITIZEN' && application.applicant_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied. Citizens can only view boundary history for their own applications.',
      });
    }

    const versions = await listBoundaryHistory(application.id);
    return res.json({ applicationId: application.id, versions });
  } catch (error) {
    return handleGisError(
      res,
      error,
      'Failed to load parcel boundary history.',
      'GIS boundary history error:'
    );
  }
}

export async function saveApplicationBoundary(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    const isCitizenOwner =
      req.user.roleCode === 'CITIZEN' && application.applicant_id === req.user.id;
    const isGisStaff = ['SURVEYOR', 'LAND_ADMIN'].includes(req.user.roleCode);
    if (!isCitizenOwner && !isGisStaff) {
      return res.status(403).json({
        error: 'Access denied. Only the applicant or authorized GIS staff can change this boundary.',
      });
    }

    const allowedStatuses = isCitizenOwner
      ? ['SUBMITTED', 'GIS_REJECTED', 'CORRECTION_REQUIRED']
      : ['SUBMITTED', 'GIS_REJECTED', 'GIS_VALIDATED', 'CORRECTION_REQUIRED'];
    if (!allowedStatuses.includes(application.status)) {
      return res.status(409).json({
        error: `Application is in ${application.status} stage and its boundary cannot be changed.`,
      });
    }

    let coordinatesGeojson;
    let boundarySource;
    try {
      coordinatesGeojson = normalizeGeoJsonPolygon(req.body?.coordinates);
      boundarySource = normalizeBoundarySource(
        req.body?.boundarySource ?? application.boundary_source
      );
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    if (JSON.stringify(coordinatesGeojson) === JSON.stringify(application.coordinates_geojson)) {
      return res.status(409).json({ error: 'The submitted boundary matches the current boundary.' });
    }

    const changeReason = String(req.body?.changeReason || '').trim();
    if (changeReason.length < 5) {
      return res.status(400).json({
        error: 'A boundary change reason of at least 5 characters is required.',
      });
    }

    const updatedApplication = await updateApplicationBoundary({
      applicationId: application.id,
      coordinatesGeojson,
      boundarySource,
      changeReason,
      changedBy: req.user.id,
    });
    if (!updatedApplication) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    const versions = await listBoundaryHistory(application.id);
    const latestVersion = versions[versions.length - 1] || null;
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'GIS_BOUNDARY_UPDATED',
      entityType: 'land_application',
      entityId: application.id,
      details: {
        referenceCode: application.reference_code,
        boundaryVersion: latestVersion?.version_number || null,
        boundarySource,
        changeReason,
      },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Boundary updated and the previous version preserved.',
      application: updatedApplication,
      boundaryVersion: latestVersion,
    });
  } catch (error) {
    return handleGisError(
      res,
      error,
      'Failed to update application boundary.',
      'GIS boundary update error:'
    );
  }
}

export async function validateApplicationParcel(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    if (!['AWAITING_GIS_REVIEW', 'GIS_VALIDATED'].includes(application.status)) {
      return res.status(409).json({
        error: `Application must complete surveyor review and await GIS validation (current status: ${application.status}).`,
      });
    }

    const result = await validateAndRegisterParcel({
      application,
      surveyorId: req.user.id,
      actorRole: req.user.roleCode,
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: result.passed ? 'GIS_VALIDATION_PASSED' : 'GIS_VALIDATION_FAILED',
      entityType: 'land_application',
      entityId: application.id,
      details: {
        referenceCode: application.reference_code,
        passed: result.passed,
        status: result.status,
        validationTimeMs: result.validationTimeMs,
        validation: result.validation,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/gis/validated',
      eventType: result.passed ? 'GIS_VALIDATION_PASSED' : 'GIS_VALIDATION_FAILED',
      userId: application.applicant_id,
      targetRole: result.passed ? 'LAND_ADMIN' : 'CITIZEN',
      data: {
        applicationId: application.id,
        referenceCode: application.reference_code,
        parcelCode: result.parcel?.parcel_code || null,
        passed: result.passed,
        status: result.status,
        validationTimeMs: result.validationTimeMs,
      },
    });

    return res.status(result.passed ? 200 : 422).json({
      message: result.passed
        ? `Spatial validation passed (${result.parcel.parcel_code}).`
        : 'Spatial validation rejected due to invalid geometry or parcel overlap.',
      ...result,
    });
  } catch (error) {
    return handleGisError(
      res,
      error,
      'Failed to execute spatial validation.',
      'GIS validation error:'
    );
  }
}
