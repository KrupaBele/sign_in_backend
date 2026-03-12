import nodemailer from "nodemailer";

// Create transporter lazily so it always uses the current env vars.
// Creating it at module load time with ESM can cause it to capture
// undefined credentials due to import hoisting order.
export function createTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}
