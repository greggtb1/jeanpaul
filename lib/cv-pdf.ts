export async function downloadCvPdf(text: string, filename = "CV_modifie.pdf") {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 44;
  const lineHeight = 14;
  const maxWidth = 595 - margin * 2;
  const lines = doc.splitTextToSize(text.trim(), maxWidth);
  let y = margin;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (const line of lines) {
    if (y > 800) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  const safeName = filename
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);
  doc.save(`${safeName || "CV_modifie"}.pdf`);
}
