
import nodemailer from "nodemailer";
import logger from "../logger.js";

export const sendPasswordResetEmail = async (to: string, resetLink: string) => {
  if(!process.env.GMAIL_USER || process.env.GMAIL_APP_PASSWOR){
    logger.error("Credentails for nodemailer GMAIL_USER, GMAIL_APP_PASSWOR are missing ");
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER || "yourgmail@gmail.com",
        pass: process.env.GMAIL_APP_PASSWORD || ""
      }
    });

    const mailOptions = {
      from: process.env.GMAIL_USER || "yourgmail@gmail.com",
      to,
      subject: "Reset your SmartDrive password",
      html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #0056b3;">Reset Your Password</h2>
          <p>Hello,</p>
          <p>We received a request to reset the password for your SmartDrive account. Please click the button below to set a new password. This link is valid for 15 minutes.</p>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">Reset Password</a>
          </div>
          <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #888;">This is an automated message, please do not reply.</p>
        </div>
      </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${to} | messageId: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("Gmail SMTP error sending email:", error);
    return false;
  }
};
