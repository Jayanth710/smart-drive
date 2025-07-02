import { Request, Response } from 'express';
import User from '../models/userModel.js';
import logger from '../logger.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import validator from "validator"
import { AuthenticatedRequest } from '../middleware/auth.js';

const generateAccessToken = (id: string) => {
    return jwt.sign({ id }, process.env.JWT_SECRET!, {
        expiresIn: '1d', // Expires in 15 minutes
    });
};

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
            res.json({ success: false, message: "Enter correct password" })
        }

        const accessToken = generateAccessToken(user._id.toString());
        const refreshToken = await generaterefreshToken(user._id.toString());

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV !== 'development',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000,
        });

        res.json({
            _id: user._id,
            email: user.email,
            accessToken: accessToken,
        });

    } catch (error) {
        logger.error('Login Error:', error);
        res.status(500).json({ message: 'Server Error' });
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
            res.status(400).send({ success: false, message: "Enter valid email" })
        }
        if (!validator.isStrongPassword(data.password)) {
            res.status(400).send({ success: false, message: "Enter strong password" });
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

        res.status(200).json({ success: true, message: 'User registered successfully' });
    }
    catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Server Error' });
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

const editUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?._id
        console.log("userId:", userId);
        console.log("body:", req.body);

        const { firstName, lastName, phone } = req.body
        console.log(req.body)

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

export {
    loginUser,
    registerUser,
    getUser,
    editUser
}
