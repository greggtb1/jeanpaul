import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/feedback          → soumettre une idée
// POST /api/feedback?vote=1   → upvoter (request_id dans le body)
// POST /api/feedback?vote=-1  → annuler vote

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vote = req.nextUrl.searchParams.get("vote");
  const body = await req.json();

  if (vote === "1" || vote === "-1") {
    const requestId = body.request_id as string | undefined;
    if (!requestId) {
      return NextResponse.json({ error: "request_id manquant" }, { status: 400 });
    }

    if (vote === "1") {
      const { error } = await supabase
        .from("feature_votes")
        .insert({ user_id: user.id, request_id: requestId });
      // Déjà voté : on considère comme OK
      if (error && error.code !== "23505") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    } else {
      const { error } = await supabase
        .from("feature_votes")
        .delete()
        .eq("user_id", user.id)
        .eq("request_id", requestId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updated, error: fetchError } = await supabase
      .from("feature_requests")
      .select("id, votes")
      .eq("id", requestId)
      .single();

    if (fetchError || !updated) {
      return NextResponse.json({ error: fetchError?.message || "Idée introuvable" }, { status: 400 });
    }

    const { data: myVote } = await supabase
      .from("feature_votes")
      .select("request_id")
      .eq("user_id", user.id)
      .eq("request_id", requestId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      request: {
        id: updated.id,
        votes: updated.votes,
        voted: !!myVote,
      },
    });
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: requests }, { data: myVotes }] = await Promise.all([
    supabase
      .from("feature_requests")
      .select("id, message, votes, created_at, user_id")
      .order("votes", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("feature_votes").select("request_id").eq("user_id", user.id),
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
