/**
 * Préserve la structure d'un CV texte lors d'une retouche wording.
 */

const SECTION_RE =
  /^(exp[eé]rience|experience|formation|education|comp[eé]tences|skills|outils|tools|langues|languages|automation)/i;

function isSectionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 2 && letters === letters.toUpperCase() && t.length <= 48) {
    return true;
  }
  return SECTION_RE.test(t) && t.length <= 48;
}

function isBulletLine(line: string): boolean {
  return /^[•\-*·▪]\s?/.test(line.trim());
}

function bulletBody(line: string): string {
  return line.trim().replace(/^[•\-*·▪]\s?/, "").trim();
}

/**
 * Réinjecte le wording retouché dans le squelette du CV d'origine.
 */
export function lockCvStructure(original: string, refined: string): string {
  const origLines = original.replace(/\r/g, "").split("\n");
  const refLines = refined.replace(/\r/g, "").split("\n");

  // Cas idéal : même nombre de lignes → merge ligne à ligne.
  if (refLines.length === origLines.length) {
    return origLines
      .map((orig, i) => mergeLine(orig, refLines[i] ?? ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }

  // Sinon : aligne en ignorant les décalages de lignes vides.
  const out: string[] = [];
  let j = 0;
  for (const orig of origLines) {
    const origTrim = orig.trim();
    if (!origTrim) {
      out.push("");
      if (j < refLines.length && !refLines[j].trim()) j += 1;
      continue;
    }

    while (j < refLines.length && !refLines[j].trim()) j += 1;
    const ref = j < refLines.length ? refLines[j] : "";
    if (j < refLines.length) j += 1;
    out.push(mergeLine(orig, ref));
  }

  const joined = out.join("\n").trim();
  if (joined.length < Math.min(80, original.trim().length * 0.4)) {
    return original;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function mergeLine(original: string, refined: string): string {
  const origTrim = original.trim();
  if (!origTrim) return "";

  // Sections figées (forme).
  if (isSectionLine(origTrim)) {
    return origTrim.toUpperCase();
  }

  const refTrim = refined.trim();
  if (!refTrim) return original.startsWith(" ") ? original : origTrim;

  // Puces : préfixe • conservé, wording échangeable.
  if (isBulletLine(origTrim)) {
    const body = bulletBody(refTrim) || bulletBody(origTrim);
    return `• ${body}`;
  }

  // Ne laisse pas une section/puce écraser une ligne normale.
  if (isSectionLine(refTrim) || isBulletLine(refTrim)) {
    return origTrim;
  }

  return refTrim;
}

export function splitCvLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

export function formatNumberedCv(text: string): string {
  return splitCvLines(text)
    .map((line, i) => `${String(i + 1).padStart(3, "0")}|${line}`)
    .join("\n");
}

export function parseNumberedCv(raw: string, expectedLines: number): string | null {
  const lines = raw.replace(/\r/g, "").split("\n");
  const byIndex = new Map<number, string>();

  for (const line of lines) {
    const m = line.match(/^\s*(\d{1,4})\s*[|\t](.*)$/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    if (idx < 1 || idx > expectedLines + 10) continue;
    byIndex.set(idx, m[2]);
  }

  if (byIndex.size < Math.max(3, Math.floor(expectedLines * 0.5))) {
    return null;
  }

  const out: string[] = [];
  for (let i = 1; i <= expectedLines; i++) {
    out.push(byIndex.has(i) ? byIndex.get(i)! : "");
  }
  return out.join("\n");
}
