import mongoose from "mongoose";

export interface UserInterface extends mongoose.Document {
  _id: mongoose.Schema.Types.ObjectId;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;

  // Security state
  passwordChangedAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;

  // Email verification
  emailVerified: boolean;
  emailVerificationToken?: string | null;
  emailVerificationExpiresAt?: Date | null;
}

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    phone: {
      type: String,
      required: false,
      match: [/^\d{10}$/, "Phone number must be 10 digits"],
    },

    // Bumped whenever the password changes so old tokens (with smaller iat) can be rejected.
    // No schema default — we set it explicitly only at registration and on password
    // change. A default like `() => new Date()` would re-evaluate on every hydration
    // (Mongoose 8), making the field "now" on each load and silently invalidating
    // every just-issued token.
    passwordChangedAt: { type: Date },

    // Per-account brute-force protection. Cleared on successful login.
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    // Email verification. Soft-enforced today (login still works) so we can
    // tighten it later without locking out existing users.
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const User = mongoose.model<UserInterface>("User", userSchema);

export default User;
