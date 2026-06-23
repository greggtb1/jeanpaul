import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_LETTER_CHARS = 5000;
const MAX_INSTRUCTION_CHARS = 200;
const DAILY_ACCOUNT_LIMIT = 8;
const MONTHLY_ACCOUNT_LIMIT = 120;
const DAILY_LETTER_LIMIT = 3;

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function letterKey(letter: string): string {
  return createHash("sha256").update(letter.slice(0, MAX_LETTER_CHARS)).digest("hex").slice(0, 16);
}

type QuotaScope = "account" | "month" | "letter";

function quotaId(userId: string, scope: QuotaScope, key: string): string {
  return `letter_refine:${scope}:${userId}:${key}`;
}

async function readQuota(userId: string, scope: QuotaScope, key: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_state")
    .select("data")
    .eq("id", quotaId(userId, scope, key))
    .maybeSingle();
  return Number((data?.data as { count?: number } | null)?.count ?? 0);
}

async function writeQuota(
  userId: string,
  scope: QuotaScope,
  key: string,
  count: number,
  limit: number
): Promise<string | null> {
  const admin = createAdminClient();
  const { error } = await admin.from("app_state").upsert(
    {
      id: quotaId(userId, scope, key),
      user_id: userId,
      data: { count, limit, scope },
    },
    { onConflict: "id" }
  );
  if (error) return "Impossible de vérifier la limite de retouche.";
  return null;
}

function buildPrompt(letter: string, instruction: string): string {
  return `Tu reçois une lettre de motivation déjà rédigée et une consigne de modification.

LETTRE ACTUELLE :
${letter}

CONSIGNE :
${instruction}

Règles :
- Reprends la lettre existante comme base (ne repars pas de zéro, ne réinvente pas le contenu)
- Garde les faits, chiffres et éléments concrets déjà mentionnés
- Même langue que la lettre originale
- Pas de formule d'appel, pas de signature, pas d'objet
- Pas de tirets doubles (--) ni de tirets cadratin
- Retourne UNIQUEMENT le corps de la lettre modifiée`;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Service indisponible" }, { status: 503 });
    }

    let letter = "";
    let instruction = "";
    try {
      const body = await req.json();
      letter = typeof body?.letter === "string" ? body.letter.trim() : "";
      instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
    } catch {
      return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
    }

    if (!letter || letter.length < 40) {
      return NextResponse.json({ error: "Lettre trop courte" }, { status: 400 });
    }
    if (!instruction || instruction.length < 3) {
      return NextResponse.json({ error: "Consigne trop courte" }, { status: 400 });
    }
    if (letter.length > MAX_LETTER_CHARS) {
      letter = letter.slice(0, MAX_LETTER_CHARS);
    }
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      instruction = instruction.slice(0, MAX_INSTRUCTION_CHARS);
    }

    const today = dayKey();
    const month = monthKey();
    const currentAccount = await readQuota(user.id, "account", today);
    const currentMonth = await readQuota(user.id, "month", month);
    const currentLetter = await readQuota(user.id, "letter", `${letterKey(letter)}:${today}`);
    if (currentAccount >= DAILY_ACCOUNT_LIMIT) {
      return NextResponse.json(
        { error: "Limite de retouches atteinte aujourd'hui. Réessayez demain." },
        { status: 429 }
      );
    }
    if (currentMonth >= MONTHLY_ACCOUNT_LIMIT) {
      return NextResponse.json(
        { error: "Limite mensuelle de retouches atteinte. Réessayez le mois prochain." },
        { status: 429 }
      );
    }
    if (currentLetter >= DAILY_LETTER_LIMIT) {
      return NextResponse.json(
        { error: "Limite atteinte pour cette lettre aujourd'hui. Réessayez demain." },
        { status: 429 }
      );
    }
    const quotaError =
      (await writeQuota(user.id, "account", today, currentAccount + 1, DAILY_ACCOUNT_LIMIT)) ||
      (await writeQuota(user.id, "month", month, currentMonth + 1, MONTHLY_ACCOUNT_LIMIT)) ||
      (await writeQuota(
        user.id,
        "letter",
        `${letterKey(letter)}:${today}`,
        currentLetter + 1,
        DAILY_LETTER_LIMIT
      ));
    if (quotaError) {
      return NextResponse.json({ error: quotaError }, { status: 429 });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 420,
        temperature: 0.6,
        messages: [{ role: "user", content: buildPrompt(letter, instruction) }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[letter-refine]", res.status, err);
      return NextResponse.json({ error: "Impossible de modifier la lettre" }, { status: 502 });
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const refined = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!refined) {
      return NextResponse.json({ error: "Réponse vide" }, { status: 502 });
    }

    return NextResponse.json({ text: refined });
  } catch (e) {
    console.error("[letter-refine]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
