type Block =
  | { kind: "name"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "section"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "body"; text: string }
  | { kind: "gap" };

// Palette alignée sur le template reportlab du CV de base (engine/generators/cv_builder.py)
const DARK: [number, number, number] = [26, 26, 46]; // #1A1A2E
const GRAY: [number, number, number] = [85, 85, 85]; // #555555
const LIGHT: [number, number, number] = [136, 136, 136]; // #888888
const BODY: [number, number, number] = [51, 51, 51]; // #333333

function classifyLines(text: string): Block[] {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let nameSet = false;

  rawLines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      blocks.push({ kind: "gap" });
      return;
    }

    const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
    const isUpper =
      letters.length >= 2 && letters === letters.toUpperCase() && line.length <= 48;

    const lower = line.toLowerCase();
    const isJunkName =
      /application\s+for|candidature\s+pour/.test(lower) ||
      /^(application|company|candidature|entreprise)(\s|$)/i.test(line);

    // Nom : première ligne courte en majuscules (pas un label de template)
    if (!nameSet && isUpper && i <= 3 && !isJunkName) {
      blocks.push({ kind: "name", text: line });
      nameSet = true;
      return;
    }

    // Contact : contient email ou téléphone
    if (/@|\+?\d[\d\s.]{6,}/.test(line) && line.length <= 90) {
      blocks.push({ kind: "contact", text: line });
      return;
    }

    // Titre de section : majuscules
    if (isUpper) {
      blocks.push({ kind: "section", text: line });
      return;
    }

    // Puce
    if (/^[•\-*·▪]\s?/.test(line)) {
      blocks.push({ kind: "bullet", text: line.replace(/^[•\-*·▪]\s?/, "") });
      return;
    }

    blocks.push({ kind: "body", text: line });
  });

  return blocks;
}

async function buildCvDoc(text: string, density = 0) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = density >= 2 ? 36 : density === 1 ? 42 : 48;
  const pageW = 595;
  const pageH = 842;
  const maxWidth = pageW - margin * 2;
  let y = margin;
  const scale = density >= 2 ? 0.88 : density === 1 ? 0.94 : 1;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeWrapped = (
    content: string,
    opts: {
      size: number;
      style: "normal" | "bold" | "italic";
      color: [number, number, number];
      lineH: number;
      indent?: number;
      gapBefore?: number;
      gapAfter?: number;
    }
  ) => {
    if (opts.gapBefore) y += opts.gapBefore * scale;
    doc.setFont("helvetica", opts.style);
    doc.setFontSize(opts.size * scale);
    doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    const indent = opts.indent ?? 0;
    const lineH = opts.lineH * scale;
    const lines = doc.splitTextToSize(content, maxWidth - indent);
    for (const line of lines) {
      ensureSpace(lineH);
      doc.text(line, margin + indent, y);
      y += lineH;
    }
    if (opts.gapAfter) y += opts.gapAfter * scale;
  };

  const hrule = (color: [number, number, number], thickness: number) => {
    ensureSpace(6);
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(thickness);
    doc.line(margin, y, pageW - margin, y);
    y += 4 * scale;
  };

  const blocks = classifyLines(text);

  blocks.forEach((b) => {
    switch (b.kind) {
      case "name":
        writeWrapped(b.text, { size: 22, style: "bold", color: DARK, lineH: 26, gapBefore: density ? 6 : 14, gapAfter: 1 });
        break;
      case "contact":
        writeWrapped(b.text, { size: 9, style: "normal", color: LIGHT, lineH: 13, gapAfter: 4 });
        break;
      case "section": {
        y += (density ? 6 : 10) * scale;
        ensureSpace(18);
        writeWrapped(b.text.toUpperCase(), { size: 9, style: "bold", color: DARK, lineH: 12 });
        hrule(DARK, 1);
        y += 2 * scale;
        break;
      }
      case "bullet": {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5 * scale);
        doc.setTextColor(BODY[0], BODY[1], BODY[2]);
        ensureSpace(13 * scale);
        doc.text("•", margin + 2, y);
        writeWrapped(b.text, { size: 9.5, style: "normal", color: BODY, lineH: 13, indent: 12, gapAfter: density ? 0 : 1 });
        break;
      }
      case "body":
        writeWrapped(b.text, { size: 9.5, style: "normal", color: GRAY, lineH: 13, gapAfter: density ? 0 : 1 });
        break;
      case "gap":
        y += (density ? 2 : 4) * scale;
        break;
    }
  });

  return doc;
}

function safePdfName(filename: string) {
  return (
    filename
      .replace(/\.pdf$/i, "")
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50) || "CV_modifie"
  );
}

export async function downloadCvPdf(text: string, filename = "CV_modifie.pdf") {
  const doc = await buildCvDocPreferOnePage(text);
  doc.save(`${safePdfName(filename)}.pdf`);
}

export async function buildCvPdfBlob(text: string): Promise<Blob> {
  const doc = await buildCvDocPreferOnePage(text);
  return doc.output("blob");
}

async function buildCvDocPreferOnePage(text: string) {
  for (const density of [0, 1, 2] as const) {
    const doc = await buildCvDoc(text, density);
    if (doc.getNumberOfPages() <= 1) return doc;
  }
  return buildCvDoc(text, 2);
}
