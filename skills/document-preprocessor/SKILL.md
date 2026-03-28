---
name: document-preprocessor
description: Preprocesses uploaded documents (text, PDF, DOCX, images) into clean text. Routes scanned documents and images through NuMarkdown OCR model for extraction.
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Accepts a document reference (Supabase storage path or raw content) and converts it to clean text
suitable for downstream contract analysis skills. Handles:
- **Plain text**: passed through directly
- **PDF**: text extraction; if text is too sparse (scanned PDF), routes through OCR
- **DOCX**: extracts text from document.xml inside the ZIP
- **Images** (PNG, JPG, TIFF): routes through NuMarkdown-8B-Thinking OCR model via inference.local

## Input

```json
{
  "document_id": "uuid",           // optional - Supabase document ID
  "storage_path": "contracts/abc.pdf",  // Supabase storage path
  "content_type": "application/pdf",    // MIME type
  "raw_content": "...",                 // optional - raw text or base64 for images
  "company_id": "uuid"
}
```

## Output

```json
{
  "document_id": "uuid",
  "text": "extracted text content...",
  "method": "pdf_text|pdf_ocr|docx|image_ocr|text",
  "pages": 5,
  "confidence": 0.92,
  "language": "it"
}
```
