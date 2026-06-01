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

const SYSTEM_PROMPT = `You are a medical dosing schedule parser. Parse the provided text and return ONLY valid JSON with no explanation, no markdown, no code fences.

Return an object matching this exact schema:

{
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
  ]
}

Parsing rules:
- maintenanceFoods: foods given every morning. Set capped=true if the notes indicate a maximum or capped dose.
- weeklyFoods: foods given once per week (Sunday or Day 7 only). These appear in the morning section once a week.
- treatmentFoods: foods with a weekly dose escalation schedule. Each entry has a weeks array covering each week's dose.
- Set isFinal=true on a TreatmentWeek if the notes say "continue at final dose", "maintain at", "continue", or similar terminal language for that dose level. Only the last week entry should have isFinal=true.
- Seeds (sesame seed, flax seed, etc.) must have prepNote set to "Crush before serving". This is a medical requirement.
- Any food with a specific preparation instruction must have that instruction in prepNote.
- If there is no prep note, set prepNote to null.
- dose must always be a number (not a string).
- All fields are required. Do not omit any field.`

function isValidSchedule(obj: unknown): obj is ParsedSchedule {
  if (!obj || typeof obj !== "object") return false
  const s = obj as Record<string, unknown>
  return (
    Array.isArray(s.maintenanceFoods) &&
    Array.isArray(s.weeklyFoods) &&
    Array.isArray(s.treatmentFoods)
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

  let rawContent: string
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
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
