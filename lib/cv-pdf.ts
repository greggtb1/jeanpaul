type Block =
  | { kind: "banner"; text: string }
  | { kind: "name"; text: string }
  | { kind: "tagline"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "section"; text: string }
  | { kind: "job"; title: string; period: string }
  | { kind: "company"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "body"; text: string }
  | { kind: "gap" };

// Palette alignée sur engine/generators/cv_builder.py
const DARK: [number, number, number] = [26, 26, 46];
const GRAY: [number, number, number] = [85, 85, 85];
const LIGHT: [number, number, number] = [136, 136, 136];
const BODY: [number, number, number] = [51, 51, 51];

const SECTION_WORDS =
  /^(exp[eé]rience|experience|formation|education|comp[eé]tences(?:\s*&\s*outils)?|skills(?:\s*&\s*tools)?|outils|tools|langues|languages|automation)/i;

/** Dates en fin de ligne (titre de poste / diplôme). */
const PERIOD_RE =
  /(\d{4}\s*[,/\-–—]\s*(?:\d{4}|pr[eé]sent|present|aujourd.?hui|now|current|actuel(?:le)?)|\d{4}\s*[-–—]\s*\d{2}|\b(?:janv?|f[eé]vr?|mars|avr|mai|juin|juil|ao[uû]t|sept?|oct|nov|d[eé]c)[a-z.]*\.?\s+\d{4}(?:\s*[-–—]\s*(?:(?:janv?|f[eé]vr?|mars|avr|mai|juin|juil|ao[uû]t|sept?|oct|nov|d[eé]c)[a-z.]*\.?\s+)?(?:\d{4}|pr[eé]sent|present|aujourd.?hui))?|(?:pr[eé]sent|present|aujourd.?hui|now|current)\s*$|\d{4})\s*$/i;

const PERIOD_ONLY_RE =
  /^(?:\d{4}\s*[,/\-–—]\s*(?:\d{4}|pr[eé]sent|present|aujourd.?hui|now|current|actuel(?:le)?)|\d{4}\s*[-–—]\s*\d{2}|(?:janv?|f[eé]vr?|mars|avr|mai|juin|juil|ao[uû]t|sept?|oct|nov|d[eé]c)[a-z.]*\.?\s+\d{4}(?:\s*[-–—].*)?|\d{4}|pr[eé]sent|present)$/i;

function isUpperSection(line: string): boolean {
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase() && line.length <= 48;
}

function isSection(line: string): boolean {
  return isUpperSection(line) || (SECTION_WORDS.test(line) && line.length <= 48);
}

function isExperienceOrEducation(section: string): boolean {
  return /exp[eé]rience|experience|formation|education/i.test(section);
}

function isContact(line: string): boolean {
  return (/@|\+?\d[\d\s().-]{6,}/.test(line) || /·\s*[^·]+·/.test(line)) && line.length <= 120;
}

function splitJobPeriod(line: string): { title: string; period: string } | null {
  const m = line.match(PERIOD_RE);
  if (!m || m.index == null) return null;
  const period = m[0].trim();
  const title = line.slice(0, m.index).trim().replace(/[|·•]\s*$/, "").trim();
  if (!title || title.length < 3) return null;
  // évite de traiter une ligne "contact" ou banner comme job
  if (isContact(line) || line.includes("@")) return null;
  // année seule : exiger un vrai intitulé (pas juste un chiffre collé)
  if (/^\d{4}$/.test(period) && title.length < 5) return null;
  return { title, period };
}

function classifyLines(text: string): Block[] {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let sawName = false;
  let sawSection = false;
  let lastWasJob = false;
  let currentSection = "";
  let pendingJobTitle: string | null = null;

  const flushPendingTitle = () => {
    if (!pendingJobTitle) return;
    blocks.push({ kind: "body", text: pendingJobTitle });
    pendingJobTitle = null;
  };

  rawLines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushPendingTitle();
      blocks.push({ kind: "gap" });
      lastWasJob = false;
      return;
    }

    if (isSection(line)) {
      flushPendingTitle();
      currentSection = line.toUpperCase();
      blocks.push({ kind: "section", text: currentSection });
      sawSection = true;
      lastWasJob = false;
      return;
    }

    if (/^[•\-*·▪]\s?/.test(line)) {
      flushPendingTitle();
      blocks.push({ kind: "bullet", text: line.replace(/^[•\-*·▪]\s?/, "").trim() });
      lastWasJob = false;
      return;
    }

    // Bannière offre (début, souvent avec ·)
    if (
      !sawName &&
      !sawSection &&
      i <= 2 &&
      (line.includes("·") || /\b(cdi|cdd|stage|alternance|remote|paris|lyon)\b/i.test(line)) &&
      line.length <= 110
    ) {
      flushPendingTitle();
      blocks.push({ kind: "banner", text: line });
      return;
    }

    if (isContact(line)) {
      flushPendingTitle();
      blocks.push({ kind: "contact", text: line });
      lastWasJob = false;
      return;
    }

    // Date seule juste après un titre en attente → poste gras
    if (
      pendingJobTitle &&
      PERIOD_ONLY_RE.test(line) &&
      isExperienceOrEducation(currentSection)
    ) {
      blocks.push({ kind: "job", title: pendingJobTitle, period: line });
      pendingJobTitle = null;
      lastWasJob = true;
      return;
    }

    const job = splitJobPeriod(line);
    if (job && (sawSection || /\d{4}/.test(job.period))) {
      flushPendingTitle();
      blocks.push({ kind: "job", title: job.title, period: job.period });
      lastWasJob = true;
      return;
    }

    // Sous EXPERIENCE/FORMATION : titre court sans date → attendre la ligne suivante
    if (
      sawSection &&
      isExperienceOrEducation(currentSection) &&
      !lastWasJob &&
      line.length <= 90 &&
      !line.endsWith(".") &&
      !/\d{4}/.test(line)
    ) {
      flushPendingTitle();
      pendingJobTitle = line;
      return;
    }

    // Ligne entreprise juste après un poste
    if (lastWasJob && line.length <= 80 && !line.endsWith(".")) {
      flushPendingTitle();
      blocks.push({ kind: "company", text: line });
      lastWasJob = false;
      return;
    }

    // Titre en attente suivi d'une entreprise (date absente) → gras sans période
    if (pendingJobTitle && line.length <= 80 && !line.endsWith(".")) {
      blocks.push({ kind: "job", title: pendingJobTitle, period: "" });
      blocks.push({ kind: "company", text: line });
      pendingJobTitle = null;
      lastWasJob = false;
      return;
    }

    flushPendingTitle();
    lastWasJob = false;

    // Nom : première ligne courte non-section avant le corps
    if (
      !sawName &&
      !sawSection &&
      line.length <= 48 &&
      !line.includes("·") &&
      !/@/.test(line) &&
      line.split(/\s+/).length <= 5
    ) {
      blocks.push({ kind: "name", text: line });
      sawName = true;
      return;
    }

    // Tagline : phrase après le nom, avant les sections
    if (sawName && !sawSection && line.length > 40) {
      blocks.push({ kind: "tagline", text: line });
      return;
    }

    blocks.push({ kind: "body", text: line });
  });

  flushPendingTitle();
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
      case "banner":
        writeWrapped(b.text, {
          size: 8.5,
          style: "normal",
          color: LIGHT,
          lineH: 12,
          gapBefore: density ? 2 : 4,
          gapAfter: density ? 4 : 8,
        });
        break;
      case "name":
        writeWrapped(b.text, {
          size: 22,
          style: "bold",
          color: DARK,
          lineH: 26,
          gapBefore: density ? 2 : 6,
          gapAfter: 2,
        });
        break;
      case "tagline":
        writeWrapped(b.text, {
          size: 10,
          style: "italic",
          color: GRAY,
          lineH: 14,
          gapAfter: 3,
        });
        break;
      case "contact":
        writeWrapped(b.text, {
          size: 9,
          style: "normal",
          color: LIGHT,
          lineH: 13,
          gapAfter: 6,
        });
        break;
      case "section": {
        y += (density ? 8 : 12) * scale;
        ensureSpace(20);
        writeWrapped(b.text.toUpperCase(), {
          size: 9,
          style: "bold",
          color: DARK,
          lineH: 12,
        });
        hrule(DARK, 1);
        y += 6 * scale;
        break;
      }
      case "job": {
        y += (density ? 4 : 8) * scale;
        ensureSpace(16);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5 * scale);
        doc.setTextColor(DARK[0], DARK[1], DARK[2]);
        const periodW = b.period ? doc.getTextWidth(b.period) : 0;
        const titleMax = maxWidth - (periodW ? periodW + 10 : 0);
        const titleLines = doc.splitTextToSize(b.title, titleMax);
        doc.text(titleLines[0], margin, y);
        if (b.period) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5 * scale);
          doc.setTextColor(LIGHT[0], LIGHT[1], LIGHT[2]);
          doc.text(b.period, pageW - margin, y, { align: "right" });
        }
        y += 13 * scale;
        for (let i = 1; i < titleLines.length; i++) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10.5 * scale);
          doc.setTextColor(DARK[0], DARK[1], DARK[2]);
          doc.text(titleLines[i], margin, y);
          y += 12 * scale;
        }
        break;
      }
      case "company":
        writeWrapped(b.text, {
          size: 9.5,
          style: "italic",
          color: GRAY,
          lineH: 13,
          gapAfter: 2,
        });
        break;
      case "bullet": {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5 * scale);
        doc.setTextColor(BODY[0], BODY[1], BODY[2]);
        ensureSpace(13 * scale);
        doc.text("•", margin + 2, y);
        writeWrapped(b.text, {
          size: 9.5,
          style: "normal",
          color: BODY,
          lineH: 13,
          indent: 12,
          gapAfter: density ? 1 : 2,
        });
        break;
      }
      case "body":
        writeWrapped(b.text, {
          size: 9.5,
          style: "normal",
          color: GRAY,
          lineH: 13,
          gapAfter: density ? 0 : 1,
        });
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
