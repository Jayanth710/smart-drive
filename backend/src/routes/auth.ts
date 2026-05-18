import express from 'express';
import {
    registerUser,
    loginUser,
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
} from '../handlers/userHandler.js';
import { verifyToken } from '../middleware/auth.js';
import { loginLimiter, registerLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';

const userRouter = express.Router();

userRouter.post('/login', loginLimiter, loginUser);
userRouter.post('/register', registerLimiter, registerUser);
userRouter.post('/refresh', refreshSession);
userRouter.get('/user', verifyToken, getUser);
userRouter.put('/user/edit', verifyToken, updateUser);
userRouter.post('/user/changepassword', verifyToken, changePassword);
userRouter.delete('/user/delete', verifyToken, deleteUser);
userRouter.delete('/user/data', verifyToken, deleteUserData);
userRouter.post('/forgot-password', passwordResetLimiter, forgotPassword);
userRouter.post('/reset-password', passwordResetLimiter, resetPassword);
userRouter.post('/verify-email', verifyEmail);
userRouter.post('/resend-verification', verifyToken, resendVerification);
userRouter.post('/logout', logoutUser);

export default userRouter;
