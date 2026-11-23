import { isAddress } from 'ethers';
import { findApplicationById } from '../models/applicationModel.js';
import { findUserById } from '../models/userModel.js';
import {
  createTitleRecord,
  findTitleById,
  listBlockchainTransactions,
  listIssuanceQueue,
  listTitles,
  recordBlockchainTransaction,
} from '../models/titleModel.js';
import {
  getContractInfo,
  mintTitleOnChain,
  verifyDirectTransferBlockedOnChain,
} from '../services/blockchainService.js';
import { recordAuditLog } from '../services/auditService.js';
import { publishAnaguEvent } from '../mqtt/mqttClient.js';
import { loadLocalStore, getPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

async function findParcelForApplication(applicationId) {
  if (env.pg.enabled) {
    const pool = getPgPool();
    const res = await pool.query('SELECT * FROM land_parcels WHERE application_id = $1 LIMIT 1', [
      applicationId,
    ]);
    return res.rows[0] || null;
  }
  if (isSupabaseActive()) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('land_parcels')
      .select('*')
      .eq('application_id', Number(applicationId))
      .maybeSingle();
    assertNoSupabaseError(error, 'Find parcel for application');
    return data || null;
  }
  const store = loadLocalStore();
  return (store.tables.land_parcels || []).find((p) => p.application_id === Number(applicationId)) || null;
}

export async function getContractMetadata(_req, res) {
  try {
    const info = await getContractInfo();
    return res.json(info);
  } catch (error) {
    console.error('Contract metadata error:', error);
    return res.status(500).json({ error: 'Failed to initialize AnaguLandTitle smart contract.' });
  }
}

export async function getTitlesAndQueue(_req, res) {
  try {
    const [titles, issuanceQueue, transactions] = await Promise.all([
      listTitles(),
      listIssuanceQueue(),
      listBlockchainTransactions(40),
    ]);
    return res.json({ titles, issuanceQueue, transactions });
  } catch (error) {
    console.error('List titles error:', error);
    return res.status(500).json({ error: 'Failed to load NFT land titles.' });
  }
}

export async function mintLandTitleNft(req, res) {
  try {
    const application = await findApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Land application not found.' });
    }

    if (application.status !== 'APPROVED') {
      return res.status(409).json({
        error: `Application must pass GIS validation, ownership verification, and registrar legal approval before NFT title issuance (current status: ${application.status}).`,
      });
    }

    const parcel = await findParcelForApplication(application.id);
    if (!parcel) {
      return res.status(409).json({ error: 'Validated parcel record not found for application.' });
    }

    const applicant = await findUserById(application.applicant_id);
    const recipientWallet = (req.body?.recipientWallet || applicant?.wallet_address || '').trim();
    if (!isAddress(recipientWallet)) {
      return res.status(400).json({
        error:
          'Applicant must have a valid Polygon/EVM wallet address linked before minting an NFT land title.',
      });
    }

    const metadataPayload = {
      name: `ANAGU Title · ${parcel.parcel_code}`,
      description: `Verified digital land title for ${application.parcel_name} (${application.region}).`,
      parcelCode: parcel.parcel_code,
      applicationRef: application.reference_code,
      areaSqm: parcel.area_sqm,
      ownershipType: application.ownership_type,
    };
    const metadataUri = `data:application/json;base64,${Buffer.from(
      JSON.stringify(metadataPayload)
    ).toString('base64')}`;

    const chainResult = await mintTitleOnChain({
      toWallet: recipientWallet,
      parcelCode: parcel.parcel_code,
      applicationRef: application.reference_code,
      metadataUri,
    });

    const title = await createTitleRecord({
      applicationId: application.id,
      parcelId: parcel.id,
      ownerId: application.applicant_id,
      tokenId: chainResult.tokenId,
      contractAddress: chainResult.contractAddress,
      metadataUri,
      issuedBy: req.user.id,
      actorRole: req.user.roleCode,
    });

    const txRecord = await recordBlockchainTransaction({
      titleId: title.id,
      applicationId: application.id,
      txType: 'MINT_TITLE',
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      fromAddress: chainResult.fromAddress,
      toAddress: chainResult.toAddress,
      gasUsed: chainResult.gasUsed,
      latencyMs: chainResult.latencyMs,
      status: 'CONFIRMED',
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'NFT_TITLE_ISSUED',
      entityType: 'land_title',
      entityId: title.id,
      details: {
        titleNumber: title.title_number,
        tokenId: title.token_id,
        parcelCode: parcel.parcel_code,
        txHash: chainResult.txHash,
        latencyMs: chainResult.latencyMs,
      },
      ipAddress: req.ip,
    });

    await publishAnaguEvent({
      topic: 'anagu/titles/issued',
      eventType: 'NFT_TITLE_ISSUED',
      userId: application.applicant_id,
      targetRole: 'CITIZEN',
      data: {
        titleId: title.id,
        titleNumber: title.title_number,
        tokenId: title.token_id,
        parcelCode: parcel.parcel_code,
        txHash: chainResult.txHash,
      },
    });

    return res.status(201).json({
      message: `ERC-721 NFT Title ${title.title_number} (Token #${title.token_id}) minted successfully.`,
      title,
      transaction: txRecord,
    });
  } catch (error) {
    console.error('Mint title error:', error);
    return res.status(500).json({ error: error.message || 'Failed to mint NFT land title.' });
  }
}

export async function testDirectTransferBlock(req, res) {
  try {
    const title = await findTitleById(req.params.id);
    if (!title) {
      return res.status(404).json({ error: 'Land title not found.' });
    }

    const toWallet = isAddress(req.body?.toWallet || '')
      ? req.body.toWallet
      : '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

    const check = await verifyDirectTransferBlockedOnChain({
      tokenId: title.token_id,
      fromWallet: title.owner_wallet,
      toWallet,
    });

    await recordBlockchainTransaction({
      titleId: title.id,
      applicationId: title.application_id,
      txType: 'TRANSFER_BLOCKED',
      txHash: check.syntheticTxHash,
      fromAddress: check.fromAddress,
      toAddress: check.toAddress,
      latencyMs: check.latencyMs,
      status: 'REVERTED',
      errorMessage: check.reason,
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'DIRECT_TRANSFER_BLOCKED',
      entityType: 'land_title',
      entityId: title.id,
      details: { tokenId: title.token_id, reason: check.reason },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'On-chain registry guard verified: ordinary owner-to-owner transfer was blocked.',
      ...check,
    });
  } catch (error) {
    console.error('Direct transfer block test error:', error);
    return res.status(500).json({ error: 'Failed to test direct transfer block.' });
  }
}
