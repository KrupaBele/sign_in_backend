import express from "express";
import { sendEmail } from "../config/email.js";
import Document from "../models/Document.js";

const router = express.Router();

// Send document for signature
router.post("/send/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;
    const { recipients, message } = req.body;

    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    document.recipients = recipients;
    document.status = "sent";
    await document.save();

    const emailPromises = recipients.map((recipient) => {
      const signingUrl = `${
        process.env.CLIENT_URL || "http://localhost:5173"
      }/sign/${documentId}/${encodeURIComponent(recipient.email)}`;

      return sendEmail({
        to: recipient.email,
        toName: recipient.name,
        subject: `Please sign: ${document.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e40af;">Document Signature Request</h2>
            <p>Hello ${recipient.name},</p>
            <p>You have been requested to sign the document: <strong>${document.title}</strong></p>
            ${message ? `<p><em>${message}</em></p>` : ""}
            <div style="margin: 20px 0;">
              <a href="${signingUrl}"
                 style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Sign Document
              </a>
            </div>
            <p style="font-size: 12px; color: #666;">
              This link will expire in 30 days. If you have any questions, please contact the sender.
            </p>
          </div>
        `,
      });
    });

    await Promise.all(emailPromises);

    res.json({
      success: true,
      message: "Document sent successfully to all recipients",
    });
  } catch (error) {
    console.error("Email sending error:", error);
    res.status(500).json({
      error: "Failed to send emails",
      details: error.message,
    });
  }
});

// Send completion notification
router.post("/notify-completion/:documentId", async (req, res) => {
  try {
    const document = await Document.findById(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    const downloadUrl = `${
      process.env.SERVER_URL || "http://localhost:3001"
    }/api/documents/download/${document._id}`;

    const allEmails = [
      document.ownerEmail,
      ...document.recipients.map((r) => r.email),
    ];

    const emailPromises = allEmails.map((email) =>
      sendEmail({
        to: email,
        subject: `Document Completed: ${document.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #059669;">Document Signing Complete!</h2>
            <p>The document "<strong>${document.title}</strong>" has been signed by all parties.</p>
            <div style="margin: 20px 0;">
              <a href="${downloadUrl}"
                 style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Download Signed Document
              </a>
            </div>
            <p style="font-size: 12px; color: #666;">
              The signed document is now available for download.<br/>
              Direct link: <a href="${downloadUrl}">${downloadUrl}</a>
            </p>
          </div>
        `,
      })
    );

    await Promise.all(emailPromises);

    res.json({ success: true });
  } catch (error) {
    console.error("Notification error:", error);
    res.status(500).json({ error: "Failed to send notifications" });
  }
});

export default router;
