import { jwtVerify, createRemoteJWKSet } from "jose";
import { NextRequest, NextResponse } from "next/server";

const JWKS_URL = "http://localhost:7052/.well-known/jwks.json";
const SHIELD_URL = process.env["NEXT_PUBLIC_COLD_STORAGE_URL"] ?? "http://localhost:7053";
const SHIELD_API_KEY = process.env["SHIELD_API_KEY"]!;
const SHIELD_API_SECRET = process.env["SHIELD_API_SECRET"]!;
const SHIELD_ENCRYPTION_PART = process.env["SHIELD_ENCRYPTION_PART"]!;

const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer /, "");
  if (!jwt) {
    return NextResponse.json({ error: "Missing JWT" }, { status: 401 });
  }

  try {
    await jwtVerify(jwt, JWKS);
  } catch {
    return NextResponse.json({ error: "Invalid JWT" }, { status: 401 });
  }

  // Preferred: encryption session (stateless, no client exposure of encryption_part)
  try {
    const shieldRes = await fetch(`${SHIELD_URL}/project/encryption-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": SHIELD_API_KEY,
        "X-API-Secret": SHIELD_API_SECRET,
      },
      body: JSON.stringify({ encryption_part: SHIELD_ENCRYPTION_PART }),
    });
    if (shieldRes.ok) {
      const data = (await shieldRes.json()) as { session_id: string };
      if (data.session_id) {
        return NextResponse.json({ session_id: data.session_id });
      }
    }
  } catch {
    // fall through to encryptionPart fallback
  }

  // Fallback: return encryption_part directly (DEMO ONLY — custodial risk)
  // The server holds both the api_secret and encryption_part, so this is acceptable
  // in a single-operator demo context but not production.
  return NextResponse.json({ encryption_part: SHIELD_ENCRYPTION_PART });
}
