import express from "express";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import Document from "../models/Document.js";

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Upload document
router.post("/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { title, ownerEmail, note } = req.body;

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            resource_type: "raw",
            folder: "docusign-documents",
            format: req.file.originalname.split(".").pop(),
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(req.file.buffer);
    });

    // Save document metadata to MongoDB
    const document = new Document({
      title,
      originalUrl: uploadResult.secure_url,
      cloudinaryId: uploadResult.public_id,
      ownerEmail,
      note,
    });

    await document.save();

    res.json({
      success: true,
      document: {
        id: document._id,
        title: document.title,
        originalUrl: document.originalUrl,
        status: document.status,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// Get document by ID
router.get("/:id", async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    console.log("Document fetched:", {
      id: document._id,
      signatures: document.signatures.length,
      signedUrl: document.signedUrl ? "exists" : "none",
    });
    res.json(document);
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// Get all documents for a user
router.get("/user/:email", async (req, res) => {
  try {
    const documents = await Document.find({
      ownerEmail: req.params.email,
    }).sort({ createdAt: -1 });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// Update document with recipients
router.put("/:id/recipients", async (req, res) => {
  try {
    const { recipients } = req.body;
    const document = await Document.findByIdAndUpdate(
      req.params.id,
      { recipients },
      { new: true }
    );
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: "Failed to update recipients" });
  }
});

// Delete document
router.delete("/:id", async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(document.cloudinaryId);

    // Delete from MongoDB
    await Document.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// Download signed document
router.get("/download/:id", async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if document is completed and has signed URL
    if (document.status !== "completed" || !document.signedUrl) {
      return res.status(400).json({ error: "Signed document not available" });
    }

    // Redirect to the signed PDF URL
    res.redirect(document.signedUrl);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Failed to download document" });
  }
});

export default router;
