import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User, { UserInterface } from '../models/userModel.js';
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };

    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      res.status(401).json({ message: "Not authorized, user not found" });
      return;
    }

    next();
  } catch (error) {
    logger.error("Token verification failed:", error);
    res.status(401).json({ message: "Not authorized, token failed" });
    return;
  }
};