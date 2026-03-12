import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

export async function sendEmail({ to, subject, html, toName = "" }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY is not set");

  const response = await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        name: "DocuSign Pro",
        email: process.env.EMAIL_USER,
      },
      to: [
        {
          email: to,
          name: toName || to,
        },
      ],
      subject,
      htmlContent: html,
    },
    {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}
