import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
}

// POST /api/feedback          → soumettre une idée
// POST /api/feedback?vote=1   → upvoter (request_id dans le body)
// POST /api/feedback?vote=-1  → annuler vote

export async function POST(req: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vote = req.nextUrl.searchParams.get("vote");
  const body = await req.json();

  if (vote === "1") {
    const { error } = await supabase
      .from("feature_votes")
      .insert({ user_id: user.id, request_id: body.request_id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (vote === "-1") {
    const { error } = await supabase
      .from("feature_votes")
      .delete()
      .eq("user_id", user.id)
      .eq("request_id", body.request_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // Nouvelle idée
  const message = (body.message || "").trim();
  if (!message || message.length < 5) {
    return NextResponse.json({ error: "Message trop court" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("feature_requests")
    .insert({ user_id: user.id, message })
    .select("id, message, votes, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// GET /api/feedback → liste des idées + votes de l'utilisateur
export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: requests }, { data: myVotes }] = await Promise.all([
    supabase
      .from("feature_requests")
      .select("id, message, votes, created_at, user_id")
      .order("votes", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("feature_votes")
      .select("request_id")
      .eq("user_id", user.id),
  ]);

  const voted = new Set((myVotes || []).map((v) => v.request_id));
  return NextResponse.json({
    requests: (requests || []).map((r) => ({
      ...r,
      mine: r.user_id === user.id,
      voted: voted.has(r.id),
    })),
  });
}
