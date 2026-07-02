import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const CAPACITOR_ORIGINS = new Set(["capacitor://localhost", "https://localhost"])

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? ""
  if (CAPACITOR_ORIGINS.has(origin)) {
    return { "Access-Control-Allow-Origin": origin }
  }
  return {}
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const familyId = formData.get("familyId") as string | null

    if (!file || !familyId) {
      return NextResponse.json({ error: "Missing file or familyId" }, { status: 400, headers: cors })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const ext = file.type === "image/png" ? "png" : "jpg"
    const path = `${familyId}/avatar.${ext}`
    const bytes = await file.arrayBuffer()

    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, bytes, { upsert: true, contentType: file.type })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: cors })
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl }, { status: 200, headers: cors })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed"
    return NextResponse.json({ error: msg }, { status: 500, headers: cors })
  }
}
