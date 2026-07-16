import { NextResponse } from "next/server";
import { requireBlogAdmin } from "@/lib/blog-admin";

const MAX_COVER_SIZE = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  const gate = await requireBlogAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Image manquante" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Format accepté : JPG, PNG ou WebP" }, { status: 400 });
  }
  if (file.size > MAX_COVER_SIZE) {
    return NextResponse.json({ error: "Image trop lourde (4 Mo max)" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "webp";
  const safeName = file.name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const path = `${gate.user.id}/${Date.now()}_${safeName || "cover"}.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error } = await gate.admin.storage.from("blog-covers").upload(path, bytes, {
    contentType: file.type,
    upsert: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data } = gate.admin.storage.from("blog-covers").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, path });
}
