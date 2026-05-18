import { Request, Response, CookieOptions } from 'express';
import crypto from 'crypto';
import User from '../models/userModel.js';
import logger from '../logger.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import validator from 'validator';
import { AuthenticatedRequest } from '../middleware/auth.js';
import UserFile from '../models/userFileModel.js';
import { bucket } from '../services/gcsUpload.js';
import { deleteWeaviateUser } from '../services/queryWeaviate.js';
import UserResetPassword from '../models/userResetPasswordModel.js';
import RevokedToken from '../models/revokedTokenModel.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/emailService.js';
import { issueCsrfCookie } from '../middleware/csrf.js';

// ---------- constants ----------
// Access token: long enough to avoid mid-flight churn; refresh covers the rest.
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '7d';
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_FAILED_ATTEMPTS = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

// ---------- helpers ----------
const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

const cookieOpts = (maxAge: number): CookieOptions => ({
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: process.env.NODE_ENV === 'development' ? 'lax' : 'none',
    maxAge,
    path: '/',
});

const clearCookieOpts: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: process.env.NODE_ENV === 'development' ? 'lax' : 'none',
    path: '/',
};

const generateAccessToken = (id: string) =>
    jwt.sign({ id, jti: crypto.randomUUID() }, process.env.JWT_SECRET!, { expiresIn: ACCESS_TOKEN_TTL });

const generateRefreshToken = (id: string) =>
    jwt.sign({ id, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET!, { expiresIn: REFRESH_TOKEN_TTL });

const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
    res.cookie('accessToken', accessToken, cookieOpts(ACCESS_COOKIE_MAX_AGE));
    res.cookie('refreshToken', refreshToken, cookieOpts(REFRESH_COOKIE_MAX_AGE));
    issueCsrfCookie(res);
};

const clearAuthCookies = (res: Response) => {
    res.clearCookie('accessToken', clearCookieOpts);
    res.clearCookie('refreshToken', clearCookieOpts);
    res.clearCookie('csrfToken', { ...clearCookieOpts, httpOnly: false });
};

const revokeToken = async (token: string, secret: string): Promise<void> => {
    try {
        const decoded = jwt.verify(token, secret) as { jti?: string; exp?: number };
        if (!decoded.jti || !decoded.exp) return;
        await RevokedToken.create({
            jti: decoded.jti,
            expiresAt: new Date(decoded.exp * 1000),
        }).catch((err: unknown) => {
            const code = (err as { code?: number })?.code;
            if (code !== 11000) throw err;
        });
    } catch {
        // Invalid/expired token: nothing to revoke.
    }
};

const sendVerificationFireAndForget = (user: { _id: unknown; email: string }) => {
    const frontEndUrl = process.env.FRONT_END_URL;
    if (!frontEndUrl) return;
    (async () => {
        try {
            const raw = crypto.randomBytes(32).toString('hex');
            await User.findByIdAndUpdate(user._id, {
                emailVerificationToken: hashToken(raw),
                emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
            });
            const link = `${frontEndUrl}/verify-email?token=${raw}`;
            await sendVerificationEmail(user.email, link);
        } catch (err) {
            logger.error(`Failed to send verification email for user ${user._id}:`, err);
        }
    })();
};

// ---------- handlers ----------

const loginUser = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required.' });
        return;
    }

    try {
        const user = await User.findOne({ email });

        // Generic auth-failure for unknown email (prevent enumeration).
        if (!user) {
            logger.info('Login attempt for unknown email');
            res.status(401).json({ message: 'Invalid email or password.' });
            return;
        }

        // Account lockout check.
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
            const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
            res.status(423).json({ message: `Account temporarily locked. Try again in ${minutesLeft} minute(s).` });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            // Increment failed attempts, lock after threshold.
            user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
            if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
                user.lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MS);
                user.failedLoginAttempts = 0;
                logger.warn(`Account ${user._id} locked after ${MAX_FAILED_ATTEMPTS} failed attempts`);
            }
            await user.save();
            res.status(401).json({ message: 'Invalid email or password.' });
            return;
        }

        // Clear lockout state on successful login.
        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
            user.failedLoginAttempts = 0;
            user.lockedUntil = null;
            await user.save();
        }

        const accessToken = generateAccessToken(user._id.toString());
        const refreshToken = generateRefreshToken(user._id.toString());
        setAuthCookies(res, accessToken, refreshToken);

        logger.info(`User logged in successfully (userId=${user._id})`);

        res.status(200).send({
            _id: user._id,
            email: user.email,
            emailVerified: user.emailVerified,
        });
        return;
    } catch (error) {
        logger.error('Login Error:', error);
        res.status(500).json({ message: 'Server Error' });
        return;
    }
};

const registerUser = async (req: Request, res: Response) => {
    const data = req.body;
    // Same generic response regardless of outcome, so we don't reveal which
    // emails are registered. Errors are visible only via logs.
    const genericResponse = {
        message: 'If your email is available, your account has been created. Check your inbox to verify.',
    };

    if (!data?.email || !validator.isEmail(data.email)) {
        res.status(400).json({ message: 'A valid email is required.' });
        return;
    }
    if (!data?.password || !validator.isStrongPassword(data.password)) {
        res.status(400).json({ message: 'Password is not strong enough.' });
        return;
    }
    if (!data?.firstname || !data?.lastname) {
        res.status(400).json({ message: 'First and last name are required.' });
        return;
    }

    try {
        const existing = await User.findOne({ email: data.email });
        if (existing) {
            logger.info(`Register attempted for existing email (userId=${existing._id})`);
            res.status(200).json(genericResponse);
            return;
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(data.password, salt);

        const user = await new User({
            email: data.email,
            password: hashedPassword,
            firstName: data.firstname,
            lastName: data.lastname,
            phone: data.phone,
            passwordChangedAt: new Date(),
        }).save();

        logger.info(`New user created (userId=${user._id})`);

        sendVerificationFireAndForget({ _id: user._id, email: user.email });

        res.status(200).json(genericResponse);
        return;
    } catch (error) {
        logger.error('Register Error:', error);
        res.status(500).json({ message: 'Server Error' });
        return;
    }
};

const refreshSession = async (req: Request, res: Response): Promise<void> => {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) {
        res.status(401).json({ message: 'No refresh token.' });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as {
            id: string;
            jti?: string;
            iat?: number;
        };

        // Reject revoked refresh tokens (e.g., already-rotated).
        if (decoded.jti) {
            const revoked = await RevokedToken.exists({ jti: decoded.jti });
            if (revoked) {
                res.status(401).json({ message: 'Refresh token revoked.' });
                return;
            }
        }

        const user = await User.findById(decoded.id);
        if (!user) {
            res.status(401).json({ message: 'User no longer exists.' });
            return;
        }

        // If the password changed after this refresh token was issued, reject.
        if (decoded.iat && user.passwordChangedAt) {
            const pwdChangedSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
            if (decoded.iat < pwdChangedSec) {
                res.status(401).json({ message: 'Password changed; please log in again.' });
                return;
            }
        }

        // Rotate: revoke the old refresh token, mint fresh access + refresh.
        await revokeToken(token, process.env.JWT_REFRESH_SECRET!);

        const accessToken = generateAccessToken(user._id.toString());
        const refreshToken = generateRefreshToken(user._id.toString());
        setAuthCookies(res, accessToken, refreshToken);

        res.status(200).json({ message: 'Session refreshed.' });
        return;
    } catch (error) {
        logger.warn('Refresh failed:', error);
        res.status(401).json({ message: 'Could not refresh session.' });
        return;
    }
};

const getUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user) {
            res.status(200).json({ message: 'User details fetched successfully', data: req.user });
            return;
        }
        res.status(404).json({ message: 'User not found' });
    } catch (error) {
        logger.error('getUser Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

const updateUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?._id;
        const { firstName, lastName, phone } = req.body;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                ...(firstName && { firstName }),
                ...(lastName && { lastName }),
                ...(phone && { phone }),
            },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        res.status(200).json({ message: 'User updated successfully', data: updatedUser });
    } catch (error) {
        logger.error('Error updating user:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?._id.toString();
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).send({ message: 'User Not Found' });
            return;
        }

        const { currentPassword, newPassword } = req.body;
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            res.status(400).json({ message: 'Wrong current password' });
            return;
        }

        if (!newPassword || typeof newPassword !== 'string' || !validator.isStrongPassword(newPassword)) {
            res.status(400).json({ message: 'New password is not strong enough' });
            return;
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.passwordChangedAt = new Date(); // invalidates every prior session
        await user.save();

        // Sign new tokens so the user isn't logged out of this request.
        const accessToken = generateAccessToken(user._id.toString());
        const refreshToken = generateRefreshToken(user._id.toString());
        setAuthCookies(res, accessToken, refreshToken);

        logger.info(`Password changed for userId=${user._id}`);
        res.status(200).send({ message: 'Password changed successfully' });
    } catch (error) {
        logger.error('Error updating password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const deleteUser = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id.toString();
    if (!userId) {
        res.status(401).send({ message: 'Authentication error' });
        return;
    }
    try {
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).send({ message: 'User Not Found' });
            return;
        }

        await bucket.deleteFiles({ prefix: `${userId}/` });
        await deleteWeaviateUser(userId);
        await UserFile.deleteMany({ userId });
        await User.findByIdAndDelete(userId);

        logger.info(`Deleted account userId=${userId}`);
        clearAuthCookies(res);
        res.status(200).send({ message: 'Account and all associated data have been successfully deleted.' });
    } catch (error) {
        logger.error('Error deleting the account', error);
        res.status(500).json({ message: 'Error occured during deletion of account.' });
    }
};

const deleteUserData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    if (!userId) {
        res.status(401).send({ message: 'Authentication error' });
        return;
    }
    try {
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).send({ message: 'User Not Found' });
            return;
        }

        await bucket.deleteFiles({ prefix: `${userId}/` });
        await deleteWeaviateUser(userId);
        await UserFile.deleteMany({ userId });

        logger.info(`Deleted all data for userId=${userId}`);
        res.status(200).send({ message: 'All associated data have been successfully deleted.' });
    } catch (error) {
        logger.error('Error deleting the data', error);
        res.status(500).json({ message: 'Error occured during deletion of data.' });
    }
};

const forgotPassword = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;
    const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

    if (!email || typeof email !== 'string') {
        res.status(200).json(genericResponse);
        return;
    }

    try {
        const frontEndUrl = process.env.FRONT_END_URL;
        if (!frontEndUrl) {
            logger.error('FRONT_END_URL is not set; cannot build password reset link.');
            res.status(500).json({ message: 'Email service is not configured.' });
            return;
        }

        const user = await User.findOne({ email });
        if (!user) {
            res.status(200).json(genericResponse);
            return;
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(rawToken);

        await UserResetPassword.deleteMany({ userId: user._id });
        await new UserResetPassword({
            userId: user._id,
            token: tokenHash,
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        }).save();

        const resetUrl = `${frontEndUrl}/reset-password?token=${rawToken}`;
        sendPasswordResetEmail(email, resetUrl).catch((err) => {
            logger.error(`Failed to send password reset email for userId ${user._id}:`, err);
        });

        res.status(200).json(genericResponse);
    } catch (error) {
        logger.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'Could not process the request.' });
    }
};

const resetPassword = async (req: Request, res: Response): Promise<void> => {
    const { token, password } = req.body;

    if (!token || typeof token !== 'string' || token.length > 256) {
        res.status(400).json({ message: 'Invalid reset token.' });
        return;
    }
    if (!password || typeof password !== 'string' || !validator.isStrongPassword(password)) {
        res.status(400).json({ message: 'Password is not strong enough.' });
        return;
    }

    try {
        const tokenHash = hashToken(token);
        const userRecord = await UserResetPassword.findOne({
            token: tokenHash,
            expiresAt: { $gt: new Date() },
        });

        if (!userRecord) {
            res.status(400).json({ message: 'Password reset token is invalid or has expired.' });
            return;
        }

        const user = await User.findById(userRecord.userId);
        if (!user) {
            await UserResetPassword.findByIdAndDelete(userRecord._id);
            res.status(400).json({ message: 'User associated with this token no longer exists.' });
            return;
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.passwordChangedAt = new Date(); // invalidate every existing session
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        await user.save();

        await UserResetPassword.deleteMany({ userId: userRecord.userId });

        res.status(200).json({ message: 'Password has been reset successfully. You can now log in.' });
    } catch (error) {
        logger.error('Reset Password Error:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
};

const verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.length > 256) {
        res.status(400).json({ message: 'Invalid verification token.' });
        return;
    }

    try {
        const tokenHash = hashToken(token);
        const user = await User.findOne({
            emailVerificationToken: tokenHash,
            emailVerificationExpiresAt: { $gt: new Date() },
        });

        if (!user) {
            res.status(400).json({ message: 'Verification link is invalid or has expired.' });
            return;
        }

        user.emailVerified = true;
        user.emailVerificationToken = null;
        user.emailVerificationExpiresAt = null;
        await user.save();

        logger.info(`Email verified for userId=${user._id}`);
        res.status(200).json({ message: 'Email verified.' });
    } catch (error) {
        logger.error('Email Verification Error:', error);
        res.status(500).json({ message: 'Could not verify email.' });
    }
};

const resendVerification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const user = req.user;
    if (!user) {
        res.status(401).json({ message: 'Not authorized.' });
        return;
    }
    if (user.emailVerified) {
        res.status(200).json({ message: 'Email already verified.' });
        return;
    }

    sendVerificationFireAndForget({ _id: user._id, email: user.email });
    res.status(200).json({ message: 'Verification email sent.' });
};

const logoutUser = async (req: Request, res: Response): Promise<void> => {
    // No verifyToken middleware — logout always succeeds and always clears cookies,
    // even if the token is expired, invalid, or already revoked.
    try {
        const accessToken =
            (req.headers.authorization?.startsWith('Bearer ')
                ? req.headers.authorization.split(' ')[1]
                : undefined) ??
            (req.cookies?.accessToken as string | undefined);
        const refreshToken = req.cookies?.refreshToken as string | undefined;

        if (accessToken) await revokeToken(accessToken, process.env.JWT_SECRET!);
        if (refreshToken) await revokeToken(refreshToken, process.env.JWT_REFRESH_SECRET!);

        clearAuthCookies(res);
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        logger.error('Logout Error:', error);
        clearAuthCookies(res);
        res.status(200).json({ message: 'Logged out' });
    }
};

export {
    loginUser,
    registerUser,
    refreshSession,
    getUser,
    updateUser,
    changePassword,
    deleteUser,
    deleteUserData,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
    logoutUser,
};
