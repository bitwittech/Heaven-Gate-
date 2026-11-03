
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as crypto from 'node:crypto';

import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
const router = express.Router();

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.',
            });
        }

        const [members] = await pool.query(
            `SELECT id, full_name, email, password_hash, role, account_status
       FROM members
       WHERE email = ?
       LIMIT 1`,
            [email.trim()]
        );

        if (members.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.',
            });
        }

        const member = members[0];

        const passwordMatches = await bcrypt.compare(
            password,
            member.password_hash
        );

        if (!passwordMatches || member.account_status !== 'active') {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password, or account is inactive.',
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET is not configured.');

            return res.status(500).json({
                success: false,
                message: 'Authentication is not configured.',
            });
        }

        const token = jwt.sign(
            { sub: Number(member.id) },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({
            success: true,
            message: 'Login successful.',
            token,
            user: {
                id: Number(member.id),
                fullName: member.full_name,
                email: member.email,
                role: member.role,
            },
        });
    } catch (error) {
        console.error('Login failed:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Unable to complete login.',
        });
    }
});


router.get('/me', authenticate, async (req, res) => {
    try {
        const [members] = await pool.query(
            `SELECT id, full_name, email, role, account_status
             FROM members
             WHERE id = ?
             LIMIT 1`,
            [req.user.id]
        );

        if (
            members.length === 0 ||
            members[0].account_status !== 'active'
        ) {
            return res.status(401).json({
                success: false,
                message: 'Account not found or inactive.',
            });
        }

        const member = members[0];

        return res.json({
            success: true,
            user: {
                id: Number(member.id),
                fullName: member.full_name,
                email: member.email,
                role: member.role,
            },
        });
    } catch (error) {
        console.error('Fetch current user failed:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Unable to fetch current user.',
        });
    }
});

/**
 * POST /api/auth/register/team-member
 * Register a Team Member using an owner-issued registration code.
 */
router.post('/register/team-member', async (req, res) => {
    let connection;

    try {
        const {
            full_name,
            email,
            phone,
            password,
            registrationCode
        } = req.body ?? {};

        // Validate the required fields.
        if (
            typeof full_name !== 'string' ||
            !full_name.trim() ||
            full_name.trim().length > 150 ||
            typeof email !== 'string' ||
            !email.trim() ||
            email.trim().length > 254 ||
            typeof password !== 'string' ||
            Buffer.byteLength(password, 'utf8') < 8 ||
            Buffer.byteLength(password, 'utf8') > 72 ||
            typeof registrationCode !== 'string' ||
            !registrationCode.trim()
        ) {
            return res.status(400).json({
                success: false,
                message:
                    'Name, valid email, password of 8–72 bytes, and registration code are required.'
            });
        }

        if (
            phone !== undefined &&
            phone !== null &&
            typeof phone !== 'string'
        ) {
            return res.status(400).json({
                success: false,
                message: 'Phone must be text.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedPhone = phone?.trim() || null;

        // Basic email-format validation.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address.'
            });
        }

        // Hash the password before opening the transaction.
        const passwordHash = await bcrypt.hash(password, 12);

        // Hash the supplied code in the same way as the admin API.
        const codeHash = crypto
            .createHash('sha256')
            .update(registrationCode.trim())
            .digest('hex');

        connection = await pool.getConnection();
        await connection.beginTransaction();
        // Require an unexpired, verified, unused email OTP.
        const [verifiedChallenges] = await connection.execute(
            `SELECT id
     FROM contact_otp_challenges
     WHERE channel = 'email'
       AND destination = ?
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
            [normalizedEmail]
        );

        if (verifiedChallenges.length === 0) {
            await connection.rollback();

            return res.status(403).json({
                success: false,
                message: 'Please verify your email with OTP before registering.'
            });
        }

        const verifiedChallengeId = verifiedChallenges[0].id;

        // Lock the code row so simultaneous requests cannot reuse it.
        const [codes] = await connection.execute(
            `SELECT id
             FROM team_registration_codes
             WHERE code_hash = ?
               AND used_at IS NULL
               AND is_revoked = 0
               AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1
             FOR UPDATE`,
            [codeHash]
        );

        if (codes.length === 0) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message:
                    'Registration code is invalid, expired, revoked, or already used.'
            });
        }

        // Prevent duplicate accounts.
        const [existingMembers] = await connection.execute(
            `SELECT id
             FROM members
             WHERE email = ?
             LIMIT 1`,
            [normalizedEmail]
        );

        if (existingMembers.length > 0) {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        // Create an active Team Member. Never accept the role from the client.
        const [memberResult] = await connection.execute(
            `INSERT INTO members
                (
                    full_name,
                    email,
                    phone,
                    password_hash,
                    role,
                    account_status,
                    parent_member_id
                )
             VALUES (?, ?, ?, ?, 'team_member', 'active', NULL)`,
            [
                full_name.trim(),
                normalizedEmail,
                normalizedPhone,
                passwordHash
            ]
        );

        const memberId = memberResult.insertId;

        // Mark the code as used by this member.
        await connection.execute(
            `UPDATE team_registration_codes
             SET used_at = NOW(), used_by = ?
             WHERE id = ?
               AND used_at IS NULL`,
            [memberId, codes[0].id]
        );

        // Mark the verified email OTP as consumed.
// It cannot be reused for another registration.
const [otpConsumption] = await connection.execute(
    `UPDATE contact_otp_challenges
     SET consumed_at = NOW()
     WHERE id = ?
       AND channel = 'email'
       AND destination = ?
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > NOW()`,
    [verifiedChallengeId, normalizedEmail]
);

if (otpConsumption.affectedRows !== 1) {
    throw new Error('Verified email OTP could not be consumed.');
}

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: 'Team Member registered successfully. You can now log in.',
            user: {
                id: Number(memberId),
                fullName: full_name.trim(),
                email: normalizedEmail,
                role: 'team_member'
            }
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {
                // Ignore rollback errors while handling the original error.
            }
        }

        console.error('Team Member registration failed:', error.message);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to register Team Member.'
        });
    } finally {
        connection?.release();
    }
});

// POST /api/auth/register/associate
// Register an independent Associate after email OTP verification.
router.post('/register/associate', async (req, res) => {
    let connection;

    try {
        const {
            fullName,
            full_name,
            email,
            phone,
            password
        } = req.body ?? {};

        // Support both mobile camelCase and backend snake_case names.
        const name = typeof fullName === 'string'
            ? fullName
            : full_name;

        if (
            typeof name !== 'string' ||
            !name.trim() ||
            name.trim().length > 150 ||
            typeof email !== 'string' ||
            !email.trim() ||
            email.trim().length > 254 ||
            typeof password !== 'string' ||
            Buffer.byteLength(password, 'utf8') < 8 ||
            Buffer.byteLength(password, 'utf8') > 72
        ) {
            return res.status(400).json({
                success: false,
                message:
                    'Name, valid email, and password of 8–72 bytes are required.'
            });
        }

        if (
            phone !== undefined &&
            phone !== null &&
            typeof phone !== 'string'
        ) {
            return res.status(400).json({
                success: false,
                message: 'Phone must be text.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedPhone = phone?.trim() || null;

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address.'
            });
        }

        if (!process.env.JWT_SECRET) {
            return res.status(503).json({
                success: false,
                message: 'Authentication is not configured.'
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Require a verified, unexpired, unused email OTP.
        // Lock the OTP row until registration is committed.
        const [verifiedChallenges] = await connection.execute(
            `SELECT id
             FROM contact_otp_challenges
             WHERE channel = 'email'
               AND destination = ?
               AND verified_at IS NOT NULL
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [normalizedEmail]
        );

        if (verifiedChallenges.length === 0) {
            await connection.rollback();

            return res.status(403).json({
                success: false,
                message:
                    'Please verify your email with OTP before registering.'
            });
        }

        const verifiedChallengeId = verifiedChallenges[0].id;

        // Prevent duplicate accounts.
        const [existingMembers] = await connection.execute(
            `SELECT id
             FROM members
             WHERE email = ?
             LIMIT 1`,
            [normalizedEmail]
        );

        if (existingMembers.length > 0) {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        // Associates register independently.
        // Never accept a role or parent member ID from the client.
        const [memberResult] = await connection.execute(
            `INSERT INTO members (
                full_name,
                email,
                phone,
                password_hash,
                role,
                account_status,
                parent_member_id
            )
            VALUES (?, ?, ?, ?, 'associate', 'active', NULL)`,
            [
                name.trim(),
                normalizedEmail,
                normalizedPhone,
                passwordHash
            ]
        );

        const memberId = Number(memberResult.insertId);

        // Consume the verified OTP in the same transaction.
        const [otpConsumption] = await connection.execute(
            `UPDATE contact_otp_challenges
             SET consumed_at = NOW()
             WHERE id = ?
               AND channel = 'email'
               AND destination = ?
               AND verified_at IS NOT NULL
               AND consumed_at IS NULL
               AND expires_at > NOW()`,
            [verifiedChallengeId, normalizedEmail]
        );

        if (otpConsumption.affectedRows !== 1) {
            throw new Error(
                'Verified email OTP could not be consumed.'
            );
        }

        // Create a session for the mobile app.
        const token = jwt.sign(
            { sub: memberId },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: 'Associate registered successfully.',
            token,
            user: {
                id: memberId,
                fullName: name.trim(),
                email: normalizedEmail,
                role: 'associate'
            }
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {
                // Preserve the original error.
            }
        }

        console.error(
            'Associate registration failed:',
            error.message
        );

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to register Associate.'
        });
    } finally {
        connection?.release();
    }
});






export default router;
