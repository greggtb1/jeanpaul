import { jsPDF } from "jspdf";

export type LetterSender = {
  name: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
};

export function buildLetterPdfBuffer(
  body: string,
  company: string,
  title: string,
  sender: LetterSender
): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 25;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const name = sender.name || "Candidat";
  const loc = sender.location || "Paris";
  // La ville apparaît déjà dans la ligne de date, on ne la répète pas ici.
  const contact = [sender.email, sender.phone].filter(Boolean).join(" · ");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(26, 26, 46);
  doc.text(name, margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 130);
  if (contact) {
    doc.text(contact, margin, y);
    y += 5;
  }

  y += 8;

  const dateStr = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 90);
  doc.text(`${loc}, le ${dateStr}`, margin, y);
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(26, 26, 46);
  const subject = `Objet : Candidature · ${title} chez ${company}`;
  const subjectLines = doc.splitTextToSize(subject, maxW);
  for (const line of subjectLines) {
    doc.text(line, margin, y);
    y += 5.5;
  }
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(26, 26, 46);

  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());
  for (const para of paragraphs) {
    const lines = doc.splitTextToSize(para.trim().replace(/\n/g, " "), maxW);
    for (const line of lines) {
      if (y > pageH - 30) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 6;
    }
    y += 5;
  }

  y += 6;
  if (y > pageH - 25) {
    doc.addPage();
    y = margin;
  }
  doc.text("Cordialement,", margin, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text(name, margin, y);

  const raw = doc.output("arraybuffer");
  return new Uint8Array(raw);
}

export function letterPdfFilename(company: string): string {
  const safe = company.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 40);
  return `Lettre_${safe || "motivation"}.pdf`;
}
