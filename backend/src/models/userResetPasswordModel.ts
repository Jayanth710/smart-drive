import mongoose, { Date } from "mongoose";

export interface IuserResetPassword extends mongoose.Document {
    _id: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    token: string,
    expiresAt: Date
}

const userResetPasswordSchema = new mongoose.Schema (

    {
         userId: {
            type: mongoose.Types.ObjectId,
            ref: "User",
            required: true
         },
         token: {
            type: String,
            required: true,
         },
         expiresAt: {
            type: Date,
            required: true,
            expires: 0
         }
    }
)

const UserResetPassword = mongoose.model('UserResetPassword', userResetPasswordSchema)

export default UserResetPassword;