import mongoose from "mongoose";

export interface UserInterface extends mongoose.Document {
  _id: mongoose.Schema.Types.ObjectId;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}


const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true
      },
      lastName: {
        type: String,
        required: true,
        trim: true
      },
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
      },
      password: {
        type: String,
        required: true
      },
      phone: {
        type: String,
        required: false,
        match: [/^\d{10}$/, "Phone number must be 10 digits"]
      }
    }, {
      timestamps: true
});

const User = mongoose.model<UserInterface>('User', userSchema);

export default User;
