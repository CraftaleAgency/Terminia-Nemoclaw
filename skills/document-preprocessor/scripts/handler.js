#!/usr/bin/env node
import { supabase } from '../../_shared/supabase-client.js';
import { callInference, isoNow } from '../../_shared/utils.js';

// ---- Constants ----
const MAX_TEXT_LENGTH = 50000;
const MIN_PDF_TEXT_DENSITY = 100; // chars per page — below this, treat as scanned
const OCR_MODEL = 'ocr'; // routes to NuMarkdown via LiteLLM

// ---- PDF text extraction (basic, no external deps) ----
function extractTextFromPdfBuffer(buffer) {
  // Simple PDF text extraction - finds text between BT/ET operators
  // and decodes common PDF string formats.
  // Returns { text, pages }
  const content = buffer.toString('latin1');

  // Count pages
  const pageCount = (content.match(/\/Type\s*\/Page[^s]/g) || []).length;

  // Extract text streams - look for text between parentheses in BT/ET blocks
  const textParts = [];
  const btBlocks = content.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btBlocks) {
    // Match text in parentheses: (text) Tj or (text) TJ
    const texts = block.match(/\(([^)]*)\)/g) || [];
    for (const t of texts) {
      const decoded = t.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (decoded.trim()) textParts.push(decoded);
    }
  }

  return { text: textParts.join(' '), pages: pageCount || 1 };
}

// ---- DOCX text extraction ----
async function extractTextFromDocxBuffer(buffer) {
  // DOCX = ZIP containing word/document.xml
  let text = '';
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  while (offset < buffer.length - 4) {
    // Local file header signature = 0x04034b50
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset++;
      continue;
    }

    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const compSize = view.getUint32(offset + 18, true);
    const fileName = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;

    if (fileName === 'word/document.xml') {
      const compMethod = view.getUint16(offset + 8, true);
      let xmlContent;

      if (compMethod === 0) {
        // Stored (no compression)
        xmlContent = buffer.toString('utf8', dataStart, dataStart + compSize);
      } else {
        // Deflated - use zlib
        const { inflateRawSync } = await import('zlib');
        const compressed = buffer.subarray(dataStart, dataStart + compSize);
        xmlContent = inflateRawSync(compressed).toString('utf8');
      }

      // Strip XML tags, decode entities
      text = xmlContent
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<w:p[^>]*>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      break;
    }

    offset = dataStart + compSize;
  }

  return { text, pages: Math.max(1, Math.ceil(text.length / 3000)) };
}

// ---- OCR via NuMarkdown ----
async function ocrImage(base64Data, mimeType = 'image/png') {
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const response = await callInference(OCR_MODEL, [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: dataUrl }
        },
        {
          type: 'text',
          text: 'Extract all text from this document image. Output the text in clean Markdown format, preserving tables, headings, and structure. Output ONLY the extracted text, no commentary.'
        }
      ]
    }
  ], { temperature: 0.1, max_tokens: 4096 });

  return response;
}

async function ocrPdfPages(buffer) {
  // For scanned PDFs: send entire PDF as base64 to vision model
  const base64 = buffer.toString('base64');
  const text = await ocrImage(base64, 'application/pdf');
  return text;
}

// ---- Main handler ----
async function handler(input) {
  const { document_id, storage_path, content_type, raw_content, company_id } = input;

  let buffer = null;
  let text = '';
  let method = 'text';
  let pages = 1;
  let confidence = 1.0;

  // Get the document content
  if (raw_content) {
    if (content_type && content_type.startsWith('image/')) {
      buffer = Buffer.from(raw_content, 'base64');
    } else if (content_type === 'application/pdf' || content_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      buffer = Buffer.from(raw_content, 'base64');
    } else {
      // Plain text
      text = raw_content;
      method = 'text';
    }
  } else if (storage_path) {
    // Download from Supabase Storage
    const { data, error } = await supabase.storage
      .from('documents')
      .download(storage_path);

    if (error) throw new Error(`Storage download failed: ${error.message}`);
    buffer = Buffer.from(await data.arrayBuffer());
  } else {
    throw new Error('Either raw_content or storage_path is required');
  }

  // Process based on content type
  if (buffer && content_type) {
    const ct = content_type.toLowerCase();

    if (ct.startsWith('image/')) {
      // Image → OCR
      const base64 = buffer.toString('base64');
      text = await ocrImage(base64, ct);
      method = 'image_ocr';
      pages = 1;
      confidence = 0.85;

    } else if (ct === 'application/pdf') {
      // PDF → try text extraction first
      const extracted = extractTextFromPdfBuffer(buffer);
      pages = extracted.pages;

      const density = pages > 0 ? extracted.text.length / pages : 0;

      if (density >= MIN_PDF_TEXT_DENSITY && extracted.text.trim().length > 200) {
        text = extracted.text;
        method = 'pdf_text';
        confidence = 0.95;
      } else {
        // Scanned PDF → OCR
        text = await ocrPdfPages(buffer);
        method = 'pdf_ocr';
        confidence = 0.80;
      }

    } else if (ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // DOCX
      const extracted = await extractTextFromDocxBuffer(buffer);
      text = extracted.text;
      pages = extracted.pages;
      method = 'docx';
      confidence = 0.95;

    } else {
      // Unknown → try as text
      text = buffer.toString('utf8');
      method = 'text';
    }
  }

  // Truncate if too long
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.substring(0, MAX_TEXT_LENGTH);
  }

  // Detect language (simple heuristic)
  const italianMarkers = ['contratto', 'articolo', 'comma', 'decreto', 'legge', 'società', 'partita iva', 'codice fiscale'];
  const lowerText = text.toLowerCase();
  const italianHits = italianMarkers.filter(m => lowerText.includes(m)).length;
  const language = italianHits >= 2 ? 'it' : 'en';

  // Update document record in Supabase if document_id provided
  if (document_id) {
    await supabase.from('documents').update({
      extracted_text: text,
      extraction_method: method,
      page_count: pages,
      extraction_confidence: confidence,
      detected_language: language,
      processed_at: isoNow()
    }).eq('id', document_id);
  }

  return {
    document_id: document_id || null,
    text,
    method,
    pages,
    confidence,
    language
  };
}

// CLI entry point
async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input = JSON.parse(raw);
    const result = await handler(input);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
