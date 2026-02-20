import express from 'express';
import { registerUser, loginUser, getUser, updateUser, changePassword, deleteUser, deleteUserData, forgotPassword, resetPassword, logoutUser }  from '../handlers/userHandler.js';
import { verifyToken } from '../middleware/auth.js';


const userRouter = express.Router();

userRouter.post('/login', loginUser);
userRouter.post('/register', registerUser)
userRouter.get('/user', verifyToken, getUser)
userRouter.put('/user/edit', verifyToken, updateUser)
userRouter.post('/user/changepassword', verifyToken, changePassword)
userRouter.delete('/user/delete', verifyToken, deleteUser)
userRouter.delete('/user/data', verifyToken, deleteUserData)
userRouter.post('/forgot-password', forgotPassword)
userRouter.post('/reset-password', resetPassword)
userRouter.post('/logout', verifyToken, logoutUser)

export default userRouter;