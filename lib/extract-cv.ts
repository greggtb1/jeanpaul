import type { CvProfile } from "@/lib/parse-cv-profile";

export async function extractCvProfile(file: File): Promise<CvProfile> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/extract-cv", { method: "POST", body: fd });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Analyse du CV impossible. Vous pourrez saisir vos infos à l'étape suivante.");
  }
  const data = (await res.json()) as { profile?: CvProfile; error?: string };
  if (!res.ok) throw new Error(data.error || "Analyse du CV impossible.");
  return data.profile ?? { full_name: "", email: "", phone: "", location: "" };
}
