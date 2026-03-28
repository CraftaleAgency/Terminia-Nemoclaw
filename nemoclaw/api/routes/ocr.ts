import type { Request, Response } from 'express'
import type { OCRResponse } from '../types.ts'
import { Router } from 'express'
import multer from 'multer'
import { chatCompletion } from '../lib/inference.ts'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

router.post('/', upload.single('file'), async (req: Request, res: Response<OCRResponse | { error: string }>) => {
  let imageUrl: string | undefined

  // Option 1: JSON body with base64
  if (req.body.image_base64) {
    imageUrl = req.body.image_base64 as string
    if (!imageUrl.startsWith('data:')) {
      imageUrl = `data:image/png;base64,${imageUrl}`
    }
  }

  // Option 2: multipart file upload
  if (!imageUrl && req.file) {
    const mime = req.file.mimetype || 'image/png'
    const b64 = req.file.buffer.toString('base64')
    imageUrl = `data:${mime};base64,${b64}`
  }

  if (!imageUrl) {
    return res.status(400).json({ error: 'image_base64 o file upload è obbligatorio' })
  }

  try {
    const text = await chatCompletion({
      model: 'numarkdown',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Estrai tutto il testo da questa immagine/documento. Restituisci il testo in formato markdown.' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    })

    res.json({ text, format: 'markdown' })
  } catch (err) {
    res.status(502).json({ error: `OCR fallito: ${(err as Error).message}` })
  }
})

export default router
