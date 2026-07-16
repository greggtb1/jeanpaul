import { nameFileSuffix } from "@/lib/file-name";

export type LetterSender = {
  name: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
};

export async function downloadLetterPdf(
  body: string,
  company: string,
  title: string,
  sender: LetterSender
) {
  const res = await fetch("/api/letter-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, company, title, sender }),
  });

  if (!res.ok) {
    let msg = "Génération PDF impossible";
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const safeCompany = company.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 40);
  const filename = `Lettre_${safeCompany || "motivation"}${nameFileSuffix(sender.name)}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
