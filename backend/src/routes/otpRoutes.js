
import express from 'express';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import pool from '../config/db.js';

const router = express.Router();

const OTP_LIFETIME_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const RESEND_WAIT_SECONDS = 60;

function fail(res, status, message) {
    return res.status(status).json({ success: false, message });
}

function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
}

function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
}

function otpHash(channel, destination, otp) {
    const secret = process.env.OTP_HASH_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error('OTP_HASH_SECRET must be configured with at least 32 characters.');
    }

    return crypto
        .createHmac('sha256', secret)
        .update(`${channel}:${destination}:${otp}`)
        .digest('hex');
}

function secureEqualsHex(expected, received) {
    if (!/^[a-f0-9]{64}$/i.test(expected)) return false;

    const left = Buffer.from(expected, 'hex');
    const right = Buffer.from(received, 'hex');

    return left.length === right.length &&
        crypto.timingSafeEqual(left, right);
}

function getEmailTransport() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass || !process.env.EMAIL_FROM) {
        throw new Error('Email OTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM.');
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
}

function providerPhone(phone) {
    // The app currently sends digits only. Treat a 10-digit number as Indian.
    if (/^\d{10}$/.test(phone)) return `91${phone}`;

    // Accept an international number with its country code already included.
    if (/^[1-9]\d{9,14}$/.test(phone)) return phone;

    throw new Error('Enter a valid mobile number with country code if it is not an Indian number.');
}

async function checkSendLimit(channel, destination) {
    const [rows] = await pool.execute(
        `SELECT
       COUNT(*) AS sendsLastHour,
       TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS secondsSinceLast
     FROM contact_otp_challenges
     WHERE channel = ?
       AND destination = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
        [channel, destination]
    );

    const row = rows[0];

    if (Number(row.sendsLastHour) >= MAX_SENDS_PER_HOUR) {
        return 'Too many OTP requests. Try again in an hour.';
    }

    if (
        row.secondsSinceLast !== null &&
        Number(row.secondsSinceLast) < RESEND_WAIT_SECONDS
    ) {
        return `Please wait ${RESEND_WAIT_SECONDS - Number(row.secondsSinceLast)} seconds before requesting another OTP.`;
    }

    return null;
}

async function createChallenge(channel, destination, hash = null) {
    // Invalidate outstanding challenges whenever a new code is requested.
    await pool.execute(
        `UPDATE contact_otp_challenges
     SET consumed_at = NOW()
     WHERE channel = ?
       AND destination = ?
       AND consumed_at IS NULL`,
        [channel, destination]
    );

    const [insert] = await pool.execute(
        `INSERT INTO contact_otp_challenges
       (channel, destination, otp_hash, expires_at, attempt_count)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0)`,
        [channel, destination, hash, OTP_LIFETIME_MINUTES]
    );

    return insert.insertId;
}

async function getCurrentChallenge(channel, destination) {
    const [rows] = await pool.execute(
        `SELECT id, otp_hash, attempt_count, expires_at, verified_at
     FROM contact_otp_challenges
     WHERE channel = ?
       AND destination = ?
       AND consumed_at IS NULL
       AND expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1`,
        [channel, destination]
    );

    return rows[0] ?? null;
}

async function recordAttempt(id) {
    await pool.execute(
        `UPDATE contact_otp_challenges
     SET attempt_count = attempt_count + 1
     WHERE id = ? AND attempt_count < ? AND verified_at IS NULL`,
        [id, MAX_ATTEMPTS]
    );
}

async function markVerified(id) {
    const [result] = await pool.execute(
        `UPDATE contact_otp_challenges
     SET verified_at = NOW()
     WHERE id = ?
       AND consumed_at IS NULL
       AND expires_at > NOW()
       AND attempt_count <= ?
       AND verified_at IS NULL`,
        [id, MAX_ATTEMPTS]
    );

    return result.affectedRows === 1;
}

// POST /api/auth/otp/email/send
router.post('/email/send', async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return fail(res, 400, 'Enter a valid email address.');
    }

    try {
        const limitMessage = await checkSendLimit('email', email);
        if (limitMessage) return fail(res, 429, limitMessage);

        const transporter = getEmailTransport();
        const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const hash = otpHash('email', email, otp);

        const challengeId = await createChallenge('email', email, hash);

        try {
            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: email,
                subject: 'Your Heaven Gate verification code',
                text: `Your Heaven Gate verification code is ${otp}. It expires in ${OTP_LIFETIME_MINUTES} minutes. Do not share this code with anyone.`,
                html: `<div style="font-family:Arial,sans-serif;color:#17324D">
          <h2>Heaven Gate</h2>
          <p>Use this verification code to continue creating your account:</p>
          <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p>
          <p>This code expires in ${OTP_LIFETIME_MINUTES} minutes. Do not share it with anyone.</p>
        </div>`,
            });
        } catch (sendError) {
            await pool.execute(
                'UPDATE contact_otp_challenges SET consumed_at = NOW() WHERE id = ?',
                [challengeId]
            );
            throw sendError;
        }

        return res.json({
            success: true,
            message: 'Email OTP sent. It expires in 10 minutes.',
        });
    } catch (error) {
        console.error('Email OTP send failed:', error.message);
        return fail(
            res,
            error.message.includes('not configured') ||
                error.message.includes('OTP_HASH_SECRET')
                ? 503
                : 502,
            error.message.includes('not configured') ||
                error.message.includes('OTP_HASH_SECRET')
                ? error.message
                : 'Unable to send email OTP. Check the email provider configuration.'
        );
    }
});

// POST /api/auth/otp/email/verify
router.post('/email/verify', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp ?? '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(otp)) {
        return fail(res, 400, 'Enter a valid email and six-digit OTP.');
    }

    try {
        const challenge = await getCurrentChallenge('email', email);

        if (!challenge) {
            return fail(res, 400, 'No valid email OTP found. Request a new code.');
        }

        if (challenge.verified_at) {
            return res.json({ success: true, verified: true, message: 'Email already verified.' });
        }

        if (Number(challenge.attempt_count) >= MAX_ATTEMPTS) {
            return fail(res, 429, 'Too many incorrect attempts. Request a new OTP.');
        }

        await recordAttempt(challenge.id);

        const suppliedHash = otpHash('email', email, otp);

        if (!secureEqualsHex(challenge.otp_hash ?? '', suppliedHash)) {
            return fail(res, 400, 'Incorrect OTP. Please try again.');
        }

        const marked = await markVerified(challenge.id);

        if (!marked) {
            return fail(res, 400, 'This OTP has expired or is no longer valid.');
        }

        return res.json({ success: true, verified: true, message: 'Email verified successfully.' });
    } catch (error) {
        console.error('Email OTP verify failed:', error.message);
        return fail(res, 500, 'Unable to verify email OTP.');
    }
});

// POST /api/auth/otp/phone/send
router.post('/phone/send', async (req, res) => {
    const phone = normalizePhone(req.body?.phone);

    if (!/^\d{10,15}$/.test(phone)) {
        return fail(res, 400, 'Enter a valid mobile number.');
    }

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_OTP_TEMPLATE_ID;

    if (!authKey || !templateId) {
        return fail(res, 503, 'Phone OTP is not configured. Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID in backend/.env.');
    }

    try {
        const limitMessage = await checkSendLimit('phone', phone);
        if (limitMessage) return fail(res, 429, limitMessage);

        const mobile = providerPhone(phone);
        const url = new URL('https://control.msg91.com/api/v5/otp');
        url.searchParams.set('template_id', templateId);
        url.searchParams.set('mobile', mobile);

        const providerResponse = await fetch(url, {
            method: 'POST',
            headers: {
                authkey: authKey,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify({ Param1: 'Heaven Gate verification' }),
            signal: AbortSignal.timeout(15000),
        });

        const providerResult = await providerResponse.json().catch(() => ({}));

        if (
            !providerResponse.ok ||
            String(providerResult.type ?? '').toLowerCase() === 'error'
        ) {
            console.error('MSG91 send OTP failed:', providerResult);
            return fail(res, 502, 'SMS provider could not send the OTP. Check your MSG91 template and account.');
        }

        await createChallenge('phone', phone, null);

        return res.json({
            success: true,
            message: 'Phone OTP requested. It expires in 10 minutes.',
        });
    } catch (error) {
        console.error('Phone OTP send failed:', error.message);
        return fail(
            res,
            error.message.includes('mobile number') ? 400 : 502,
            error.message.includes('mobile number')
                ? error.message
                : 'Unable to send phone OTP. Check the MSG91 configuration and network.'
        );
    }
});

// POST /api/auth/otp/phone/verify
router.post('/phone/verify', async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp ?? '').trim();

    if (!/^\d{10,15}$/.test(phone) || !/^\d{4,8}$/.test(otp)) {
        return fail(res, 400, 'Enter a valid mobile number and OTP.');
    }

    const authKey = process.env.MSG91_AUTH_KEY;

    if (!authKey) {
        return fail(res, 503, 'Phone OTP verification is not configured.');
    }

    try {
        const challenge = await getCurrentChallenge('phone', phone);

        if (!challenge) {
            return fail(res, 400, 'No valid phone OTP found. Request a new code.');
        }

        if (challenge.verified_at) {
            return res.json({ success: true, verified: true, message: 'Phone already verified.' });
        }

        if (Number(challenge.attempt_count) >= MAX_ATTEMPTS) {
            return fail(res, 429, 'Too many incorrect attempts. Request a new OTP.');
        }

        await recordAttempt(challenge.id);

        const url = new URL('https://control.msg91.com/api/v5/otp/verify');
        url.searchParams.set('mobile', providerPhone(phone));
        url.searchParams.set('otp', otp);

        const providerResponse = await fetch(url, {
            method: 'GET',
            headers: {
                authkey: authKey,
                accept: 'application/json',
            },
            signal: AbortSignal.timeout(15000),
        });

        const providerResult = await providerResponse.json().catch(() => ({}));
        const providerMessage = String(providerResult.message ?? '').toLowerCase();

        if (
            !providerResponse.ok ||
            String(providerResult.type ?? '').toLowerCase() !== 'success'
        ) {
            return fail(res, 400, 'Incorrect or expired phone OTP. Please try again.');
        }

        const marked = await markVerified(challenge.id);

        if (!marked) {
            return fail(res, 400, 'This phone OTP has expired or is no longer valid.');
        }

        return res.json({ success: true, verified: true, message: 'Phone verified successfully.' });
    } catch (error) {
        console.error('Phone OTP verify failed:', error.message);
        return fail(res, 502, 'Unable to verify phone OTP with the SMS provider.');
    }
});

export default router;
