import express from "express";
import OpenAI from "openai";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const router = express.Router();

const SYSTEM_PROMPT = `You are an AI Document Assistant that helps users create professional legal and business documents.

When a user requests a specific document (NDA, contract, agreement, letter, etc.), you must:
1. Confirm what you are creating in a friendly, brief message.
2. Embed the full document in a <DOCUMENT> JSON block at the END of your response.

The <DOCUMENT> block must be valid JSON in this exact format:
<DOCUMENT>
{
  "type": "nda|contract|agreement|invoice|letter|other",
  "filename": "non-disclosure-agreement",
  "title": "NON-DISCLOSURE AGREEMENT",
  "sections": [
    { "heading": "1. PARTIES", "body": "This Non-Disclosure Agreement (\"Agreement\") is entered into as of [DATE] by and between:\n\nDisclosing Party: [COMPANY/INDIVIDUAL NAME], located at [ADDRESS] (\"Disclosing Party\")\n\nReceiving Party: [COMPANY/INDIVIDUAL NAME], located at [ADDRESS] (\"Receiving Party\")" },
    { "heading": "2. PURPOSE", "body": "The parties wish to explore a potential business relationship and in connection with this, the Disclosing Party may share certain confidential and proprietary information with the Receiving Party. This Agreement sets forth the terms and conditions under which such information will be disclosed and protected." }
  ],
  "signature_block": "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.\n\nDISCLOSING PARTY\nSignature: _______________________\nPrinted Name: _______________________\nTitle: _______________________\nDate: _______________________\n\nRECEIVING PARTY\nSignature: _______________________\nPrinted Name: _______________________\nTitle: _______________________\nDate: _______________________"
}
</DOCUMENT>

Document types and required sections:

NDA / Non-Disclosure Agreement:
1. PARTIES
2. PURPOSE
3. DEFINITION OF CONFIDENTIAL INFORMATION
4. OBLIGATIONS OF RECEIVING PARTY
5. EXCLUSIONS FROM CONFIDENTIAL INFORMATION
6. TERM
7. RETURN OR DESTRUCTION OF INFORMATION
8. NO LICENSE
9. NO WARRANTY
10. REMEDIES
11. GENERAL PROVISIONS (governing law, entire agreement, severability, waiver, amendments)
+ signature_block

Freelance / Service Agreement:
Scope of Work, Payment Terms, Intellectual Property, Confidentiality, Termination, Limitation of Liability, General Provisions + signature_block

Employment Offer Letter:
Position, Start Date, Compensation, Benefits, At-Will Employment, Confidentiality + signature_block

Include [PLACEHOLDER] tokens (like [DATE], [COMPANY NAME], [JURISDICTION]) where the user needs to fill in details.
Make every section thorough, professional, and legally sound.

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

    let documentData = null;

    if (docMatch) {
      try {
        const docInfo = JSON.parse(docMatch[1].trim());
        const pdfBytes = await generatePDF(docInfo);
        documentData = {
          name: `${docInfo.filename || "document"}.pdf`,
          title: docInfo.title || "Generated Document",
          data: Buffer.from(pdfBytes).toString("base64"),
        };
      } catch (pdfErr) {
        console.error("PDF generation error:", pdfErr);
      }
    }

    res.json({
      message: botMessage || "Here is your generated document!",
      document: documentData,
    });
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).json({ error: err.message || "AI request failed" });
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
    // Section heading
    if (section.heading) {
      ensureSpace(LINE_HEIGHT_HEADING + 4);
      y -= 6;
      const headLines = wrapText(section.heading, boldFont, HEADING_SIZE);
      for (const hl of headLines) {
        drawLine(hl, boldFont, HEADING_SIZE, MARGIN, LINE_HEIGHT_HEADING);
      }
      y -= 2;
    }

    // Section body
    if (section.body) {
      const bodyLines = wrapText(section.body, regularFont, BODY_SIZE);
      for (const bl of bodyLines) {
        if (bl === "") {
          y -= LINE_HEIGHT_BODY * 0.5;
        } else {
          drawLine(bl, regularFont, BODY_SIZE, MARGIN + 12, LINE_HEIGHT_BODY);
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
