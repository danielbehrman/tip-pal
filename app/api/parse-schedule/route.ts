import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { ParsedSchedule } from "@/lib/types"

const CAPACITOR_ORIGINS = new Set(["capacitor://localhost", "https://localhost"])

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? ""
  if (CAPACITOR_ORIGINS.has(origin)) {
    return { "Access-Control-Allow-Origin": origin }
  }
  return {}
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin") ?? ""
  if (CAPACITOR_ORIGINS.has(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    })
  }
  return new NextResponse(null, { status: 204 })
}

// Removes common PII patterns from plan-of-care text before it reaches the Claude API.
// Targets labeled fields (Patient:, DOB:, Phone:, etc.), phone numbers, email addresses,
// and SSNs. Does NOT attempt generic name detection — food names would be collateral damage.
function stripPii(text: string): string {
  return text
    // Labeled PII fields — strip the label and everything after it on the same line
    .replace(
      /\b(patient(\s+name)?|dob|date\s+of\s+birth|parent(\/guardian)?|guardian|provider|physician|allergist|referring\s+physician|doctor|fax|e[-\s]?mail|address|mrn|medical\s+record\s+(number|#)?)\s*[:#]\s*.*/gi,
      ""
    )
    // "Dr. Firstname Lastname" patterns
    .replace(/\bDr\.?\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)+(\s*,?\s*(MD|DO|PhD|NP|PA)\.?)?\b/g, "")
    // Phone numbers: (123) 456-7890 / 123-456-7890 / 123.456.7890
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "")
    // Email addresses
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "")
    // SSN-like patterns (XXX-XX-XXXX)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "")
    // Collapse excess blank lines left behind
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const SYSTEM_PROMPT = `You are a medical dosing schedule parser. This document is a clinical plan of care that may contain protected health information such as patient names, provider names, dates of birth, phone numbers, and addresses. Your task is to extract ONLY food and medication dosing information. Do NOT reproduce, reference, or include any patient names, provider names, contact details, or identifying information in your output — treat them as noise to be ignored entirely.

Parse the provided text and return ONLY valid JSON with no explanation, no markdown, no code fences.

Return an object matching this exact schema:

{
  "visitNumber": "string — the visit number as stated in the document (e.g. '8', '9', 'Tolerance Visit 1'). If not found, omit this field.",
  "appointmentDate": "YYYY-MM-DD — the next appointment or follow-up date. If not found, omit this field.",
  "maintenanceFoods": [
    { "name": "string", "dose": number, "unit": "string", "capped": boolean, "prepNote": "string or null" }
  ],
  "weeklyFoods": [
    { "name": "string", "dose": number, "unit": "string", "prepNote": "string or null" }
  ],
  "treatmentFoods": [
    {
      "name": "string",
      "weeks": [
        { "week": number, "dose": number, "unit": "string", "isFinal": boolean }
      ]
    }
  ],
  "recommendedFoods": [
    { "name": "string", "dose": number, "unit": "string", "frequencyPerWeek": "string" }
  ],
  "medications": [
    { "name": "string", "dose": "string", "unit": "string", "frequency": "string" }
  ]
}

Parsing rules:
- maintenanceFoods: foods given every morning. Set capped=true if the notes indicate a maximum or capped dose.
- weeklyFoods: foods given once per week (Sunday or Day 7 only). These appear in the morning section once a week.
- treatmentFoods: foods with a weekly dose escalation schedule. Each entry has a weeks array covering each week's dose.
- Set isFinal=true on a TreatmentWeek if the notes say "continue at final dose", "maintain at", "continue", or similar terminal language for that dose level. Only the last week entry should have isFinal=true.
- recommendedFoods: foods recommended at a target frequency that is NOT daily (e.g. "3-5x/week", "2-3 times weekly"). Set frequencyPerWeek to that range exactly as stated (e.g. "3-5"). These are distinct from maintenanceFoods (daily) and weeklyFoods (once per week, Day 7 only).
- medications: daily medications (e.g. Zyrtec, Flovent, antihistamines) — not food, not scenario kit / emergency medications. Set frequency to how often it's given (e.g. "once daily", "twice daily").
- If the text has no recommended foods or no medications, return an empty array for that field — never omit the field.
- Seeds (sesame seed, flax seed, etc.) must have prepNote set to "Crush before serving". This is a medical requirement.
- Any food with a specific preparation instruction must have that instruction in prepNote.
- If there is no prep note, set prepNote to null.
- dose must always be a number for maintenanceFoods, weeklyFoods, treatmentFoods, and recommendedFoods (not a string). medications dose is a string (e.g. "10mg", "1 tablet").
- All fields are required. Do not omit any field.
- visitNumber: extract the visit identifier exactly as written (e.g. "Visit 8" → "8", "Tolerance Visit 1" → "Tolerance Visit 1"). Omit if not present.
- appointmentDate: extract the next appointment date and format it as YYYY-MM-DD. Omit if not present or unclear.`

function isValidSchedule(obj: unknown): obj is ParsedSchedule {
  if (!obj || typeof obj !== "object") return false
  const s = obj as Record<string, unknown>
  return (
    Array.isArray(s.maintenanceFoods) &&
    Array.isArray(s.weeklyFoods) &&
    Array.isArray(s.treatmentFoods) &&
    Array.isArray(s.recommendedFoods) &&
    Array.isArray(s.medications)
  )
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)

  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: cors })
  }

  const { text } = body
  if (!text || typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: "text is required" }, { status: 400, headers: cors })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500, headers: cors }
    )
  }

  const client = new Anthropic({ apiKey })
  const sanitizedText = stripPii(text)

  let rawContent: string
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: sanitizedText }],
    })
    const block = message.content[0]
    if (!block || block.type !== "text") {
      return NextResponse.json(
        { error: "Unexpected response format from Claude" },
        { status: 500, headers: cors }
      )
    }
    rawContent = block.text
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      { error: `Claude API error: ${message}` },
      { status: 500, headers: cors }
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    return NextResponse.json(
      { error: "Could not parse response from Claude" },
      { status: 500, headers: cors }
    )
  }

  if (!isValidSchedule(parsed)) {
    return NextResponse.json(
      { error: "Response did not match expected schedule schema" },
      { status: 500, headers: cors }
    )
  }

  return NextResponse.json({ schedule: parsed }, { headers: cors })
}
