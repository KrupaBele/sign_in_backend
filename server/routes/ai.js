import express from "express";
import OpenAI from "openai";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const router = express.Router();

const SYSTEM_PROMPT = `You are an AI Document Assistant that helps users create professional legal and business documents.

CRITICAL — match the user's request exactly:
- If they ask for an employment offer letter, internship offer, or job offer → output an EMPLOYMENT/OFFER LETTER (not an NDA).
- If they ask for a freelance or service contract → output that contract (not an NDA).
- If they ask for an NDA or non-disclosure agreement → output an NDA.
- Never default to an NDA when the user asked for a different document type. Read their latest message and prior context for the intended document.

When a user requests a specific document, you must:
1. Confirm what you are creating in a friendly, brief message (name the exact document type).
2. Embed the full document in a <DOCUMENT> JSON block at the END of your response.

The app lets the user edit the draft before the PDF is built—output complete sections and signature_block.

JSON shape (use this structure only; fill every field with content for THE REQUESTED document, not the examples below):

<DOCUMENT>
{
  "type": "nda|contract|agreement|invoice|letter|other",
  "filename": "kebab-case-slug-for-the-file",
  "title": "DOCUMENT TITLE IN CAPS MATCHING THE REQUEST",
  "sections": [
    { "heading": "1. FIRST SECTION TITLE", "body": "Full text with \\n line breaks. Use [PLACEHOLDERS] where the user must fill details." }
  ],
  "signature_block": "Signature lines appropriate to THIS document (e.g. employer + candidate for offer letters; both parties for bilateral contracts)"
}
</DOCUMENT>

Section outlines (follow the one that matches the request; use clear numbered headings):

NDA / Non-Disclosure Agreement:
PARTIES, PURPOSE, DEFINITION OF CONFIDENTIAL INFORMATION, OBLIGATIONS OF RECEIVING PARTY, EXCLUSIONS, TERM, RETURN OR DESTRUCTION, NO LICENSE, NO WARRANTY, REMEDIES, GENERAL PROVISIONS, then signature_block for disclosing and receiving parties.

Freelance / Service Agreement:
Scope of Work, Payment Terms, Intellectual Property, Confidentiality, Termination, Limitation of Liability, General Provisions + signature_block for client and provider.

Employment Offer Letter (when user asks for job/employment/offer letter):
Opening (company, candidate name, offer of position), Position & Reporting, Start Date & Location, Compensation (salary/wage, pay schedule), Benefits summary (or reference to handbook), At-Will / employment status (if applicable), Conditions (background check, I-9, etc.), Confidentiality / IP (brief), Acceptance instructions + signature_block for employer representative and candidate.

Other agreements: infer appropriate sections from the user's request and industry norms.

Include [PLACEHOLDER] tokens ([DATE], [COMPANY NAME], [CANDIDATE NAME], [JURISDICTION], etc.) where details are unknown.
Be thorough and professional.

If the user is chatting or asking a question (NOT requesting a document), respond normally WITHOUT any <DOCUMENT> block.`;

// POST /api/ai/chat
router.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GROQ_API_KEY is not configured. Please add it to your .env file.",
    });
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-12),
    { role: "user", content: message },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.4,
      max_tokens: 4096,
    });

    const raw = completion.choices[0].message.content || "";

    // Extract <DOCUMENT> block if present
    const docMatch = raw.match(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/);
    const botMessage = raw.replace(/<DOCUMENT>[\s\S]*?<\/DOCUMENT>/, "").trim();

    let documentDraft = null;

    if (docMatch) {
      try {
        documentDraft = JSON.parse(docMatch[1].trim());
      } catch (parseErr) {
        console.error("Document JSON parse error:", parseErr);
      }
    }

    res.json({
      message:
        botMessage ||
        (documentDraft
          ? "Review and edit the draft below, then generate your PDF when ready."
          : ""),
      documentDraft,
    });
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).json({ error: err.message || "AI request failed" });
  }
});

// POST /api/ai/pdf — build PDF from client-edited document structure
router.post("/pdf", async (req, res) => {
  const { document: docInfo } = req.body;

  if (!docInfo || typeof docInfo !== "object") {
    return res.status(400).json({ error: "document object is required" });
  }

  try {
    const normalized = {
      ...docInfo,
      title: docInfo.title || "Document",
      filename: docInfo.filename || "document",
      sections: Array.isArray(docInfo.sections) ? docInfo.sections : [],
    };

    const pdfBytes = await generatePDF(normalized);
    res.json({
      document: {
        name: `${String(normalized.filename).replace(/\.pdf$/i, "")}.pdf`,
        title: normalized.title || "Generated Document",
        data: Buffer.from(pdfBytes).toString("base64"),
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: err.message || "PDF generation failed" });
  }
});

// ─── PDF Generator ────────────────────────────────────────────────────────────

async function generatePDF(docInfo) {
  const pdfDoc = await PDFDocument.create();

  const regularFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;
  const MARGIN = 72;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const TITLE_SIZE = 16;
  const HEADING_SIZE = 11;
  const BODY_SIZE = 10;
  const LINE_HEIGHT_BODY = BODY_SIZE * 1.55;
  const LINE_HEIGHT_HEADING = HEADING_SIZE * 1.8;

  let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNumber = 1;

  const addPage = () => {
    drawPageNumber(currentPage, regularFont, pageNumber, PAGE_W, MARGIN);
    pageNumber++;
    currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const ensureSpace = (needed) => {
    if (y - needed < MARGIN + 30) {
      addPage();
    }
  };

  // Wrap text to fit CONTENT_W, returning array of lines
  const wrapText = (text, font, size, indent = 0) => {
    const maxW = CONTENT_W - indent;
    const paragraphs = text.split("\n");
    const result = [];
    for (const para of paragraphs) {
      if (!para.trim()) {
        result.push("");
        continue;
      }
      const words = para.split(" ");
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) > maxW && line) {
          result.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) result.push(line);
    }
    return result;
  };

  const drawLine = (text, font, size, x, lineH) => {
    ensureSpace(lineH);
    currentPage.drawText(text, {
      x,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineH;
  };

  // ── Title ──────────────────────────────────────────────────────────────────
  const title = (docInfo.title || "DOCUMENT").toUpperCase();
  const titleLines = wrapText(title, boldFont, TITLE_SIZE);
  for (const line of titleLines) {
    const lineW = boldFont.widthOfTextAtSize(line, TITLE_SIZE);
    ensureSpace(TITLE_SIZE * 2);
    currentPage.drawText(line, {
      x: MARGIN + (CONTENT_W - lineW) / 2,
      y,
      size: TITLE_SIZE,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= TITLE_SIZE * 1.6;
  }
  y -= 12;

  // ── Horizontal rule under title ────────────────────────────────────────────
  currentPage.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.8,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 16;

  // ── Sections ───────────────────────────────────────────────────────────────
  const sections = docInfo.sections || [];
  for (const section of sections) {
    const headingText =
      typeof section.heading === "string" ? section.heading.trim() : "";
    const hasHeading = headingText.length > 0;

    // Section heading (skip whitespace-only)
    if (hasHeading) {
      ensureSpace(LINE_HEIGHT_HEADING + 4);
      y -= 6;
      const headLines = wrapText(headingText, boldFont, HEADING_SIZE);
      for (const hl of headLines) {
        drawLine(hl, boldFont, HEADING_SIZE, MARGIN, LINE_HEIGHT_HEADING);
      }
      y -= 2;
    }

    // Section body: full-width paragraphs when there is no heading; slight indent under a heading
    const rawBody = typeof section.body === "string" ? section.body : "";
    if (rawBody.trim()) {
      if (!hasHeading) {
        ensureSpace(LINE_HEIGHT_BODY);
        y -= 4;
      }
      const bodyX = MARGIN + (hasHeading ? 12 : 0);
      const bodyLines = wrapText(
        rawBody,
        regularFont,
        BODY_SIZE,
        bodyX - MARGIN
      );
      for (const bl of bodyLines) {
        if (bl === "") {
          y -= LINE_HEIGHT_BODY * 0.65;
        } else {
          drawLine(bl, regularFont, BODY_SIZE, bodyX, LINE_HEIGHT_BODY);
        }
      }
      y -= 6;
    }
  }

  // ── Signature Block ────────────────────────────────────────────────────────
  if (docInfo.signature_block) {
    y -= 12;
    ensureSpace(LINE_HEIGHT_HEADING + 4);
    currentPage.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= 14;

    drawLine("SIGNATURES", boldFont, HEADING_SIZE, MARGIN, LINE_HEIGHT_HEADING);
    y -= 4;

    const sigLines = wrapText(docInfo.signature_block, italicFont, BODY_SIZE);
    for (const sl of sigLines) {
      if (sl === "") {
        y -= LINE_HEIGHT_BODY * 0.6;
      } else {
        drawLine(sl, italicFont, BODY_SIZE, MARGIN + 12, LINE_HEIGHT_BODY);
      }
    }
  }

  // Footer on last page
  drawPageNumber(currentPage, regularFont, pageNumber, PAGE_W, MARGIN);

  return pdfDoc.save();
}

function drawPageNumber(page, font, num, pageW, margin) {
  try {
    page.drawText(`Page ${num}`, {
      x: pageW / 2 - 18,
      y: margin / 2,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  } catch (_) {
    // ignore
  }
}

export default router;
