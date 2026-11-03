
function normalizeDestination(channel, value) {
    if (channel === 'email') {
        return String(value ?? '').trim().toLowerCase();
    }

    if (channel === 'phone') {
        return String(value ?? '').replace(/\D/g, '');
    }

    throw new Error('Unsupported verification channel.');
}

export async function consumeVerifiedContact(
    connection,
    channel,
    destination
) {
    const normalized = normalizeDestination(channel, destination);

    const [rows] = await connection.execute(
        `SELECT id
     FROM contact_otp_challenges
     WHERE channel = ?
       AND destination = ?
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
        [channel, normalized]
    );

    if (!rows.length) {
        const error = new Error(
            `A valid, verified ${channel} OTP is required before registration.`
        );
        error.statusCode = 400;
        throw error;
    }

    const [result] = await connection.execute(
        `UPDATE contact_otp_challenges
     SET consumed_at = NOW()
     WHERE id = ?
       AND consumed_at IS NULL`,
        [rows[0].id]
    );

    if (result.affectedRows !== 1) {
        const error = new Error(
            `The verified ${channel} challenge has already been used.`
        );
        error.statusCode = 400;
        throw error;
    }
}
