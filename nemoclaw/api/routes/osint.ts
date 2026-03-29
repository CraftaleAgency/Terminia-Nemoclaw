import type { Request, Response } from 'express'
import type { VerifyOSINTRequest, VerifyOSINTResponse } from '../types.ts'
import { Router } from 'express'
import { runFullOSINT } from '../lib/osint.ts'

const router = Router()

// ── Route handler ───────────────────────────────────────────────────────────

router.post('/', async (req: Request<object, VerifyOSINTResponse, VerifyOSINTRequest>, res: Response) => {
  const { vat_number, fiscal_code, company_name, counterpart_id } = req.body

  if (!vat_number && !fiscal_code && !company_name) {
    return res.status(400).json({
      error: 'Almeno uno tra vat_number, fiscal_code o company_name è richiesto',
    })
  }

  const result = await runFullOSINT({
    vat_number,
    fiscal_code,
    company_name,
    counterpart_id,
  })

  res.json({
    vies: result.vies,
    fiscal_code: result.fiscal_code,
    anac: result.anac,
    reliability: result.reliability,
  })
})

export default router
