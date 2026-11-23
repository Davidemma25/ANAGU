import {
  ALLOWED_REVOCATION_GROUNDS,
  executeStatutoryRevocationRecord,
  listRevocationRecords,
} from '../models/revocationModel.js';
import {
  findTitleById,
  listTitles,
  recordBlockchainTransaction,
} from '../models/titleModel.js';
import { revokeTitleOnChain } from '../services/blockchainService.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';

export async function getRevocations(_req, res) {
  try {
    const [revocations, titles] = await Promise.all([listRevocationRecords(), listTitles()]);
    const activeTitles = titles.filter((t) => t.title_status === 'ACTIVE');
    return res.json({ revocations, activeTitles, allTitles: titles });
  } catch (error) {
    console.error('Get revocations error:', error);
    return res.status(500).json({ error: 'Failed to load statutory revocation records.' });
  }
}

export async function revokeLandTitle(req, res) {
  try {
    const titleId = req.params.titleId || req.params.id;
    const title = await findTitleById(titleId);
    if (!title) {
      return res.status(404).json({ error: 'Digital land title not found.' });
    }

    if (title.title_status === 'REVOKED') {
      return res.status(409).json({
        error: `Title ${title.title_number} has already been statutorily revoked.`,
      });
    }

    const { ground, reason } = req.body || {};
    if (!ALLOWED_REVOCATION_GROUNDS.includes(ground)) {
      return res.status(400).json({
        error: `Revocation ground must be one of: ${ALLOWED_REVOCATION_GROUNDS.join(', ')}.`,
      });
    }
    if (!reason || String(reason).trim().length < 10) {
      return res.status(400).json({
        error: 'A detailed statutory revocation reason of at least 10 characters is required.',
      });
    }

    const chainResult = await revokeTitleOnChain({
      tokenId: title.token_id,
      ground,
      reason: String(reason).trim(),
    });

    const { revocation, blockedListingCount } = await executeStatutoryRevocationRecord({
      titleId: title.id,
      governorId: req.user.id,
      ground,
      reason,
      txHash: chainResult.txHash,
    });

    const transaction = await recordBlockchainTransaction({
      titleId: title.id,
      applicationId: title.application_id,
      txType: 'REVOKE_TITLE',
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      fromAddress: chainResult.fromAddress,
      toAddress: title.contract_address,
      gasUsed: chainResult.gasUsed,
      latencyMs: chainResult.latencyMs,
      status: 'CONFIRMED',
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'STATUTORY_TITLE_REVOKED',
      entityType: 'land_title',
      entityId: title.id,
      details: {
        titleNumber: title.title_number,
        tokenId: title.token_id,
        ground,
        reason: String(reason).trim(),
        blockedListingCount,
        txHash: chainResult.txHash,
      },
      ipAddress: req.ip,
    });

    const updatedTitle = await findTitleById(title.id);

    await publishAnaguEvent({
      topic: 'anagu/titles/revoked',
      eventType: 'STATUTORY_TITLE_REVOKED',
      userId: title.owner_id,
      targetRole: 'ALL',
      data: {
        titleId: title.id,
        titleNumber: title.title_number,
        tokenId: title.token_id,
        ground,
        blockedListingCount,
        txHash: chainResult.txHash,
      },
    });

    return res.status(201).json({
      message: `Title ${title.title_number} statutorily revoked under ${ground}. Original record preserved; reuse and transfers permanently blocked.`,
      revocation,
      title: updatedTitle,
      blockedListingCount,
      transaction,
    });
  } catch (error) {
    console.error('Revoke land title error:', error);
    return res.status(500).json({ error: error.message || 'Failed to revoke land title.' });
  }
}
