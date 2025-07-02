import express from 'express';
import { registerUser, loginUser, getUser, editUser }  from '../handlers/userHandler.js';
import { verifyToken } from '../middleware/auth.js';


const userRouter = express.Router();

// userRouter.post('/signup', createUser);
userRouter.post('/login', loginUser);
userRouter.post('/register', registerUser)
userRouter.get('/user', verifyToken, getUser)
userRouter.put('/user/edit', verifyToken, editUser)
// userRouter.get('/user/:id', verifyToken, getUserById);
// userRouter.get('/user/:email', getUserByEmail);
// userRouter.put('/user/:id', verifyToken, updateUser);

export default userRouter;