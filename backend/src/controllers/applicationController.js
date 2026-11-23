import {
  ALLOWED_OWNERSHIP_TYPES,
  createApplication,
  findApplicationById,
  listApplicationStatusHistory,
  listApplicationsForUser,
  listDocumentsByApplicationId,
  normalizeBoundarySource,
  normalizeGeoJsonPolygon,
  transitionApplicationStatus,
  uploadAndAddSupportingDocument,
} from '../models/applicationModel.js';
import { resolveApplicationReviewTransition } from '../services/applicationWorkflow.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';
import {
  isLocationReferenceSchemaMissing,
  LOCATION_REFERENCE_MIGRATION_ERROR,
  validateLocationSelection,
} from '../models/locationModel.js';

const ALLOWED_DOCUMENT_TYPES = [
  'DEED_OF_CONVEYANCE',
  'SURVEY_PLAN',
  'COMMUNITY_LETTER',
  'TAX_RECEIPT',
  'ID_DOCUMENT',
];

export async function submitApplication(req, res) {
  try {
    const {
      parcelName,
      locationDescription,
      region,
      declaredAreaSqm,
      ownershipType,
      claimantName,
      claimantNationalId,
      coordinates,
      stateId,
      lgaId,
      communityId,
      boundarySource,
    } = req.body || {};

    if (!parcelName || String(parcelName).trim().length < 3) {
      return res.status(400).json({ error: 'Parcel name must be at least 3 characters.' });
    }
    if (!locationDescription || String(locationDescription).trim().length < 5) {
      return res.status(400).json({ error: 'Location description must be at least 5 characters.' });
    }
    if (!region || String(region).trim().length < 2) {
      return res.status(400).json({ error: 'Region / District is required.' });
    }
    const areaNum = Number(declaredAreaSqm);
    if (!Number.isFinite(areaNum) || areaNum <= 0) {
      return res.status(400).json({ error: 'Declared area (m²) must be greater than zero.' });
    }
    if (!ALLOWED_OWNERSHIP_TYPES.includes(ownershipType)) {
      return res.status(400).json({
        error: `Ownership type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(', ')}.`,
      });
    }
    if (!claimantName || String(claimantName).trim().length < 2) {
      return res.status(400).json({ error: 'Claimant legal name is required.' });
    }
    if (!claimantNationalId || String(claimantNationalId).trim().length < 4) {
      return res.status(400).json({ error: 'Claimant National ID is required.' });
    }

    let coordinatesGeojson;
    try {
      coordinatesGeojson = normalizeGeoJsonPolygon(coordinates);
    } catch (geoErr) {
      return res.status(400).json({ error: geoErr.message });
    }

    let location;
    let normalizedBoundarySource;
    try {
      location = await validateLocationSelection({ stateId, lgaId, communityId });
      normalizedBoundarySource = normalizeBoundarySource(boundarySource);
    } catch (locationErr) {
      if (isLocationReferenceSchemaMissing(locationErr)) {
        return res.status(503).json({
          error: LOCATION_REFERENCE_MIGRATION_ERROR,
          code: 'GIS_REFERENCE_MIGRATION_REQUIRED',
        });
      }
      return res.status(400).json({ error: locationErr.message });
    }

    const application = await createApplication({
      applicantId: req.user.id,
      parcelName,
      locationDescription,
      region,
      declaredAreaSqm: areaNum,
      ownershipType,
      claimantName,
      claimantNationalId,
      coordinatesGeojson,
      ...location,
      boundarySource: normalizedBoundarySource,
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'APPLICATION_SUBMITTED',
      entityType: 'land_application',
      entityId: application.id,
      details: {
        referenceCode: application.reference_code,
        parcelName: application.parcel_name,
        region: application.region,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/applications/submitted',
      eventType: 'APPLICATION_SUBMITTED',
      userId: req.user.id,
      targetRole: 'LAND_ADMIN',
      data: {
        applicationId: application.id,
        referenceCode: application.reference_code,
        parcelName: application.parcel_name,
        region: application.region,
        claimantName: application.claimant_name,
      },
    });

    return res.status(201).json({
      message:
        'Land registration application submitted successfully. Upload supporting documents to proceed to GIS validation.',
      application,
    });
  } catch (error) {
    console.error('Submit application error:', error);
    if (isLocationReferenceSchemaMissing(error)) {
      return res.status(503).json({
        error: 'GIS Phase 4 schema is not installed. Apply migration 013_gis_measurements_and_boundary_history.sql.',
        code: 'GIS_PHASE4_MIGRATION_REQUIRED',
      });
    }
    return res.status(500).json({ error: 'Failed to submit land registration application.' });
  }
}

export async function getApplications(req, res) {
  try {
    const applications = await listApplicationsForUser(req.user);
    return res.json({ applications });
  } catch (error) {
    console.error('List applications error:', error);
    return res.status(500).json({ error: 'Failed to fetch land applications.' });
  }
}

export async function getApplicationDetail(req, res) {
  try {
    const application = await findApplicationById(req.params.id);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    if (req.user.roleCode === 'CITIZEN' && application.applicant_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied. Citizens can only view their own land applications.',
      });
    }

    const [documents, statusHistory] = await Promise.all([
      listDocumentsByApplicationId(application.id),
      listApplicationStatusHistory(application.id),
    ]);
    return res.json({ application, documents, statusHistory });
  } catch (error) {
    console.error('Get application detail error:', error);
    return res.status(500).json({ error: 'Failed to fetch application details.' });
  }
}

export async function reviewApplication(req, res) {
  try {
    const application = await findApplicationById(req.params.id);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    const action = String(req.body?.action || '').trim().toUpperCase();
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) {
      return res.status(400).json({
        error: 'A review reason between 5 and 2,000 characters is required.',
      });
    }

    const transition = resolveApplicationReviewTransition({
      roleCode: req.user.roleCode,
      action,
      currentStatus: application.status,
    });
    if (transition.error) {
      return res.status(transition.statusCode).json({ error: transition.error });
    }

    const updatedApplication = await transitionApplicationStatus({
      applicationId: application.id,
      expectedStatus: application.status,
      nextStatus: transition.nextStatus,
      changedBy: req.user.id,
      actorRole: req.user.roleCode,
      reason,
    });
    if (!updatedApplication) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: `APPLICATION_REVIEW_${action}`,
      entityType: 'land_application',
      entityId: application.id,
      details: {
        referenceCode: application.reference_code,
        fromStatus: application.status,
        toStatus: transition.nextStatus,
        reason,
      },
      ipAddress: req.ip,
    });
    await publishAnaguEvent({
      topic: 'anagu/applications/status-changed',
      eventType: 'APPLICATION_STATUS_CHANGED',
      userId: application.applicant_id,
      targetRole: 'CITIZEN',
      data: {
        applicationId: application.id,
        referenceCode: application.reference_code,
        fromStatus: application.status,
        status: transition.nextStatus,
      },
    });

    const statusHistory = await listApplicationStatusHistory(application.id);
    return res.json({
      message: `Application status updated to ${transition.nextStatus}.`,
      application: updatedApplication,
      statusHistory,
    });
  } catch (error) {
    if (error.statusCode === 409 || error.code === '40001') {
      return res.status(409).json({
        error: error.message || 'Application status changed before review could be saved.',
      });
    }
    console.error('Application review transition error:', error);
    return res.status(500).json({ error: 'Failed to save application review.' });
  }
}

export async function uploadSupportingDocument(req, res) {
  try {
    const application = await findApplicationById(req.params.id);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    if (req.user.roleCode === 'CITIZEN' && application.applicant_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied. You can only upload documents to your own application.',
      });
    }

    const documentType = String(req.body?.documentType || 'DEED_OF_CONVEYANCE').toUpperCase();
    if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({
        error: `Document type must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}.`,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A supporting document file is required.' });
    }

    const document = await uploadAndAddSupportingDocument({
      applicationId: application.id,
      uploadedBy: req.user.id,
      documentType,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      fileSizeBytes: req.file.size,
      buffer: req.file.buffer,
      isTamperedFlag: req.body?.simulateTampered === 'true',
    });
    const sha256Hash = document.sha256_hash;

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'supporting_document',
      entityId: document.id,
      details: {
        applicationId: application.id,
        documentType,
        fileName: document.file_name,
        sha256Hash,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/applications/submitted',
      eventType: 'DOCUMENT_UPLOADED',
      userId: req.user.id,
      targetRole: 'LAND_ADMIN',
      data: {
        applicationId: application.id,
        referenceCode: application.reference_code,
        documentId: document.id,
        documentType,
        fileName: document.file_name,
        sha256Hash,
      },
    });

    return res.status(201).json({
      message: 'Supporting document uploaded and SHA-256 hash recorded.',
      document,
    });
  } catch (error) {
    console.error('Upload document error:', error);
    return res.status(500).json({ error: 'Failed to upload supporting document.' });
  }
}
