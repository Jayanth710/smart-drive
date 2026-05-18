import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User, { UserInterface } from '../models/userModel.js';
import RevokedToken from '../models/revokedTokenModel.js';
import logger from '../logger.js';

export interface AuthenticatedRequest extends Request {
    user?: UserInterface | null;
}

export const verifyToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const bearer =
        req.headers.authorization?.startsWith("Bearer ")
            ? req.headers.authorization.split(" ")[1]
            : undefined;

    const cookieToken = req.cookies?.accessToken as string | undefined;
    const token = bearer ?? cookieToken;

    if (!token) {
        res.status(401).json({ message: "Not authorized, no token provided" });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
            id: string;
            jti?: string;
            iat?: number;
        };

        // Reject tokens that were explicitly revoked (logout / refresh rotation).
        if (decoded.jti) {
            const revoked = await RevokedToken.exists({ jti: decoded.jti });
            if (revoked) {
                res.status(401).json({ message: "Session has been revoked. Please log in again." });
                return;
            }
        }

        const user = await User.findById(decoded.id).select("-password");
        if (!user) {
            res.status(401).json({ message: "Not authorized, user not found" });
            return;
        }

        // If the password was changed after this token was issued, reject —
        // password change is a "log everyone out" event.
        if (decoded.iat && user.passwordChangedAt) {
            const passwordChangedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
            if (decoded.iat < passwordChangedAtSec) {
                res.status(401).json({ message: "Password changed since this session was issued. Please log in again." });
                return;
            }
        }

        req.user = user;
        next();
    } catch (error) {
        logger.error("Token verification failed:", error);
        res.status(401).json({ message: "Not authorized, token failed" });
        return;
    }
};
