import { Request, Response } from 'express';
import User from '../models/userModel.js';
import logger from '../logger.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import validator from "validator"
import { AuthenticatedRequest } from '../middleware/auth.js';
import UserFile from '../models/userFileModel.js';
import { bucket } from '../services/gcsUpload.js';
import { deleteWeaviateUser } from '../services/queryWeaviate.js';
import UserResetPassword from '../models/userResetPasswordModel.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

const generateAccessToken = (id: string) => {
    return jwt.sign({ id }, process.env.JWT_SECRET!, {
        expiresIn: '1d', // Expires in 15 minutes
    });
};

const FRONT_END_URL = 'https://smart-drive-eta.vercel.app'
const generaterefreshToken = async (id: string) => {
    return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET!, {
        expiresIn: '1d',
    });
}

const loginUser = async (req: Request, res: Response) => {

    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });

        if (!user) {
            logger.error(`${email} is not found`)
            res.status(404).json({ message: 'User not found' });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if (!isMatch) {
            res.status(401).send({ message: "Enter correct password" })
            return
        }

        const accessToken = generateAccessToken(user._id.toString());
        const refreshToken = await generaterefreshToken(user._id.toString());

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV !== 'development',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000,
        });

        logger.info(`User logged in successfully: ${email}`);

        res.status(200).send({
            _id: user._id,
            email: user.email,
            accessToken: accessToken,
        });

    } catch (error) {
        logger.error('Login Error:', error);
        res.status(500).json({ message: 'Server Error' });
        return
    }
};

const registerUser = async (req: Request, res: Response) => {
    const data = req.body;

    try {
        const userExists = await User.findOne({ email: data.email });

        if (userExists) {
            logger.error(`${data.email} is already registered`);
            res.status(400).json({ message: 'User already registered' });
            return;
        }

        if (!validator.isEmail(data.email)) {
            res.status(400).send({ message: "Enter valid email" })
            return
        }
        if (!validator.isStrongPassword(data.password)) {
            logger.info('Enter Strong Password')
            res.status(400).send({ message: "Enter strong password" });
            return
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(data.password, salt);

        const newUser = new User({
            email: data.email,
            password: hashedPassword,
            firstName: data.firstname,
            lastName: data.lastname,
            phone: data.phone,
        });

        const user = await newUser.save();

        logger.info(`New User Created: ${user._id}`);

        res.status(201).json({ message: 'User registered successfully' });
        return
    }
    catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Server Error' });
        return
    }
}

const getUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userDetails = req.user;

        if (userDetails) {
            res.status(200).json({ message: 'User details fetched successfully', data: userDetails });
        }
        else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
}

const updateUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?._id

        const { firstName, lastName, phone } = req.body

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
            return
        }

        res.status(200).json({
            message: 'User updated successfully',
            data: updatedUser
        });

    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Server error' });
    }
}

const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?._id.toString();

        const user = await User.findById(userId)
        if (!user) {
            res.status(404).send({ message: 'User Not Found' })
            return;
        }

        const { currentPassword, newPassword } = req.body

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            res.status(400).json({ message: "Wrong current password" });
            return
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        logger.info('Password changed successfully')

        res.status(200).send({ message: "Password changed successfully" });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ message: 'Server error' });
    }
}

const deleteUser = async (req: AuthenticatedRequest, res: Response) => {

    const userId = req.user?._id.toString()
    if (!userId) {
        res.status(401).send({ message: 'Authentication error' });
        return
    }
    try {
        const user = await User.findById(userId)
        if (!user) {
            res.status(404).send({ message: 'User Not Found' })
            return;
        }

        console.log(`Deleting GCS folder for user ${userId}...`);
        await bucket.deleteFiles({ prefix: `${userId}/` });
        console.log(`GCS folder for user ${userId} deleted successfully.`);

        console.log(`Deleting Weaviate data for user ${userId}...`);



        await deleteWeaviateUser(userId!)
        console.log(`Weaviate data for user ${userId} deleted successfully.`);

        console.log(`Deleting UserFile documents for user ${userId}...`);
        await UserFile.deleteMany({ userId: userId });
        console.log(`UserFile documents for user ${userId} deleted successfully.`);

        console.log(`Deleting user record for ${userId}...`);
        await User.findByIdAndDelete(userId);
        console.log(`User record ${userId} deleted successfully.`);

        res.status(200).send({ message: 'Account and all associated data have been successfully deleted.' });

    } catch (error) {
        console.error('Error deleting the account', error);
        res.status(500).json({ message: 'Error occured during deletion of account.' });
        return
    }
}

const forgotPassword = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body
    if (!email) {
        logger.error(`${email} not found.`)
        res.status(404).send({ message: 'Email not found.' })
        return
    }

    try {
        const user = await User.findOne({ email })
        if (!user) {
            logger.error(`User Not Found with the email: ${email}.`)
            res.status(404).send({ message: `No User found with email: ${email}` })
            return
        }

        const token = generateAccessToken(user?._id.toString())

        await new UserResetPassword({
            userId: user?._id,
            token: token,
            expiresAt: Date.now() + 10 * 60 * 1000
        }).save()

        const resetUrl = `${FRONT_END_URL}/reset-password?token=${token}`;
        await sendPasswordResetEmail("vunnamjayanth7@gmail.com", resetUrl)
        res.status(200).json({ message: `A reset link has been sent to ${email}.` });
        return
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'a reset link hasnot been sent.' });
        return
    }
}

const resetPassword = async (req: Request, res: Response): Promise<void> => {
    const { token, password } = req.body

    try {
        const userRecord = await UserResetPassword.findOne({
            token: token,
            expiresAt: { $gt: Date.now() },
        });

        if (!userRecord) {
            res.status(400).json({ message: 'Password reset token is invalid or has expired.' });
            return;
        }

        const user = await User.findById(userRecord.userId);
        if (!user) {
            res.status(400).json({ message: 'User associated with this token no longer exists.' });
            return
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();

        await UserResetPassword.findByIdAndDelete(userRecord._id);

        res.status(200).json({ message: 'Password has been reset successfully. You can now log in.' });
        return

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
        return
    }
}

export {
    loginUser,
    registerUser,
    getUser,
    updateUser,
    changePassword,
    deleteUser,
    forgotPassword,
    resetPassword
}
