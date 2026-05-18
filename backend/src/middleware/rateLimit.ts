import rateLimit from 'express-rate-limit';

// Tighter limits for credential-handling endpoints — these are the ones
// targeted by brute-force and email-enumeration attacks.
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
});

export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many accounts created from this IP. Please try again later.' },
});

export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many password reset requests. Please try again later.' },
});

/**
 * Per-user chat rate limit. Protects against runaway Gemini cost from a
 * single misbehaving account or compromised session. Keyed on userId
 * (not IP) so multiple devs on the same office IP don't trip each other.
 */
export const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // req.user is populated by verifyToken which runs before this middleware.
        const u = (req as unknown as { user?: { _id?: { toString(): string } } }).user;
        return u?._id?.toString() ?? req.ip ?? 'anon';
    },
    message: { message: 'You are chatting too fast. Please wait a moment.' },
});

export const chatDailyLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const u = (req as unknown as { user?: { _id?: { toString(): string } } }).user;
        return u?._id?.toString() ?? req.ip ?? 'anon';
    },
    message: { message: 'Daily chat limit reached. Resets in 24h.' },
});
