import type { Request, Response } from 'express'
import { Router } from 'express'
import supabase from '../lib/supabase.ts'

const router = Router()

const BUCKET = 'documents'

// Ensure bucket exists (idempotent)
async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET)
  if (!data) {
    await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024, // 50MB
      allowedMimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/tiff',
        'image/webp',
      ],
    })
  }
}

// Fire-and-forget bucket creation on load
void ensureBucket()

/**
 * POST /api/documents/upload
 * Store a document in Supabase storage linked to the user.
 * Body: { document_base64, content_type, filename, user_id, source? }
 * source: "registration" | "contract" | "manual"
 */
router.post('/upload', async (req: Request, res: Response) => {
  const { document_base64, content_type, filename, user_id, source } = req.body

  if (!document_base64 || !user_id) {
    return res.status(400).json({ error: 'document_base64 e user_id sono obbligatori' })
  }

  try {
    const buffer = Buffer.from(document_base64, 'base64')
    const ext = content_type === 'application/pdf' ? 'pdf'
      : content_type?.includes('word') ? 'docx'
      : content_type?.includes('png') ? 'png'
      : content_type?.includes('jpeg') || content_type?.includes('jpg') ? 'jpg'
      : 'bin'
    const storagePath = `${user_id}/${source || 'upload'}/${Date.now()}-${filename || `document.${ext}`}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: content_type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      console.error('[documents] Upload error:', uploadError.message)
      return res.status(500).json({ error: uploadError.message })
    }

    // Store metadata in a documents table (create if needed)
    const { error: dbError } = await supabase.from('user_documents').insert({
      user_id,
      storage_path: storagePath,
      filename: filename || `document.${ext}`,
      content_type: content_type || 'application/octet-stream',
      size_bytes: buffer.length,
      source: source || 'upload',
    })

    if (dbError) {
      console.warn('[documents] DB insert warning:', dbError.message)
    }

    // For registration documents: create a contract record automatically
    let contractId: string | null = null
    if (source === 'registration') {
      try {
        // Get user's company_id from the users table
        const { data: userData } = await supabase
          .from('users')
          .select('company_id')
          .eq('id', user_id)
          .single()

        if (userData?.company_id) {
          const contractTitle = (filename || 'Documento Costitutivo').replace(/\.[^.]+$/, '')

          // Create draft contract
          const { data: contract } = await supabase
            .from('contracts')
            .insert({
              company_id: userData.company_id,
              created_by: user_id,
              title: contractTitle,
              contract_type: 'altro',
              status: 'draft',
            })
            .select('id')
            .single()

          if (contract) {
            contractId = contract.id

            // Link document to contract
            await supabase.from('contract_documents').insert({
              contract_id: contract.id,
              file_name: filename || `document.${ext}`,
              file_url: storagePath,
              file_size: buffer.length,
              file_type: ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'other',
              document_role: 'original',
              is_current: true,
              uploaded_by: user_id,
            })

            // Store raw text for later analysis
            const rawText = buffer.toString('utf8').slice(0, 20000) || ''
            if (rawText.length > 50) {
              await supabase.from('contracts').update({
                raw_text: rawText,
              }).eq('id', contract.id)
            }

            console.log(`[documents] Registration contract ${contract.id} created for user ${user_id}`)
          }
        }
      } catch (err) {
        console.warn('[documents] Registration contract creation:', (err as Error).message)
      }
    }

    return res.json({
      success: true,
      path: storagePath,
      size: buffer.length,
      contract_id: contractId,
    })
  } catch (err) {
    console.error('[documents] Error:', (err as Error).message)
    return res.status(500).json({ error: 'Errore nel salvataggio del documento' })
  }
})

export default router
