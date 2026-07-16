const MAX_CHARS = 12_000;

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

type PdfLine = { y: number; height: number; text: string };

/**
 * Reconstruit le texte d'une page en préservant la structure visuelle
 * (sauts de ligne, sections, puces) à partir des positions des fragments.
 *
 * `unpdf`/pdfjs renvoie des fragments non ordonnés avec leur position
 * (`transform` = [a,b,c,d,x,y]). On regroupe par ligne via la coordonnée Y,
 * on ordonne par X, et on insère une ligne vide quand l'écart vertical trahit
 * un changement de bloc. Sans ça, tout est collé en un seul paragraphe.
 */
function reconstructPageText(rawItems: PdfTextItem[]): string {
  const items = rawItems.filter(
    (it) => typeof it.str === "string" && Array.isArray(it.transform)
  );
  if (!items.length) return "";

  // Regroupe les fragments partageant approximativement la même ligne (Y).
  const lines: PdfLine[] = [];
  const sorted = [...items].sort((a, b) => {
    const ya = a.transform![5];
    const yb = b.transform![5];
    if (Math.abs(ya - yb) > 1) return yb - ya; // haut → bas
    return a.transform![4] - b.transform![4]; // gauche → droite
  });

  type Cluster = { y: number; height: number; parts: PdfTextItem[] };
  const clusters: Cluster[] = [];
  for (const it of sorted) {
    const y = it.transform![5];
    const h = it.height || Math.abs(it.transform![3]) || 10;
    const tol = Math.max(2, h * 0.5);
    const current = clusters[clusters.length - 1];
    if (current && Math.abs(current.y - y) <= tol) {
      current.parts.push(it);
      current.height = Math.max(current.height, h);
    } else {
      clusters.push({ y, height: h, parts: [it] });
    }
  }

  for (const cluster of clusters) {
    const parts = cluster.parts.sort(
      (a, b) => a.transform![4] - b.transform![4]
    );
    let text = "";
    let prevEnd: number | null = null;
    for (const p of parts) {
      const str = p.str ?? "";
      const x = p.transform![4];
      const w = p.width ?? 0;
      if (prevEnd != null) {
        const gap = x - prevEnd;
        const spaceThreshold = Math.max(1, cluster.height * 0.25);
        const needsSpace =
          gap > spaceThreshold &&
          !text.endsWith(" ") &&
          !str.startsWith(" ");
        if (needsSpace) text += " ";
      }
      text += str;
      prevEnd = x + w;
    }
    const trimmed = text.trim();
    if (trimmed) lines.push({ y: cluster.y, height: cluster.height, text: trimmed });
  }

  if (!lines.length) return "";

  // Écart vertical médian entre lignes → au-delà, on insère une respiration.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0;

  const out: string[] = [lines[0].text];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (medianGap > 0 && gap > medianGap * 1.6) out.push("");
    out.push(lines[i].text);
  }
  return out.join("\n");
}

/**
 * Extraction de texte via `unpdf` (build pdfjs "serverless", 100 % JS).
 * Aucune dépendance native (pas de `@napi-rs/canvas`/`DOMMatrix`) : marche
 * de façon identique en local et sur l'hébergement mutualisé.
 */
export async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = reconstructPageText(content.items as PdfTextItem[]);
      if (pageText) pages.push(pageText);
    }
    return pages.join("\n\n");
  } catch (err) {
    console.error("[pdf-text] extractText failed:", err);
    throw err;
  }
}

export function cleanDocumentText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}
