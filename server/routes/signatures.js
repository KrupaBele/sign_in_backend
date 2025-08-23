import express from "express";
import Document from "../models/Document.js";
import { generateSignedPDF } from "../utils/pdfGenerator.js";

const router = express.Router();

// Add signature to document
router.post("/:documentId/sign", async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signerEmail, signerName, signatureData, position } = req.body;

    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Add signature to document
    document.signatures.push({
      signerEmail,
      signerName,
      signatureData,
      position,
      signedAt: new Date(),
      status: "signed",
    });

    // Update recipient status (only once per recipient)
    const recipient = document.recipients.find((r) => r.email === signerEmail);
    if (recipient && recipient.status !== "signed") {
      recipient.status = "signed";
    }

    // Check if all recipients have signed
    const allSigned = document.recipients.every((r) => r.status === "signed");
    console.log("All recipients signed:", allSigned);

    if (allSigned) {
      document.status = "completed";
      document.completedAt = new Date();

      // Generate signed PDF
      try {
        console.log("Generating signed PDF...");
        const signedPdfUrl = await generateSignedPDF(document);
        console.log("Signed PDF generated:", signedPdfUrl);
        document.signedUrl = signedPdfUrl;
      } catch (pdfError) {
        console.error("PDF generation error:", pdfError);
        // Continue without failing the signature process
      }
    }

    await document.save();

    res.json({
      success: true,
      document,
      allSigned,
    });
  } catch (error) {
    console.error("Signature error:", error);
    res.status(500).json({ error: "Failed to add signature" });
  }
});

// Get signing page data
router.get("/sign/:documentId/:email", async (req, res) => {
  try {
    const { documentId, email } = req.params;

    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if this email is authorized to sign
    const recipient = document.recipients.find((r) => r.email === email);
    if (!recipient) {
      return res
        .status(403)
        .json({ error: "Not authorized to sign this document" });
    }

    // Check if already signed
    const existingSignature = document.signatures.find(
      (s) => s.signerEmail === email
    );
    if (existingSignature) {
      return res
        .status(400)
        .json({ error: "Document already signed by this user" });
    }

    res.json({
      document: {
        id: document._id,
        title: document.title,
        originalUrl: document.originalUrl,
        note: document.note,
      },
      recipient,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch signing data" });
  }
});

export default router;

// import express from "express";
// import Document from "../models/Document.js";
// import { generateSignedPDF } from "../utils/pdfGenerator.js";

// const router = express.Router();

// // Add temporary signature (for multiple signatures before finishing)
// router.post("/:documentId/add-temp", async (req, res) => {
//   try {
//     console.log("Add temp signature request:", req.params.documentId, req.body);
//     const { documentId } = req.params;
//     const { signerEmail, signerName, signatureData, position } = req.body;

//     if (!signerEmail || !signerName || !signatureData || !position) {
//       console.error("Missing required fields:", {
//         signerEmail,
//         signerName,
//         signatureData: !!signatureData,
//         position,
//       });
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     const document = await Document.findById(documentId);
//     if (!document) {
//       console.error("Document not found:", documentId);
//       return res.status(404).json({ error: "Document not found" });
//     }

//     // Add signature to document (but don't mark as complete yet)
//     document.signatures.push({
//       signerEmail,
//       signerName,
//       signatureData,
//       position,
//       signedAt: new Date(),
//       status: "pending", // Keep as pending until user finishes
//     });

//     await document.save();
//     console.log(
//       "Signature added successfully, total signatures:",
//       document.signatures.length
//     );

//     res.json({
//       success: true,
//       document,
//     });
//   } catch (error) {
//     console.error("Add signature error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to add signature", details: error.message });
//   }
// });

// // Remove last signature for a user
// router.delete("/:documentId/remove-last/:email", async (req, res) => {
//   try {
//     console.log("Remove last signature request:", req.params);
//     const { documentId, email } = req.params;

//     const document = await Document.findById(documentId);
//     if (!document) {
//       console.error("Document not found for removal:", documentId);
//       return res.status(404).json({ error: "Document not found" });
//     }

//     // Find and remove the last signature for this user
//     const userSignatures = document.signatures.filter(
//       (sig) => sig.signerEmail === email
//     );
//     if (userSignatures.length > 0) {
//       const lastSignature = userSignatures[userSignatures.length - 1];
//       const lastSignatureIndex = document.signatures.findIndex(
//         (sig) =>
//           sig.signerEmail === email &&
//           sig.signedAt.getTime() === lastSignature.signedAt.getTime()
//       );
//       if (lastSignatureIndex > -1) {
//         document.signatures.splice(lastSignatureIndex, 1);
//       }
//       await document.save();
//       console.log(
//         "Last signature removed, remaining signatures:",
//         document.signatures.length
//       );
//     }

//     res.json({ success: true });
//   } catch (error) {
//     console.error("Remove signature error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to remove signature", details: error.message });
//   }
// });

// // Finish signing (mark all user's signatures as complete)
// router.post("/:documentId/finish", async (req, res) => {
//   try {
//     console.log("Finish signing request:", req.params.documentId, req.body);
//     const { documentId } = req.params;
//     const { signerEmail } = req.body;

//     const document = await Document.findById(documentId);
//     if (!document) {
//       console.error("Document not found for finishing:", documentId);
//       return res.status(404).json({ error: "Document not found" });
//     }

//     // Check if user has any signatures
//     const userSignatures = document.signatures.filter(
//       (sig) => sig.signerEmail === signerEmail
//     );
//     if (userSignatures.length === 0) {
//       console.error("No signatures found for user:", signerEmail);
//       return res
//         .status(400)
//         .json({ error: "No signatures found for this user" });
//     }

//     // Mark all signatures from this user as signed
//     document.signatures.forEach((sig) => {
//       if (sig.signerEmail === signerEmail) {
//         sig.status = "signed";
//       }
//     });

//     // Update recipient status
//     const recipient = document.recipients.find((r) => r.email === signerEmail);
//     if (recipient) {
//       recipient.status = "signed";
//     }

//     // Check if all recipients have signed
//     const allSigned = document.recipients.every((r) => r.status === "signed");
//     console.log("All recipients signed:", allSigned);

//     if (allSigned) {
//       document.status = "completed";
//       document.completedAt = new Date();

//       // Generate signed PDF
//       try {
//         console.log("Generating signed PDF...");
//         const signedPdfUrl = await generateSignedPDF(document);
//         console.log("Signed PDF generated:", signedPdfUrl);
//         document.signedUrl = signedPdfUrl;
//       } catch (pdfError) {
//         console.error("PDF generation error:", pdfError);
//         // Continue without failing the signature process
//       }
//     }

//     await document.save();
//     console.log("Signing finished successfully");

//     res.json({
//       success: true,
//       document,
//       allSigned,
//     });
//   } catch (error) {
//     console.error("Finish signing error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to finish signing", details: error.message });
//   }
// });

// // Add signature to document (legacy route for direct signing)
// router.post("/:documentId/sign", async (req, res) => {
//   try {
//     console.log("Direct sign request:", req.params.documentId, req.body);
//     const { documentId } = req.params;
//     const { signerEmail, signerName, signatureData, position } = req.body;

//     const document = await Document.findById(documentId);
//     if (!document) {
//       console.error("Document not found for direct signing:", documentId);
//       return res.status(404).json({ error: "Document not found" });
//     }

//     // Add signature to document
//     document.signatures.push({
//       signerEmail,
//       signerName,
//       signatureData,
//       position,
//       signedAt: new Date(),
//       status: "signed",
//     });

//     // Update recipient status
//     const recipient = document.recipients.find((r) => r.email === signerEmail);
//     if (recipient) {
//       recipient.status = "signed";
//     }

//     // Check if all recipients have signed
//     const allSigned = document.recipients.every((r) => r.status === "signed");
//     console.log("All recipients signed:", allSigned);

//     if (allSigned) {
//       document.status = "completed";
//       document.completedAt = new Date();

//       // Generate signed PDF
//       try {
//         console.log("Generating signed PDF...");
//         const signedPdfUrl = await generateSignedPDF(document);
//         console.log("Signed PDF generated:", signedPdfUrl);
//         document.signedUrl = signedPdfUrl;
//       } catch (pdfError) {
//         console.error("PDF generation error:", pdfError);
//         // Continue without failing the signature process
//       }
//     }

//     await document.save();
//     console.log("Direct signing completed successfully");

//     res.json({
//       success: true,
//       document,
//       allSigned,
//     });
//   } catch (error) {
//     console.error("Signature error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to add signature", details: error.message });
//   }
// });

// // Get signing page data
// router.get("/sign/:documentId/:email", async (req, res) => {
//   try {
//     console.log("Get signing data request:", req.params);
//     const { documentId, email } = req.params;

//     const document = await Document.findById(documentId);
//     if (!document) {
//       console.error("Document not found for signing data:", documentId);
//       return res.status(404).json({ error: "Document not found" });
//     }

//     // Check if this email is authorized to sign
//     const recipient = document.recipients.find((r) => r.email === email);
//     if (!recipient) {
//       console.error("Unauthorized email for signing:", email);
//       return res
//         .status(403)
//         .json({ error: "Not authorized to sign this document" });
//     }

//     // Allow users with pending signatures to continue adding more
//     const userSignatures = document.signatures.filter(
//       (s) => s.signerEmail === email
//     );
//     const completedSignatures = userSignatures.filter(
//       (s) => s.status === "signed"
//     );

//     if (completedSignatures.length > 0 && recipient.status === "signed") {
//       console.log("User has already completed signing");
//       return res
//         .status(400)
//         .json({ error: "Document already signed by this user" });
//     }

//     console.log("Signing data retrieved successfully");
//     res.json({
//       document,
//       recipient,
//     });
//   } catch (error) {
//     console.error("Get signing data error:", error);
//     res.status(500).json({ error: "Failed to fetch signing data" });
//   }
// });

// export default router;
