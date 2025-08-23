import { PDFDocument, rgb } from "pdf-lib";
import axios from "axios";
import cloudinary from "../config/cloudinary.js";

export async function generateSignedPDF(document) {
  try {
    console.log("Starting PDF generation for document:", document._id);

    // Download the original PDF
    const response = await axios.get(document.originalUrl, {
      responseType: "arraybuffer",
    });

    const pdfDoc = await PDFDocument.load(response.data);
    const pages = pdfDoc.getPages();

    console.log("PDF loaded, pages:", pages.length);
    console.log("Signatures to add:", document.signatures.length);

    // Add signatures to the PDF
    for (const signature of document.signatures) {
      console.log("Processing signature:", signature.signerName);
      console.log("Signature position:", signature.position);

      if (signature.position && signature.signatureData) {
        const pageIndex = signature.position.page || 0;

        if (pageIndex < pages.length) {
          const page = pages[pageIndex];
          const { width: pageWidth, height: pageHeight } = page.getSize();

          console.log("Page dimensions:", { pageWidth, pageHeight });

          try {
            // Extract base64 data from signature
            const base64Data = signature.signatureData.includes(",")
              ? signature.signatureData.split(",")[1]
              : signature.signatureData;

            // Convert base64 to bytes
            const signatureImageBytes = Uint8Array.from(atob(base64Data), (c) =>
              c.charCodeAt(0)
            );

            // Embed the signature image
            let signatureImage;
            try {
              signatureImage = await pdfDoc.embedPng(signatureImageBytes);
            } catch (pngError) {
              console.log(
                "PNG embedding failed, trying JPEG:",
                pngError.message
              );
              signatureImage = await pdfDoc.embedJpg(signatureImageBytes);
            }

            // Calculate signature dimensions
            const signatureWidth = 120;
            const signatureHeight = 40;

            // FIXED COORDINATE CONVERSION:
            // The key issue was that we need to account for the actual rendered size
            // In our scrollable view, each page maintains its aspect ratio within 600px width
            const aspectRatio = pageHeight / pageWidth;
            const displayWidth = 600;
            const displayHeight = displayWidth * aspectRatio;

            // Calculate the scale factors
            const scaleX = pageWidth / displayWidth;
            const scaleY = pageHeight / displayHeight;

            // Convert coordinates - PDF uses bottom-left origin, web uses top-left
            const pdfX = signature.position.x * scaleX;
            const pdfY = pageHeight - signature.position.y * scaleY;

            // Center the signature around the click point
            const finalX = Math.max(
              0,
              Math.min(pageWidth - signatureWidth, pdfX - signatureWidth / 2)
            );
            const finalY = Math.max(
              0,
              Math.min(pageHeight - signatureHeight, pdfY - signatureHeight / 2)
            );

            console.log("Coordinate conversion:", {
              clickX: signature.position.x,
              clickY: signature.position.y,
              pageWidth,
              pageHeight,
              displayWidth,
              displayHeight,
              scaleX,
              scaleY,
              pdfX,
              pdfY,
              finalX,
              finalY,
            });

            // Draw the signature image
            page.drawImage(signatureImage, {
              x: finalX,
              y: finalY,
              width: signatureWidth,
              height: signatureHeight,
            });

            // Add signer name below signature
            page.drawText(`Signed by: ${signature.signerName}`, {
              x: finalX,
              y: finalY - 15,
              size: 8,
              color: rgb(0.3, 0.3, 0.3),
            });

            // Add timestamp
            const signedDate = new Date(
              signature.signedAt
            ).toLocaleDateString();
            page.drawText(`Date: ${signedDate}`, {
              x: finalX,
              y: finalY - 28,
              size: 7,
              color: rgb(0.5, 0.5, 0.5),
            });

            console.log("Signature added successfully to page", pageIndex);
          } catch (imageError) {
            console.error("Error embedding signature image:", imageError);

            // Fallback: Add text signature if image fails
            const fallbackX = signature.position.x * scaleX;
            const fallbackY = pageHeight - signature.position.y * scaleY;

            page.drawText(`[Signature: ${signature.signerName}]`, {
              x: Math.max(0, Math.min(pageWidth - 200, fallbackX)),
              y: Math.max(20, Math.min(pageHeight - 20, fallbackY)),
              size: 12,
              color: rgb(0, 0, 1),
            });
          }
        } else {
          console.warn(
            "Invalid page index:",
            pageIndex,
            "for document with",
            pages.length,
            "pages"
          );
        }
      } else {
        console.warn("Signature missing position or data:", signature);
      }
    }

    // Save the modified PDF
    const pdfBytes = await pdfDoc.save();
    console.log("PDF saved, size:", pdfBytes.length, "bytes");

    // Upload signed PDF to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "raw",
          folder: "signed-documents",
          format: "pdf",
          public_id: `signed_${document._id}_${Date.now()}`,
          flags: "attachment",
        },
        (error, result) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            reject(error);
          } else {
            console.log("Cloudinary upload success:", result.secure_url);
            resolve(result);
          }
        }
      );

      uploadStream.end(Buffer.from(pdfBytes));
    });

    return uploadResult.secure_url;
  } catch (error) {
    console.error("PDF generation error:", error);
    throw error;
  }
}
