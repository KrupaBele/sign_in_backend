import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,   // your Brevo account email
    pass: process.env.BREVO_PASS,   // Brevo SMTP key (not your login password)
  },
});

export default transporter;
