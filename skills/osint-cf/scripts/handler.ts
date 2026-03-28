#!/usr/bin/env -S node --experimental-strip-types
import { isoNow } from '../../_shared/utils.ts'
import { supabase } from '../../_shared/supabase-client.ts'

// ── Month code mapping ───────────────────────────────────────────────
const MONTH_CODES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, H: 6,
  L: 7, M: 8, P: 9, R: 10, S: 11, T: 12,
};

const MONTH_TO_LETTER: Record<number, string> = Object.fromEntries(
  Object.entries(MONTH_CODES).map(([k, v]) => [v, k]),
);

// ── Check-character tables (1-indexed positions) ─────────────────────
const EVEN_MAP: Record<string, number> = {};
for (let i = 0; i < 10; i++) EVEN_MAP[String(i)] = i;
for (let i = 0; i < 26; i++) EVEN_MAP[String.fromCharCode(65 + i)] = i;

const ODD_MAP: Record<string, number> = {
  '0': 1,  '1': 0,  '2': 5,  '3': 7,  '4': 9,
  '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1,  B: 0,  C: 5,  D: 7,  E: 9,
  F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2,  L: 4,  M: 18, N: 20, O: 11,
  P: 3,  Q: 6,  R: 8,  S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

const CHECK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ── Helpers ──────────────────────────────────────────────────────────

function computeCheckChar(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = first15[i];
    // 1-indexed: positions 1,3,5… are odd; 2,4,6… are even
    if ((i + 1) % 2 === 1) {
      sum += ODD_MAP[ch];
    } else {
      sum += EVEN_MAP[ch];
    }
  }
  return CHECK_LETTERS[sum % 26];
}

function extractConsonants(str: string): string[] {
  return str.replace(/[^A-Z]/g, '').split('').filter(c => !'AEIOU'.includes(c));
}

function extractVowels(str: string): string[] {
  return str.replace(/[^A-Z]/g, '').split('').filter(c => 'AEIOU'.includes(c));
}

function encodeSurname(surname: string): string {
  const s = surname.toUpperCase();
  const cons = extractConsonants(s);
  const vow = extractVowels(s);
  const pool = [...cons, ...vow, 'X', 'X', 'X'];
  return pool.slice(0, 3).join('');
}

function encodeName(name: string): string {
  const n = name.toUpperCase();
  const cons = extractConsonants(n);
  if (cons.length > 3) {
    return [cons[0], cons[2], cons[3]].join('');
  }
  const vow = extractVowels(n);
  const pool = [...cons, ...vow, 'X', 'X', 'X'];
  return pool.slice(0, 3).join('');
}

// ── Interfaces ───────────────────────────────────────────────────────

interface HandlerInput {
  codice_fiscale: string
  nome?: string
  cognome?: string
  data_nascita?: string
  counterpart_id?: string
  employee_id?: string
}

interface Extracted {
  surname_code: string
  name_code: string
  birth_year: string
  birth_month: number | null
  birth_day: number
  gender: string
  municipality_code: string
}

interface Matches {
  surname: boolean | null
  name: boolean | null
  birth_date: boolean | null
}

interface HandlerResult {
  valid: boolean
  checksum_ok: boolean
  extracted: Extracted | null
  matches: Matches
  errors: string[]
}

// ── Main handler ─────────────────────────────────────────────────────

async function handler(input: HandlerInput): Promise<HandlerResult> {
  const { codice_fiscale, nome, cognome, data_nascita, counterpart_id, employee_id } = input;
  const errors: string[] = [];

  // 1. Format validation
  if (!codice_fiscale || typeof codice_fiscale !== 'string') {
    return {
      valid: false,
      checksum_ok: false,
      extracted: null,
      matches: { surname: null, name: null, birth_date: null },
      errors: ['codice_fiscale is required and must be a string'],
    };
  }

  const cf = codice_fiscale.toUpperCase().trim();

  if (cf.length !== 16) {
    errors.push(`Invalid length: expected 16, got ${cf.length}`);
  }

  if (!/^[A-Z0-9]{16}$/.test(cf)) {
    errors.push('Invalid characters: only A-Z and 0-9 allowed');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      checksum_ok: false,
      extracted: null,
      matches: { surname: null, name: null, birth_date: null },
      errors,
    };
  }

  // 2. Checksum verification
  const first15 = cf.slice(0, 15);
  const expectedCheck = computeCheckChar(first15);
  const actualCheck = cf[15];
  const checksumOk = expectedCheck === actualCheck;

  if (!checksumOk) {
    errors.push(`Checksum mismatch: expected ${expectedCheck}, got ${actualCheck}`);
  }

  // 3. Extract components
  const surnameCode = cf.slice(0, 3);
  const nameCode = cf.slice(3, 6);
  const birthYear = cf.slice(6, 8);
  const birthMonthLetter = cf[8];
  const birthDayRaw = parseInt(cf.slice(9, 11), 10);
  const municipalityCode = cf.slice(11, 15);

  const birthMonth: number | undefined = MONTH_CODES[birthMonthLetter];
  if (!birthMonth) {
    errors.push(`Invalid month code: ${birthMonthLetter}`);
  }

  let gender: string;
  let birthDay: number;
  if (birthDayRaw > 40) {
    gender = 'F';
    birthDay = birthDayRaw - 40;
  } else {
    gender = 'M';
    birthDay = birthDayRaw;
  }

  if (birthDay < 1 || birthDay > 31) {
    errors.push(`Invalid birth day: ${birthDay}`);
  }

  const extracted: Extracted = {
    surname_code: surnameCode,
    name_code: nameCode,
    birth_year: birthYear,
    birth_month: birthMonth || null,
    birth_day: birthDay,
    gender,
    municipality_code: municipalityCode,
  };

  // 4. Match against provided data
  const matches: Matches = {
    surname: null,
    name: null,
    birth_date: null,
  };

  if (cognome != null && cognome !== '') {
    matches.surname = encodeSurname(cognome) === surnameCode;
    if (!matches.surname) {
      errors.push(`Surname mismatch: CF has ${surnameCode}, expected ${encodeSurname(cognome)}`);
    }
  }

  if (nome != null && nome !== '') {
    matches.name = encodeName(nome) === nameCode;
    if (!matches.name) {
      errors.push(`Name mismatch: CF has ${nameCode}, expected ${encodeName(nome)}`);
    }
  }

  if (data_nascita != null && data_nascita !== '') {
    const parts = data_nascita.split('-');
    if (parts.length === 3) {
      const [yyyy, mm, dd] = parts;
      const yearMatch = yyyy.slice(-2) === birthYear;
      const monthMatch = parseInt(mm, 10) === birthMonth;
      const dayMatch = parseInt(dd, 10) === birthDay;
      matches.birth_date = yearMatch && monthMatch && dayMatch;
      if (!matches.birth_date) {
        errors.push(`Birth date mismatch: CF encodes ${birthYear}/${birthMonth}/${birthDay}, provided ${data_nascita}`);
      }
    } else {
      errors.push(`Invalid data_nascita format: expected YYYY-MM-DD, got ${data_nascita}`);
    }
  }

  const valid = checksumOk && errors.length === 0;

  const result: HandlerResult = { valid, checksum_ok: checksumOk, extracted, matches, errors };

  // 5. Persist to Supabase
  const allMatch = [matches.surname, matches.name, matches.birth_date]
    .filter((v): v is boolean => v !== null);
  const fiscalCodeMatch = allMatch.length > 0 ? allMatch.every(Boolean) : null;

  if (counterpart_id) {
    await supabase
      .from('counterparts')
      .update({
        fiscal_code_valid: valid,
        updated_at: isoNow(),
      })
      .eq('id', counterpart_id);
  }

  if (employee_id) {
    const updateData: Record<string, unknown> = {
      fiscal_code_valid: valid,
      updated_at: isoNow(),
    };
    if (fiscalCodeMatch !== null) {
      updateData.fiscal_code_match = fiscalCodeMatch;
    }
    await supabase
      .from('employees')
      .update(updateData)
      .eq('id', employee_id);
  }

  return result;
}

// CLI entry point
async function main(): Promise<void> {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input: HandlerInput = JSON.parse(raw);
    const result = await handler(input);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err: unknown) {
    console.log(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }
}

main();
