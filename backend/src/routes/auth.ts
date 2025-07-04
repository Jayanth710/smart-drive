import express from 'express';
import { registerUser, loginUser, getUser, updateUser }  from '../handlers/userHandler.js';
import { verifyToken } from '../middleware/auth.js';


const userRouter = express.Router();

userRouter.post('/login', loginUser);
userRouter.post('/register', registerUser)
userRouter.get('/user', verifyToken, getUser)
userRouter.put('/user/edit', verifyToken, updateUser)

export default userRouter;