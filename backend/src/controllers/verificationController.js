import {
  findApplicationById,
  listDocumentsByApplicationId,
  normalizeGeoJsonPolygon,
} from '../models/applicationModel.js';
import {
  findApplicationVerificationContext,
  findListingByApplicationId,
  updateListingAdminRejected,
} from '../models/titleModel.js';
import { resolveAdminDeedApprovalOutcome } from '../services/marketplaceService.js';
import { readSupportingDocumentFile } from '../services/documentStorage.js';
import {
  publishApplicationToCheckLands,
  publishListingOnAdminApproval,
} from './marketplaceController.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';
import {
  ALLOWED_VERIFICATION_DECISIONS,
  createSampleOwnershipRecord,
  findSupportingDocumentById,
  listOwnershipRecords,
  listVerificationHistory,
  listVerificationQueue,
  runOracleEvaluation,
  submitVerificationDecision,
} from '../services/oracleService.js';

export async function getVerificationQueue(_req, res) {
  try {
    const queue = await listVerificationQueue();
    return res.json({ queue });
  } catch (error) {
    console.error('Verification queue error:', error);
    return res.status(500).json({ error: 'Failed to load verification queue.' });
  }
}

export async function getSampleOwnershipRecords(_req, res) {
  try {
    const records = await listOwnershipRecords();
    return res.json({
      disclaimer:
        'Sample academic prototype institutional & community records only — not connected to live government registries.',
      records,
    });
  } catch (error) {
    console.error('Ownership records error:', error);
    return res.status(500).json({ error: 'Failed to load sample ownership records.' });
  }
}

export async function addSampleOwnershipRecord(req, res) {
  try {
    const {
      recordSource,
      sourceReference,
      parcelCode,
      registeredOwnerName,
      ownerNationalId,
      coordinates,
      claimStatus = 'ACTIVE_RECORD',
      notes = '',
    } = req.body || {};

    if (!recordSource || !sourceReference || !registeredOwnerName || !ownerNationalId) {
      return res.status(400).json({
        error:
          'recordSource, sourceReference, registeredOwnerName, and ownerNationalId are required.',
      });
    }

    let boundaryGeojson = null;
    if (coordinates) {
      try {
        boundaryGeojson = normalizeGeoJsonPolygon(coordinates);
      } catch (geoErr) {
        return res.status(400).json({ error: geoErr.message });
      }
    }

    const record = await createSampleOwnershipRecord({
      recordSource,
      sourceReference,
      parcelCode,
      registeredOwnerName,
      ownerNationalId,
      boundaryGeojson,
      claimStatus,
      notes,
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'SAMPLE_OWNERSHIP_RECORD_CREATED',
      entityType: 'ownership_record',
      entityId: record.id,
      details: {
        sourceReference: record.source_reference,
        claimStatus: record.claim_status,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message: 'Sample institutional/community record added.',
      record,
    });
  } catch (error) {
    if (error.code === 'DUPLICATE_SOURCE_REF' || error.code === '23505') {
      return res.status(409).json({ error: error.message || 'Duplicate source reference.' });
    }
    if (error.message?.startsWith('claimStatus')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Add ownership record error:', error);
    return res.status(500).json({ error: 'Failed to create sample ownership record.' });
  }
}

export async function evaluateApplicationClaim(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    const [oracle, history, documents, appCtx, pendingListing] = await Promise.all([
      runOracleEvaluation(application.id),
      listVerificationHistory(application.id),
      listDocumentsByApplicationId(application.id),
      findApplicationVerificationContext(application.id),
      findListingByApplicationId(application.id),
    ]);

    return res.json({
      application,
      oracle,
      history,
      documents,
      parcel: appCtx?.parcel || null,
      pendingListing: pendingListing || null,
    });
  } catch (error) {
    console.error('Oracle evaluate error:', error);
    return res.status(500).json({ error: 'Failed to run Community Ownership Verification Oracle.' });
  }
}

export async function downloadVerificationDocument(req, res) {
  try {
    const doc = await findSupportingDocumentById(req.params.documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Supporting deed document not found.' });
    }

    const fileBuffer = await readSupportingDocumentFile(doc);
    if (!fileBuffer) {
      return res.status(404).json({
        error: 'Supporting deed file is unavailable in document storage.',
      });
    }

    const safeFileName = String(doc.file_name || `deed-${doc.id}`).replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    return res.send(fileBuffer);
  } catch (error) {
    console.error('Download verification document error:', error);
    return res.status(500).json({ error: 'Failed to read supporting deed document.' });
  }
}

export async function recordVerificationDecision(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    if (!['GIS_VALIDATED', 'VERIFIED', 'VERIFICATION_REJECTED'].includes(application.status)) {
      return res.status(409).json({
        error: `Application must pass surveyor review and GIS validation before ownership review (current status: ${application.status}).`,
      });
    }

    const { decision, remarks } = req.body || {};
    if (!ALLOWED_VERIFICATION_DECISIONS.includes(decision)) {
      return res.status(400).json({
        error: `Decision must be one of: ${ALLOWED_VERIFICATION_DECISIONS.join(', ')}.`,
      });
    }
    if (!remarks || String(remarks).trim().length < 5) {
      return res.status(400).json({
        error: 'Verification remarks must be at least 5 characters.',
      });
    }

    const result = await submitVerificationDecision({
      applicationId: application.id,
      officerId: req.user.id,
      actorRole: req.user.roleCode,
      decision,
      remarks,
    });

    const pendingListing = await findListingByApplicationId(application.id);
    const hasPendingCheckLandsListing = Boolean(
      pendingListing && pendingListing.verification_status === 'PENDING_ADMIN_APPROVAL'
    );
    const outcome = resolveAdminDeedApprovalOutcome({
      decision,
      hasPendingListing: hasPendingCheckLandsListing,
      oracleConflictDetected: result.oracle.conflictDetected,
    });

    let publishedListing = null;
    if (outcome.publishToCheckLands && pendingListing) {
      publishedListing = await publishListingOnAdminApproval({
        listing: pendingListing,
        adminId: req.user.id,
        actorRole: req.user.roleCode,
      });
      const updatedApp = await findApplicationById(application.id);
      if (updatedApp) {
        result.application = updatedApp;
      }
    } else if (outcome.rejectPendingListing && pendingListing) {
      await updateListingAdminRejected(pendingListing.id);
    }
    const isListingPublished =
      publishedListing?.verification_status === 'VERIFIED' &&
      publishedListing?.listing_status === 'LISTED';

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action:
        decision === 'APPROVED'
          ? 'COMMUNITY_VERIFICATION_APPROVED'
          : decision === 'FLAGGED_CONFLICT'
          ? 'COMMUNITY_VERIFICATION_FLAGGED'
          : 'COMMUNITY_VERIFICATION_REJECTED',
      entityType: 'land_application',
      entityId: application.id,
      details: {
        referenceCode: application.reference_code,
        decision,
        oracleMatchScore: result.oracle.oracleMatchScore,
        conflictDetected: result.oracle.conflictDetected,
        matchedSourceReference: result.oracle.matchedRecord?.sourceReference || null,
        publishedToCheckLands: isListingPublished,
        listingId: publishedListing?.id || pendingListing?.id || null,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/verification/completed',
      eventType:
        decision === 'APPROVED'
          ? 'COMMUNITY_VERIFICATION_APPROVED'
          : decision === 'FLAGGED_CONFLICT'
          ? 'COMMUNITY_VERIFICATION_FLAGGED'
          : 'COMMUNITY_VERIFICATION_REJECTED',
      userId: application.applicant_id,
      targetRole: decision === 'APPROVED' ? 'ALL' : 'CITIZEN',
      data: {
        applicationId: application.id,
        referenceCode: application.reference_code,
        decision,
        oracleMatchScore: result.oracle.oracleMatchScore,
        conflictDetected: result.oracle.conflictDetected,
        publishedToCheckLands: isListingPublished,
      },
    });

    const responseMessage = isListingPublished
      ? `Land deed verified, ERC-721 title issued, and ${application.parcel_name} is now live on Check Lands.`
      : decision === 'APPROVED'
      ? `Community verification recorded as ${decision}. Registrar legal approval and title issuance are still required before Check Lands publication.`
      : `Community verification recorded as ${decision}; no title was issued and the application was not published on Check Lands.`;

    return res.status(201).json({
      message: responseMessage,
      ...result,
      publishedListing,
    });
  } catch (error) {
    if (error.code === 'ORACLE_CONFLICT_OVERRIDE_BLOCKED') {
      await recordAuditLog({
        actorId: req.user.id,
        actorRole: req.user.roleCode,
        action: 'ORACLE_COLLUSION_RISK_BLOCKED',
        entityType: 'land_application',
        entityId: req.params.applicationId,
        details: {
          attemptedDecision: req.body?.decision,
          conflicts: error.oracle?.conflicts || [],
        },
        ipAddress: req.ip,
      });
      await publishAnaguEvent({
        topic: 'anagu/verification/completed',
        eventType: 'ORACLE_COLLUSION_RISK_BLOCKED',
        userId: req.user.id,
        targetRole: 'LAND_ADMIN',
        data: {
          applicationId: Number(req.params.applicationId),
          attemptedDecision: req.body?.decision,
          conflictCount: error.oracle?.conflicts?.length || 1,
        },
      });
      return res.status(409).json({
        error: error.message,
        code: error.code,
        oracle: error.oracle,
      });
    }
    console.error('Record verification error:', error);
    return res.status(500).json({ error: 'Failed to record verification decision.' });
  }
}

export async function getApplicationVerificationHistory(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }
    if (req.user.roleCode === 'CITIZEN' && application.applicant_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied. Citizens can only view verification history for their own applications.',
      });
    }

    const history = await listVerificationHistory(application.id);
    return res.json({ history });
  } catch (error) {
    console.error('Verification history error:', error);
    return res.status(500).json({ error: 'Failed to load verification history.' });
  }
}

export async function quickPublishToCheckLands(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }
    if (application.status === 'REVOKED') {
      return res.status(409).json({
        error: 'This parcel was statutorily REVOKED and cannot be verified for Check Lands.',
      });
    }

    if (
      ![
        'GIS_VALIDATED',
        'VERIFICATION_REJECTED',
        'VERIFIED',
        'APPROVED',
        'TITLE_ISSUED',
      ].includes(application.status)
    ) {
      return res.status(409).json({
        error: `Complete surveyor review and GIS validation before ownership verification or marketplace publication (current status: ${application.status}).`,
      });
    }

    let latestApp = await findApplicationById(application.id);
    let oracleResult = null;
    if (['GIS_VALIDATED', 'VERIFICATION_REJECTED'].includes(latestApp.status)) {
      const customRemarks = req.body?.remarks ? String(req.body.remarks).trim() : '';
      const remarks =
        customRemarks.length >= 5
          ? customRemarks
          : 'Verified by Administrator via one-click Check Lands approval.';
      const decisionRes = await submitVerificationDecision({
        applicationId: latestApp.id,
        officerId: req.user.id,
        actorRole: req.user.roleCode,
        decision: 'APPROVED',
        remarks,
      });
      latestApp = decisionRes.application || latestApp;
      oracleResult = decisionRes.oracle || null;
    }

    const publishedListing = await publishApplicationToCheckLands({
      applicationId: latestApp.id,
      adminId: req.user.id,
      priceUsd: req.body?.priceUsd,
    });

    const refreshedApp = (await findApplicationById(latestApp.id)) || latestApp;
    const isListingPublished =
      publishedListing?.verification_status === 'VERIFIED' &&
      publishedListing?.listing_status === 'LISTED';

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'ADMIN_ONE_CLICK_VERIFY_CHECKLANDS',
      entityType: 'land_application',
      entityId: refreshedApp.id,
      details: {
        referenceCode: refreshedApp.reference_code,
        parcelName: refreshedApp.parcel_name,
        listingId: publishedListing?.id || null,
        verificationStatus: publishedListing?.verification_status || null,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/verification/completed',
      eventType: 'COMMUNITY_VERIFICATION_APPROVED',
      userId: refreshedApp.applicant_id,
      targetRole: 'ALL',
      data: {
        applicationId: refreshedApp.id,
        referenceCode: refreshedApp.reference_code,
        decision: 'APPROVED',
        publishedToCheckLands: isListingPublished,
      },
    });

    return res.json({
      message: isListingPublished
        ? `${refreshedApp.parcel_name} is verified and live on Check Lands.`
        : `${refreshedApp.parcel_name} passed ownership verification and is awaiting registrar legal approval and title issuance before Check Lands publication.`,
      application: refreshedApp,
      oracle: oracleResult,
      publishedListing,
    });
  } catch (error) {
    if (error.code === 'ORACLE_CONFLICT_OVERRIDE_BLOCKED') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        oracle: error.oracle,
      });
    }
    console.error('One-click verify for Check Lands error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to verify parcel for Check Lands.',
    });
  }
}
