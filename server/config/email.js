import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({ from, to, subject, html }) {
  return resend.emails.send({
    from: from || `DocuSign Pro <onboarding@resend.dev>`,
    to,
    subject,
    html,
  });
}
