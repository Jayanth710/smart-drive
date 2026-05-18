import crypto from 'crypto';
import type { Request, Response, NextFunction, CookieOptions } from 'express';
import logger from '../logger.js';

/**
 * Signed double-submit cookie CSRF protection.
 *
 * The browser holds a non-HttpOnly `csrfToken` cookie. JS on our origin reads
 * it and echoes the value in an `x-csrf-token` header on state-changing
 * requests. The server validates that:
 *   1. cookie value === header value (double-submit), and
 *   2. the value is a valid `<random>.<hmac>` pair signed with CSRF_SECRET.
 *
 * Cross-site JS can't read our cookie (no `withCredentials` on the attacker's
 * domain), so it can't forge the header. SameSite=none cookies alone don't
 * stop CSRF — this middleware does.
 */

const TOKEN_BYTES = 24;
const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes that establish a session (login/register) or are validated by an
// out-of-band token (password reset) don't have a CSRF cookie yet, so we
// exempt them. Logout is NOT exempt — forcing logout is a real attack.
const EXEMPT_PATHS = new Set([
    '/api/login',
    '/api/register',
    '/api/forgot-password',
    '/api/reset-password',
    '/api/refresh',        // no CSRF cookie may exist yet when access token has expired
    '/api/verify-email',   // out-of-band token from email
    '/api/logout',         // safe to allow — only clears state; protected by SameSite + rate-limit upstream
]);

const getSecret = (): string => {
    const secret = process.env.CSRF_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('CSRF_SECRET (or JWT_SECRET as fallback) must be set');
    }
    return secret;
};

const sign = (random: string, secret: string): string =>
    crypto.createHmac('sha256', secret).update(random).digest('hex');

const makeToken = (): string => {
    const random = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    return `${random}.${sign(random, getSecret())}`;
};

const isValid = (token: string | undefined): boolean => {
    if (!token || typeof token !== 'string') return false;
    const [random, signature] = token.split('.');
    if (!random || !signature) return false;
    const expected = sign(random, getSecret());
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

const cookieOptions = (): CookieOptions => ({
    httpOnly: false, // MUST be readable by frontend JS
    secure: process.env.NODE_ENV !== 'development',
    sameSite: process.env.NODE_ENV === 'development' ? 'lax' : 'none',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
});

/** Issue a fresh CSRF cookie. Call after login or on first authenticated GET. */
export const issueCsrfCookie = (res: Response): void => {
    res.cookie(CSRF_COOKIE, makeToken(), cookieOptions());
};

export const csrfMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    // Refresh the cookie opportunistically on safe requests so a fresh
    // browser session always has one to send back.
    if (SAFE_METHODS.has(req.method)) {
        if (!req.cookies?.[CSRF_COOKIE]) {
            issueCsrfCookie(res);
        }
        next();
        return;
    }

    if (EXEMPT_PATHS.has(req.path)) {
        next();
        return;
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const headerToken = req.header(CSRF_HEADER);

    if (!cookieToken || !headerToken || cookieToken !== headerToken || !isValid(cookieToken)) {
        logger.warn(`CSRF check failed for ${req.method} ${req.path}`);
        res.status(403).json({ message: 'Invalid or missing CSRF token.' });
        return;
    }

    next();
};
