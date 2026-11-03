import express from 'express';

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import pool from '../config/db.js';

import { authenticate } from '../middleware/auth.js';



const router = express.Router();

router.use(authenticate);



function fail(res, status, message) {

    return res.status(status).json({ success: false, message });

}



function validId(value) {

    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0 ? id : null;

}



async function getActiveMember(memberId) {

    const [rows] = await pool.execute(

        `SELECT id, full_name, email, phone, role, account_status, parent_member_id

     FROM members WHERE id = ? LIMIT 1`,

        [memberId],

    );

    if (!rows.length || rows[0].account_status !== 'active') return null;

    return rows[0];

}



function leadScope(member) {

    if (member.role === 'team_member') {

        return {

            sql: `(l.submitted_by = ? OR l.submitted_by IN (

        SELECT child.id FROM members child

        WHERE child.parent_member_id = ? AND child.role = 'associate'

      ))`,

            params: [Number(member.id), Number(member.id)],

        };

    }

    return { sql: 'l.submitted_by = ?', params: [Number(member.id)] };

}



const leadSelect = `

  SELECT

    l.id, l.lead_code, l.customer_name, l.customer_phone,

    l.customer_email, l.hospital_or_location, l.pickup_location,

    l.destination, l.scheduled_at, l.notes, l.status,

    l.service_amount, l.created_at, l.updated_at, l.submitted_by,

    s.name AS service_name,

    submitter.full_name AS submitted_by_name,

    submitter.role AS submitted_by_role,

    c.commission_amount, c.commission_percentage,

    c.status AS commission_status

  FROM leads l

  LEFT JOIN service_types s ON s.id = l.service_type_id

  LEFT JOIN members submitter ON submitter.id = l.submitted_by

  LEFT JOIN commissions c ON c.lead_id = l.id

`;





// GET /api/member/service-types
// Members can only select active services enabled by the admin.
router.get('/service-types', async (req, res) => {
    try {
        const member = await getActiveMember(validId(req.user?.id));
        if (!member || !['team_member', 'associate'].includes(member.role)) {
            return fail(res, 403, 'This account cannot create leads.');
        }

        const [services] = await pool.execute(
            `SELECT id, name, description
             FROM service_types
             WHERE is_active = 1
             ORDER BY name ASC, id ASC`
        );

        return res.json({
            success: true,
            count: services.length,
            data: services.map((service) => ({
                id: Number(service.id),
                name: service.name,
                description: service.description || null,
            })),
        });
    } catch (error) {
        console.error('Member service types failed:', error.message);
        return fail(res, 500, 'Unable to load available services.');
    }
});

function normalizeScheduledAt(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return undefined;

    const raw = value.trim().replace('T', ' ');
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return undefined;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        hour > 23 || minute > 59 || second > 59
    ) return undefined;

    return `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}:${secondText}`;
}

// POST /api/member/leads
// A lead is always owned by the authenticated member, never by a submitted ID.
// New leads become visible in the Admin Dashboard because both use the same table.
router.post('/leads', async (req, res) => {
    try {
        const member = await getActiveMember(validId(req.user?.id));
        if (!member || !['team_member', 'associate'].includes(member.role)) {
            return fail(res, 403, 'This account cannot create leads.');
        }

        const body = req.body || {};
        const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
        const customerPhone = typeof body.customer_phone === 'string' ? body.customer_phone.trim() : '';
        const customerEmail = typeof body.customer_email === 'string' ? body.customer_email.trim().toLowerCase() : '';
        const serviceTypeId = Number(body.service_type_id);
        const hospitalOrLocation = typeof body.hospital_or_location === 'string' ? body.hospital_or_location.trim() : '';
        const pickupLocation = typeof body.pickup_location === 'string' ? body.pickup_location.trim() : '';
        const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
        const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
        const scheduledAt = normalizeScheduledAt(body.scheduled_at);

        if (customerName.length < 2 || customerName.length > 150) {
            return fail(res, 400, 'Customer name must be between 2 and 150 characters.');
        }
        if (customerPhone.length < 5 || customerPhone.length > 30) {
            return fail(res, 400, 'Enter a valid customer phone number.');
        }
        if (!Number.isSafeInteger(serviceTypeId) || serviceTypeId <= 0) {
            return fail(res, 400, 'Please select a service type.');
        }
        if (customerEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 255)) {
            return fail(res, 400, 'Enter a valid customer email address.');
        }
        if ([hospitalOrLocation, pickupLocation, destination].some((value) => value.length > 500)) {
            return fail(res, 400, 'Location fields must be 500 characters or fewer.');
        }
        if (notes.length > 5000) return fail(res, 400, 'Notes must be 5,000 characters or fewer.');
        if (scheduledAt === undefined) return fail(res, 400, 'Use YYYY-MM-DD HH:MM for the scheduled date and time.');

        const [services] = await pool.execute(
            'SELECT id FROM service_types WHERE id = ? AND is_active = 1 LIMIT 1',
            [serviceTypeId]
        );
        if (!services.length) return fail(res, 400, 'That service is unavailable. Please choose an active service.');

        const leadCode = `LD-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const [created] = await pool.execute(
            `INSERT INTO leads (
                lead_code, customer_name, customer_phone, customer_email,
                service_type_id, submitted_by, hospital_or_location,
                pickup_location, destination, scheduled_at, notes, service_amount, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'new')`,
            [
                leadCode,
                customerName,
                customerPhone,
                customerEmail || null,
                serviceTypeId,
                Number(member.id),
                hospitalOrLocation || null,
                pickupLocation || null,
                destination || null,
                scheduledAt,
                notes || null,
            ]
        );

        return res.status(201).json({
            success: true,
            message: 'Lead created successfully and sent to the Admin Dashboard.',
            data: {
                id: Number(created.insertId),
                lead_code: leadCode,
                status: 'new',
                submitted_by: Number(member.id),
            },
        });
    } catch (error) {
        console.error('Create member lead failed:', error.message);
        if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A lead with this code already exists. Please try again.');
        return fail(res, 500, 'Unable to create lead. Please try again.');
    }
});


// GET /api/member/dashboard

// Reads the same lead and commission records used by the admin dashboard.

router.get('/dashboard', async (req, res) => {

    try {

        const memberId = validId(req.user?.id);

        if (!memberId) return fail(res, 401, 'Please sign in again.');



        const member = await getActiveMember(memberId);

        if (!member || !['team_member', 'associate'].includes(member.role)) {

            return fail(res, 403, 'This account cannot access the member dashboard.');

        }



        const scope = leadScope(member);

        const [leadTotals] = await pool.execute(

            `SELECT COUNT(*) AS total,

        COALESCE(SUM(l.status = 'completed'), 0) AS completed,

        COALESCE(SUM(l.status = 'cancelled'), 0) AS cancelled,

        COALESCE(SUM(l.status NOT IN ('completed', 'cancelled')), 0) AS in_progress

       FROM leads l WHERE ${scope.sql}`,

            scope.params,

        );



        const [recentLeads] = await pool.execute(

            `${leadSelect} WHERE ${scope.sql}

       ORDER BY l.created_at DESC, l.id DESC LIMIT 5`,

            scope.params,

        );



        // Commission ownership stays with the person who submitted the lead.

        const [commissionRows] = await pool.execute(

            `SELECT COUNT(*) AS total_count,

        COALESCE(SUM(c.status = 'pending'), 0) AS pending_count,

        COALESCE(SUM(c.status = 'approved'), 0) AS approved_count,

        COALESCE(SUM(c.status = 'paid'), 0) AS disbursed_count,

        COALESCE(SUM(c.status = 'rejected'), 0) AS rejected_count,

        COALESCE(SUM(CASE WHEN c.status <> 'rejected' THEN c.commission_amount ELSE 0 END), 0) AS total_amount,

        COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.commission_amount ELSE 0 END), 0) AS pending_amount,

        COALESCE(SUM(CASE WHEN c.status = 'approved' THEN c.commission_amount ELSE 0 END), 0) AS approved_amount,

        COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.commission_amount ELSE 0 END), 0) AS disbursed_amount

       FROM commissions c WHERE c.eligible_member_id = ?`,

            [memberId],

        );



        let associateCount = 0;

        if (member.role === 'team_member') {

            const [associateRows] = await pool.execute(

                `SELECT COUNT(*) AS total FROM members

         WHERE parent_member_id = ? AND role = 'associate'`,

                [memberId],

            );

            associateCount = Number(associateRows[0]?.total ?? 0);

        }



        const leads = leadTotals[0] ?? {};

        const commissions = commissionRows[0] ?? {};



        return res.json({

            success: true,

            data: {

                user: {

                    id: Number(member.id),

                    fullName: member.full_name,

                    email: member.email,

                    role: member.role,

                },

                stats: {

                    totalLeads: Number(leads.total ?? 0),

                    completedLeads: Number(leads.completed ?? 0),

                    cancelledLeads: Number(leads.cancelled ?? 0),

                    inProgressLeads: Number(leads.in_progress ?? 0),

                    associateCount,

                },

                commissions: {

                    totalCount: Number(commissions.total_count ?? 0),

                    pendingCount: Number(commissions.pending_count ?? 0),

                    approvedCount: Number(commissions.approved_count ?? 0),

                    disbursedCount: Number(commissions.disbursed_count ?? 0),

                    rejectedCount: Number(commissions.rejected_count ?? 0),

                    totalAmount: Number(commissions.total_amount ?? 0),

                    pendingAmount: Number(commissions.pending_amount ?? 0),

                    approvedAmount: Number(commissions.approved_amount ?? 0),

                    disbursedAmount: Number(commissions.disbursed_amount ?? 0),

                },

                recentLeads: recentLeads.map((lead) => ({

                    ...lead,

                    id: Number(lead.id),

                    submitted_by: Number(lead.submitted_by),

                    commission_amount: lead.commission_amount === null ? null : Number(lead.commission_amount),

                })),

            },

        });

    } catch (error) {

        console.error('Member dashboard failed:', error.message);

        return fail(res, 500, 'Unable to load your dashboard.');

    }

});



// GET /api/member/leads?status=all|in_progress|completed|cancelled

router.get('/leads', async (req, res) => {

    try {

        const member = await getActiveMember(validId(req.user?.id));

        if (!member || !['team_member', 'associate'].includes(member.role)) {

            return fail(res, 403, 'This account cannot view member leads.');

        }



        const status = String(req.query.status ?? 'all');

        const statusSql = {

            all: '',

            in_progress: ` AND l.status NOT IN ('completed', 'cancelled')`,

            completed: ` AND l.status = 'completed'`,

            cancelled: ` AND l.status = 'cancelled'`,

        };

        if (!(status in statusSql)) return fail(res, 400, 'Unsupported lead status filter.');



        const scope = leadScope(member);

        const [rows] = await pool.execute(

            `${leadSelect} WHERE ${scope.sql}${statusSql[status]}

       ORDER BY l.created_at DESC, l.id DESC LIMIT 250`,

            scope.params,

        );

        return res.json({

            success: true,

            filter: status,

            count: rows.length,

            data: rows.map((lead) => ({

                ...lead,

                id: Number(lead.id),

                submitted_by: Number(lead.submitted_by),

                commission_amount: lead.commission_amount === null ? null : Number(lead.commission_amount),

            })),

        });

    } catch (error) {

        console.error('Member lead list failed:', error.message);

        return fail(res, 500, 'Unable to load your leads.');

    }

});



// GET /api/member/leads/:id — member can only inspect leads inside their scope.

router.get('/leads/:id', async (req, res) => {

    try {

        const leadId = validId(req.params.id);

        if (!leadId) return fail(res, 400, 'Invalid lead ID.');



        const member = await getActiveMember(validId(req.user?.id));

        if (!member || !['team_member', 'associate'].includes(member.role)) {

            return fail(res, 403, 'This account cannot view lead details.');

        }

        const scope = leadScope(member);

        const [rows] = await pool.execute(

            `${leadSelect} WHERE l.id = ? AND ${scope.sql} LIMIT 1`,

            [leadId, ...scope.params],

        );

        if (!rows.length) return fail(res, 404, 'Lead not found in your account.');



        const [history] = await pool.execute(

            `SELECT h.id, h.old_status, h.new_status, h.notes, h.changed_at,

              m.full_name AS changed_by_name

       FROM lead_status_history h

       LEFT JOIN members m ON m.id = h.changed_by

       WHERE h.lead_id = ? ORDER BY h.changed_at DESC, h.id DESC`,

            [leadId],

        );

        const lead = rows[0];

        return res.json({

            success: true,

            data: {

                ...lead,

                id: Number(lead.id),

                submitted_by: Number(lead.submitted_by),

                commission_amount: lead.commission_amount === null ? null : Number(lead.commission_amount),

                statusHistory: history,

            },

        });

    } catch (error) {

        console.error('Member lead detail failed:', error.message);

        return fail(res, 500, 'Unable to load lead details.');

    }

});



// GET /api/member/associates — Team Member only.

router.get('/associates', async (req, res) => {

    try {

        const member = await getActiveMember(validId(req.user?.id));

        if (!member || member.role !== 'team_member') {

            return fail(res, 403, 'Only Team Members can manage Associates.');

        }

        const [rows] = await pool.execute(

            `SELECT m.id, m.full_name, m.email, m.phone, m.account_status,

              m.created_at,

              COUNT(l.id) AS total_leads,

              COALESCE(SUM(l.status = 'completed'), 0) AS completed_leads,

              COALESCE(SUM(l.status = 'cancelled'), 0) AS cancelled_leads,

              COALESCE(SUM(l.status NOT IN ('completed', 'cancelled')), 0) AS in_progress_leads

       FROM members m

       LEFT JOIN leads l ON l.submitted_by = m.id

       WHERE m.parent_member_id = ? AND m.role = 'associate'

       GROUP BY m.id, m.full_name, m.email, m.phone, m.account_status, m.created_at

       ORDER BY m.created_at DESC, m.id DESC`,

            [Number(member.id)],

        );

        return res.json({

            success: true,

            count: rows.length,

            data: rows.map((row) => ({

                ...row,

                id: Number(row.id),

                total_leads: Number(row.total_leads),

            completed_leads: Number(row.completed_leads),

            cancelled_leads: Number(row.cancelled_leads),

                in_progress_leads: Number(row.in_progress_leads),

            })),

        });

    } catch (error) {

    console.error('Member associates list failed:', error.message);

    return fail(res, 500, 'Unable to load your Associates.');

}

});



// GET /api/member/associates/:id/leads — inspect a linked Associate's work.

router.get('/associates/:id/leads', async (req, res) => {

    try {

        const associateId = validId(req.params.id);

        if (!associateId) return fail(res, 400, 'Invalid Associate ID.');

        const member = await getActiveMember(validId(req.user?.id));

        if (!member || member.role !== 'team_member') {

            return fail(res, 403, 'Only Team Members can view Associate activity.');

        }

        const [associates] = await pool.execute(

            `SELECT id, full_name, email, phone, account_status

       FROM members WHERE id = ? AND parent_member_id = ? AND role = 'associate' LIMIT 1`,

            [associateId, Number(member.id)],

        );

        if (!associates.length) return fail(res, 404, 'This Associate is not linked to your account.');



        const [leads] = await pool.execute(

            `${leadSelect} WHERE l.submitted_by = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 250`,

            [associateId],

        );

        return res.json({

            success: true,

            associate: associates[0],

            count: leads.length,

            data: leads.map((lead) => ({

                ...lead,

                id: Number(lead.id),

                submitted_by: Number(lead.submitted_by),

                commission_amount: lead.commission_amount === null ? null : Number(lead.commission_amount),

            })),

        });

    } catch (error) {

        console.error('Associate activity failed:', error.message);

        return fail(res, 500, 'Unable to load Associate activity.');

    }

});



// GET /api/member/commissions — commissions earned by the signed-in member.

// Associates and Team Members can only see commissions they personally earned.

router.get('/commissions', async (req, res) => {

    try {

        const member = await getActiveMember(validId(req.user?.id));

        if (!member || !['team_member', 'associate'].includes(member.role)) {

            return fail(res, 403, 'This account cannot view commission records.');

        }

        const [rows] = await pool.execute(

            `SELECT c.id, c.lead_id, c.eligible_member_id,

              c.commission_amount, c.commission_percentage, c.status,

              c.approved_by, c.approved_at, c.paid_by, c.paid_at,

              c.rejection_reason, c.created_at, c.updated_at,

              l.lead_code, l.customer_name, l.status AS lead_status,

              s.name AS service_name

       FROM commissions c

       INNER JOIN leads l ON l.id = c.lead_id

       LEFT JOIN service_types s ON s.id = l.service_type_id

       WHERE c.eligible_member_id = ?

       ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,

            [Number(member.id)],

        );

        return res.json({

            success: true,

            count: rows.length,

            data: rows.map((row) => ({

                ...row,

                id: Number(row.id),

                lead_id: Number(row.lead_id),

            commission_amount: Number(row.commission_amount),

            commission_percentage: Number(row.commission_percentage),

            })),

        });

    } catch (error) {

    console.error('Member commissions failed:', error.message);

    return fail(res, 500, 'Unable to load commission records.');

}

});



// POST /api/member/associates — create an Associate linked to the signed-in Team Member.

// Requires the Associate's email OTP to have been verified through /api/auth/otp/email/verify.

router.post('/associates', async (req, res) => {

    let connection;

    try {

        const member = await getActiveMember(validId(req.user?.id));

        if (!member || member.role !== 'team_member') {

            return fail(res, 403, 'Only Team Members can add Associates.');

        }



        const { fullName, email, phone = '', password } = req.body ?? {};

        if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 150) {

            return fail(res, 400, 'Enter the Associate’s full name.');

        }

        if (typeof email !== 'string' || email.trim().length > 254) {

            return fail(res, 400, 'Enter a valid email address.');

        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {

            return fail(res, 400, 'Enter a valid email address.');

        }

        if (typeof phone !== 'string') return fail(res, 400, 'Phone must be text.');

        if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {

            return fail(res, 400, 'Password must be between 8 and 72 bytes.');

        }



        const passwordHash = await bcrypt.hash(password, 12);

        connection = await pool.getConnection();

        await connection.beginTransaction();



        const [verified] = await connection.execute(

            `SELECT id FROM contact_otp_challenges

       WHERE channel = 'email' AND destination = ?

         AND verified_at IS NOT NULL AND consumed_at IS NULL

         AND expires_at > NOW()

       ORDER BY id DESC LIMIT 1 FOR UPDATE`,

            [normalizedEmail],

        );

        if (!verified.length) {

            await connection.rollback();

            return fail(res, 403, 'Ask the Associate to verify their email with the OTP first.');

        }



        const [existing] = await connection.execute(

            `SELECT id FROM members WHERE email = ? LIMIT 1`,

            [normalizedEmail],

        );

        if (existing.length) {

            await connection.rollback();

            return fail(res, 409, 'An account with this email already exists.');

        }



        const normalizedPhone = phone.trim() || null;

        const [created] = await connection.execute(

            `INSERT INTO members

        (full_name, email, phone, password_hash, role, account_status, parent_member_id)

       VALUES (?, ?, ?, ?, 'associate', 'active', ?)`,

            [fullName.trim(), normalizedEmail, normalizedPhone, passwordHash, Number(member.id)],

        );



        const [consumed] = await connection.execute(

            `UPDATE contact_otp_challenges SET consumed_at = NOW()

       WHERE id = ? AND channel = 'email' AND destination = ?

         AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at > NOW()`,

            [verified[0].id, normalizedEmail],

        );

        if (consumed.affectedRows !== 1) throw new Error('Verified email OTP could not be consumed.');



        await connection.commit();

        return res.status(201).json({

            success: true,

            message: 'Associate added to your team successfully.',

            data: {

                id: Number(created.insertId),

                fullName: fullName.trim(),

                email: normalizedEmail,

                role: 'associate',

                parent_member_id: Number(member.id),

            },

        });

    } catch (error) {

        if (connection) {

            try { await connection.rollback(); } catch { /* preserve original error */ }

        }

        console.error('Add Associate failed:', error.message);

        if (error.code === 'ER_DUP_ENTRY') {

            return fail(res, 409, 'That email or phone number is already registered.');

        }

        return fail(res, 500, 'Unable to add Associate.');

    } finally {

        connection?.release();

    }

});




// Profile payout details are encrypted at rest with AES-256-GCM.
function profileEncryptionKey() {
    const value = process.env.PROFILE_ENCRYPTION_KEY;
    if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('PROFILE_ENCRYPTION_KEY must be a 32-byte hex key.');
    return Buffer.from(value, 'hex');
}
function encryptPayout(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', profileEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: encrypted.toString('hex') });
}
function decryptPayout(value) {
    if (!value) return {};
    const item = JSON.parse(value);
    const decipher = crypto.createDecipheriv('aes-256-gcm', profileEncryptionKey(), Buffer.from(item.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(item.tag, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data, 'hex')), decipher.final()]).toString('utf8'));
}

function formatDateOnly(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return '';
}

function isValidDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

router.get('/profile', async (req, res) => {
    try {
        const member = await getActiveMember(validId(req.user?.id));
        if (!member || !['team_member', 'associate'].includes(member.role)) return fail(res, 403, 'This account cannot access member profiles.');
        const [rows] = await pool.execute('SELECT gender, date_of_birth, address, payout_method, payout_details_encrypted FROM member_profiles WHERE member_id = ? LIMIT 1', [member.id]);
        const row = rows[0] || {};
        const payout = decryptPayout(row.payout_details_encrypted);
        return res.json({ success: true, data: { fullName: member.full_name, email: member.email, phone: member.phone || '', gender: row.gender || '', dateOfBirth: formatDateOnly(row.date_of_birth), address: row.address || '', payoutMethod: row.payout_method || 'upi', upiId: payout.upiId || '', accountHolderName: payout.accountHolderName || '', bankName: payout.bankName || '', accountNumber: payout.accountNumber || '', ifscCode: payout.ifscCode || '' } });
    } catch (error) { console.error('Load member profile failed:', error.message); return fail(res, 500, 'Unable to load profile. Check profile database setup and encryption key.'); }
});

router.put('/profile', async (req, res) => {
    try {
        const member = await getActiveMember(validId(req.user?.id));
        if (!member || !['team_member', 'associate'].includes(member.role)) return fail(res, 403, 'This account cannot update member profiles.');
        const body = req.body || {};
        const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const gender = String(body.gender || '');
        const dateOfBirth = String(body.dateOfBirth || '').trim();
        const address = typeof body.address === 'string' ? body.address.trim() : '';
        const payoutMethod = String(body.payoutMethod || 'upi');
        if (fullName.length < 2 || fullName.length > 100) return fail(res, 400, 'Full name must be 2–100 characters.');
        if (phone.length > 20) return fail(res, 400, 'Phone number is too long.');
        if (gender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(gender)) return fail(res, 400, 'Choose a valid gender option.');
        if (dateOfBirth && !isValidDateOnly(dateOfBirth)) return fail(res, 400, 'Enter a real date of birth using YYYY-MM-DD format.');
        if (dateOfBirth && dateOfBirth > new Date().toISOString().slice(0, 10)) return fail(res, 400, 'Date of birth cannot be in the future.');
        if (address.length > 1000) return fail(res, 400, 'Address is too long.');
        if (!['upi', 'bank'].includes(payoutMethod)) return fail(res, 400, 'Choose UPI or bank account.');
        const payout = {};
        if (payoutMethod === 'upi') {
            payout.upiId = String(body.upiId || '').trim();
            if (!payout.upiId || !/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/.test(payout.upiId)) return fail(res, 400, 'Enter a valid UPI ID to receive commission payments.');
        } else {
            payout.accountHolderName = String(body.accountHolderName || '').trim();
            payout.bankName = String(body.bankName || '').trim();
            payout.accountNumber = String(body.accountNumber || '').replace(/\s/g, '');
            payout.ifscCode = String(body.ifscCode || '').trim().toUpperCase();
            if (!payout.accountHolderName || !payout.bankName || !/^\d{6,20}$/.test(payout.accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(payout.ifscCode)) return fail(res, 400, 'Enter the account holder, bank name, account number (6–20 digits), and valid IFSC code.');
        }
        const encrypted = encryptPayout(payout);
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(`UPDATE members SET full_name = ?, phone = ? WHERE id = ?`, [fullName, phone || null, member.id]);
            await connection.execute(`INSERT INTO member_profiles (member_id, gender, date_of_birth, address, payout_method, payout_details_encrypted) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE gender = VALUES(gender), date_of_birth = VALUES(date_of_birth), address = VALUES(address), payout_method = VALUES(payout_method), payout_details_encrypted = VALUES(payout_details_encrypted)`, [member.id, gender || null, dateOfBirth || null, address || null, payoutMethod, encrypted]);
            await connection.commit();
        } catch (writeError) {
            try { await connection.rollback(); } catch { /* keep original error */ }
            throw writeError;
        } finally {
            connection.release();
        }
        return res.json({ success: true, message: 'Profile and payout details saved successfully.' });
    } catch (error) { console.error('Save member profile failed:', error.message); return fail(res, 500, 'Unable to save profile. Check the profile table and PROFILE_ENCRYPTION_KEY configuration.'); }
});

export default router;
