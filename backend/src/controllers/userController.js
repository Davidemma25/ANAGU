import {
  createUser,
  findUserById,
  listAllUsers,
  updateUserAdmin,
} from '../models/userModel.js';
import { listAuditLogs, recordAuditLog } from '../services/auditService.js';

export async function getUsers(_req, res) {
  const users = await listAllUsers();
  return res.json({ users });
}

export async function createStaffAccount(req, res) {
  try {
    const {
      fullName,
      email,
      password,
      nationalId,
      phone = '',
      roleCode,
      walletAddress = '',
    } = req.body || {};
    const normalizedRole = String(roleCode || '').trim().toUpperCase();
    if (!['SURVEYOR', 'COMMUNITY_OFFICER', 'REGISTRAR', 'GOVERNOR'].includes(normalizedRole)) {
      return res.status(400).json({
        error: 'Staff role must be SURVEYOR, COMMUNITY_OFFICER, REGISTRAR or GOVERNOR.',
      });
    }
    if (!fullName || !email || !password || !nationalId) {
      return res.status(400).json({
        error: 'Full name, email, password and national ID are required.',
      });
    }

    const user = await createUser({
      fullName,
      email,
      password,
      nationalId,
      phone,
      walletAddress,
      roleCode: normalizedRole,
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'STAFF_ACCOUNT_CREATED',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email, roleCode: normalizedRole },
      ipAddress: req.ip,
    });

    return res.status(201).json({ message: 'Staff account created.', user });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === '23505' || error.code?.startsWith('DUPLICATE')) {
      return res.status(409).json({ error: error.message || 'Email or National ID already exists.' });
    }
    console.error('Create staff account error:', error);
    return res.status(500).json({ error: 'Failed to create staff account.' });
  }
}

export async function updateUserAccess(req, res) {
  try {
    const targetId = Number(req.params.id);
    const existing = await findUserById(targetId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { roleCode, isActive } = req.body || {};
    const updated = await updateUserAdmin(targetId, { roleCode, isActive });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'ADMIN_UPDATED_USER',
      entityType: 'user',
      entityId: targetId,
      details: { roleCode: updated.roleCode, isActive: updated.isActive },
      ipAddress: req.ip,
    });

    return res.json({ message: 'User access updated.', user: updated });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.message?.startsWith('Invalid role code')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to update user access.' });
  }
}

export async function getAuditLogs(req, res) {
  const limit = Math.min(Number(req.query.limit || 100), 250);
  const logs = await listAuditLogs({ limit });
  return res.json({ logs });
}

export async function getDashboardSummary(req, res) {
  try {
    const { env } = await import('../config/env.js');
    const { getPgPool, loadLocalStore } = await import('../config/db.js');
    const { assertNoSupabaseError, getSupabaseClient, isSupabaseActive } = await import(
      '../config/supabase.js'
    );
    const isCitizen = req.user.roleCode === 'CITIZEN';

    if (env.pg.enabled) {
      const pool = getPgPool();

      if (isCitizen) {
        const [myAppsRes, myTitlesRes, listingsRes] = await Promise.all([
          pool.query(
            'SELECT status, COUNT(*)::int AS count FROM land_applications WHERE applicant_id = $1 GROUP BY status',
            [req.user.id]
          ),
          pool.query(
            'SELECT title_status, COUNT(*)::int AS count FROM land_titles WHERE owner_id = $1 GROUP BY title_status',
            [req.user.id]
          ),
          pool.query(
            "SELECT COUNT(*)::int AS count FROM land_listings WHERE listing_status IN ('LISTED', 'ESCROW_FUNDED') AND COALESCE(verification_status, 'VERIFIED') NOT IN ('PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED')"
          ),
        ]);

        const appCounts = Object.fromEntries(myAppsRes.rows.map((r) => [r.status, r.count]));
        const titleCounts = Object.fromEntries(myTitlesRes.rows.map((r) => [r.title_status, r.count]));
        const myApplications = myAppsRes.rows.reduce((sum, r) => sum + r.count, 0);
        const myActiveTitles = titleCounts.ACTIVE || 0;

        return res.json({
          scope: 'USER',
          roleCode: req.user.roleCode,
          metrics: {
            openMarketplaceListings: listingsRes.rows[0].count,
            activeTitles: myActiveTitles,
            totalApplications: myApplications,
            verifiedApplications: (appCounts.VERIFIED || 0) + (appCounts.TITLE_ISSUED || 0),
          },
          pipelineBreakdown: [
            { stage: 'Submitted', count: appCounts.SUBMITTED || 0 },
            { stage: 'GIS Validated', count: appCounts.GIS_VALIDATED || 0 },
            { stage: 'Verified', count: appCounts.VERIFIED || 0 },
            { stage: 'My Titles', count: myActiveTitles },
          ],
        });
      }

      const [
        usersRes,
        appsRes,
        parcelsRes,
        titlesRes,
        listingsRes,
        escrowRes,
        pendingDeedRes,
        recordsRes,
        logsRes,
      ] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM users'),
        pool.query('SELECT status, COUNT(*)::int AS count FROM land_applications GROUP BY status'),
        pool.query('SELECT COUNT(*)::int AS count FROM land_parcels'),
        pool.query('SELECT title_status, COUNT(*)::int AS count FROM land_titles GROUP BY title_status'),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM land_listings WHERE listing_status IN ('LISTED', 'ESCROW_FUNDED') AND COALESCE(verification_status, 'VERIFIED') NOT IN ('PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED')"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM land_listings WHERE listing_status = 'ESCROW_FUNDED'"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM land_listings WHERE verification_status = 'PENDING_ADMIN_APPROVAL'"
        ),
        pool.query('SELECT COUNT(*)::int AS count FROM ownership_records'),
        pool.query('SELECT COUNT(*)::int AS count FROM audit_logs'),
      ]);

      const appCounts = Object.fromEntries(appsRes.rows.map((r) => [r.status, r.count]));
      const titleCounts = Object.fromEntries(titlesRes.rows.map((r) => [r.title_status, r.count]));
      const totalApplications = appsRes.rows.reduce((sum, r) => sum + r.count, 0);

      return res.json({
        scope: 'ADMIN',
        roleCode: req.user.roleCode,
        metrics: {
          totalUsers: usersRes.rows[0].count,
          totalApplications,
          totalParcels: parcelsRes.rows[0].count,
          activeTitles: titleCounts.ACTIVE || 0,
          revokedTitles: titleCounts.REVOKED || 0,
          openMarketplaceListings: listingsRes.rows[0].count,
          sampleOwnershipRecords: recordsRes.rows[0].count,
          auditEvents: logsRes.rows[0].count,
        },
        queues: {
          awaitingGis: (appCounts.SUBMITTED || 0) + (appCounts.GIS_REJECTED || 0),
          awaitingOracle: appCounts.GIS_VALIDATED || 0,
          awaitingDeedReview: pendingDeedRes.rows[0].count,
          awaitingMint: appCounts.VERIFIED || 0,
          awaitingEscrowSettlement: escrowRes.rows[0].count,
        },
        pipelineBreakdown: [
          { stage: 'Submitted', count: appCounts.SUBMITTED || 0 },
          { stage: 'GIS Validated', count: appCounts.GIS_VALIDATED || 0 },
          { stage: 'Verified', count: appCounts.VERIFIED || 0 },
          { stage: 'Issued Titles', count: titleCounts.ACTIVE || 0 },
          { stage: 'Revoked', count: titleCounts.REVOKED || 0 },
        ],
      });
    }

    if (isSupabaseActive()) {
      const sb = getSupabaseClient();
      const countStatus = (list, field, value) =>
        list.filter((item) => item[field] === value).length;

      if (isCitizen) {
        const [myAppsRes, myTitlesRes, listingsRes] = await Promise.all([
          sb.from('land_applications').select('status').eq('applicant_id', req.user.id),
          sb.from('land_titles').select('title_status').eq('owner_id', req.user.id),
          sb
            .from('land_listings')
            .select('listing_status, verification_status')
            .in('listing_status', ['LISTED', 'ESCROW_FUNDED']),
        ]);
        assertNoSupabaseError(myAppsRes.error, 'Dashboard my apps');
        assertNoSupabaseError(myTitlesRes.error, 'Dashboard my titles');
        assertNoSupabaseError(listingsRes.error, 'Dashboard listings');

        const myApps = myAppsRes.data || [];
        const myTitles = myTitlesRes.data || [];
        const openListings = (listingsRes.data || []).filter(
          (l) =>
            !['PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED'].includes(
              String(l.verification_status || '').toUpperCase()
            )
        ).length;
        const myActiveTitles = countStatus(myTitles, 'title_status', 'ACTIVE');
        const myVerified =
          countStatus(myApps, 'status', 'VERIFIED') + countStatus(myApps, 'status', 'TITLE_ISSUED');

        return res.json({
          scope: 'USER',
          roleCode: req.user.roleCode,
          metrics: {
            openMarketplaceListings: openListings,
            activeTitles: myActiveTitles,
            totalApplications: myApps.length,
            verifiedApplications: myVerified,
          },
          pipelineBreakdown: [
            { stage: 'Submitted', count: countStatus(myApps, 'status', 'SUBMITTED') },
            { stage: 'GIS Validated', count: countStatus(myApps, 'status', 'GIS_VALIDATED') },
            { stage: 'Verified', count: countStatus(myApps, 'status', 'VERIFIED') },
            { stage: 'My Titles', count: myActiveTitles },
          ],
        });
      }

      const [usersRes, appsRes, parcelsRes, titlesRes, listingsRes, recordsRes, logsRes] =
        await Promise.all([
          sb.from('users').select('id', { count: 'exact', head: true }),
          sb.from('land_applications').select('status'),
          sb.from('land_parcels').select('id', { count: 'exact', head: true }),
          sb.from('land_titles').select('title_status'),
          sb.from('land_listings').select('listing_status, verification_status'),
          sb.from('ownership_records').select('id', { count: 'exact', head: true }),
          sb.from('audit_logs').select('id', { count: 'exact', head: true }),
        ]);
      assertNoSupabaseError(usersRes.error, 'Dashboard users count');
      assertNoSupabaseError(appsRes.error, 'Dashboard apps');
      assertNoSupabaseError(parcelsRes.error, 'Dashboard parcels count');
      assertNoSupabaseError(titlesRes.error, 'Dashboard titles');
      assertNoSupabaseError(listingsRes.error, 'Dashboard listings');
      assertNoSupabaseError(recordsRes.error, 'Dashboard ownership records count');
      assertNoSupabaseError(logsRes.error, 'Dashboard audit logs count');

      const apps = appsRes.data || [];
      const titles = titlesRes.data || [];
      const listings = listingsRes.data || [];

      return res.json({
        scope: 'ADMIN',
        roleCode: req.user.roleCode,
        metrics: {
          totalUsers: usersRes.count || 0,
          totalApplications: apps.length,
          totalParcels: parcelsRes.count || 0,
          activeTitles: countStatus(titles, 'title_status', 'ACTIVE'),
          revokedTitles: countStatus(titles, 'title_status', 'REVOKED'),
          openMarketplaceListings: listings.filter(
            (l) =>
              ['LISTED', 'ESCROW_FUNDED'].includes(l.listing_status) &&
              !['PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED'].includes(
                String(l.verification_status || '').toUpperCase()
              )
          ).length,
          sampleOwnershipRecords: recordsRes.count || 0,
          auditEvents: logsRes.count || 0,
        },
        queues: {
          awaitingGis:
            countStatus(apps, 'status', 'SUBMITTED') + countStatus(apps, 'status', 'GIS_REJECTED'),
          awaitingOracle: countStatus(apps, 'status', 'GIS_VALIDATED'),
          awaitingDeedReview: countStatus(
            listings,
            'verification_status',
            'PENDING_ADMIN_APPROVAL'
          ),
          awaitingMint: countStatus(apps, 'status', 'VERIFIED'),
          awaitingEscrowSettlement: countStatus(listings, 'listing_status', 'ESCROW_FUNDED'),
        },
        pipelineBreakdown: [
          { stage: 'Submitted', count: countStatus(apps, 'status', 'SUBMITTED') },
          { stage: 'GIS Validated', count: countStatus(apps, 'status', 'GIS_VALIDATED') },
          { stage: 'Verified', count: countStatus(apps, 'status', 'VERIFIED') },
          { stage: 'Issued Titles', count: countStatus(titles, 'title_status', 'ACTIVE') },
          { stage: 'Revoked', count: countStatus(titles, 'title_status', 'REVOKED') },
        ],
      });
    }

    const store = loadLocalStore();
    const apps = store.tables.land_applications || [];
    const titles = store.tables.land_titles || [];
    const listings = store.tables.land_listings || [];
    const countStatus = (list, field, value) => list.filter((item) => item[field] === value).length;

    if (isCitizen) {
      const myApps = apps.filter((a) => Number(a.applicant_id) === Number(req.user.id));
      const myTitles = titles.filter((t) => Number(t.owner_id) === Number(req.user.id));
      const myActiveTitles = countStatus(myTitles, 'title_status', 'ACTIVE');
      const myVerified =
        countStatus(myApps, 'status', 'VERIFIED') + countStatus(myApps, 'status', 'TITLE_ISSUED');

      return res.json({
        scope: 'USER',
        roleCode: req.user.roleCode,
        metrics: {
          openMarketplaceListings: listings.filter(
            (l) =>
              ['LISTED', 'ESCROW_FUNDED'].includes(l.listing_status) &&
              !['PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED'].includes(
                String(l.verification_status || '').toUpperCase()
              )
          ).length,
          activeTitles: myActiveTitles,
          totalApplications: myApps.length,
          verifiedApplications: myVerified,
        },
        pipelineBreakdown: [
          { stage: 'Submitted', count: countStatus(myApps, 'status', 'SUBMITTED') },
          { stage: 'GIS Validated', count: countStatus(myApps, 'status', 'GIS_VALIDATED') },
          { stage: 'Verified', count: countStatus(myApps, 'status', 'VERIFIED') },
          { stage: 'My Titles', count: myActiveTitles },
        ],
      });
    }

    return res.json({
      scope: 'ADMIN',
      roleCode: req.user.roleCode,
      metrics: {
        totalUsers: (store.tables.users || []).length,
        totalApplications: apps.length,
        totalParcels: (store.tables.land_parcels || []).length,
        activeTitles: countStatus(titles, 'title_status', 'ACTIVE'),
        revokedTitles: countStatus(titles, 'title_status', 'REVOKED'),
        openMarketplaceListings: listings.filter(
          (l) =>
            ['LISTED', 'ESCROW_FUNDED'].includes(l.listing_status) &&
            !['PENDING_ADMIN_APPROVAL', 'ADMIN_REJECTED'].includes(
              String(l.verification_status || '').toUpperCase()
            )
        ).length,
        sampleOwnershipRecords: (store.tables.ownership_records || []).length,
        auditEvents: (store.tables.audit_logs || []).length,
      },
      queues: {
        awaitingGis:
          countStatus(apps, 'status', 'SUBMITTED') + countStatus(apps, 'status', 'GIS_REJECTED'),
        awaitingOracle: countStatus(apps, 'status', 'GIS_VALIDATED'),
        awaitingDeedReview: countStatus(listings, 'verification_status', 'PENDING_ADMIN_APPROVAL'),
        awaitingMint: countStatus(apps, 'status', 'VERIFIED'),
        awaitingEscrowSettlement: countStatus(listings, 'listing_status', 'ESCROW_FUNDED'),
      },
      pipelineBreakdown: [
        { stage: 'Submitted', count: countStatus(apps, 'status', 'SUBMITTED') },
        { stage: 'GIS Validated', count: countStatus(apps, 'status', 'GIS_VALIDATED') },
        { stage: 'Verified', count: countStatus(apps, 'status', 'VERIFIED') },
        { stage: 'Issued Titles', count: countStatus(titles, 'title_status', 'ACTIVE') },
        { stage: 'Revoked', count: countStatus(titles, 'title_status', 'REVOKED') },
      ],
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return res.status(500).json({ error: 'Unable to load dashboard metrics.' });
  }
}
