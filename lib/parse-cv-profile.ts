export type CvProfile = {
  full_name: string;
  email: string;
  phone: string;
  location: string;
};

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+33\s?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}/;
const LOCATION_HINTS = [
  "Paris",
  "Lyon",
  "Marseille",
  "Bordeaux",
  "Lille",
  "Nantes",
  "Toulouse",
  "Remote",
  "France",
];

const NAME_STOP_WORDS = new Set([
  "apply",
  "aiapply",
  "job",
  "jobs",
  "jobapply",
  "cv",
  "resume",
  "résumé",
  "curriculum",
  "vitae",
  "profile",
  "profil",
  "contact",
  "candidat",
  "candidature",
  "linkedin",
  "jean",
  "paul",
  "email",
  "mail",
  "phone",
  "tel",
  "mobile",
  "address",
  "adresse",
  "experience",
  "expérience",
  "compétences",
  "competences",
  "skills",
  "summary",
  "about",
  "portfolio",
  "www",
  "http",
  "https",
  "generated",
  "powered",
]);

const GENERIC_EMAIL_LOCALS = new Set([
  "contact",
  "info",
  "hello",
  "admin",
  "support",
  "mail",
  "email",
  "apply",
  "cv",
  "job",
  "jobs",
  "user",
  "test",
  "demo",
  "noreply",
  "no-reply",
]);

function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Prénom + nom dérivés de l'adresse email (gregoire.linee@… → Gregoire Linée). */
export function nameFromEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "";

  const local = trimmed
    .slice(0, at)
    .replace(/\d+$/, "")
    .trim();
  if (local.length < 3 || GENERIC_EMAIL_LOCALS.has(local)) return "";

  const parts = local
    .split(/[._\-+]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !GENERIC_EMAIL_LOCALS.has(p));

  if (parts.length >= 2) {
    const words = parts.slice(0, 4).map(titleCaseWord);
    if (words.every((w) => !NAME_STOP_WORDS.has(w.toLowerCase()))) {
      return words.join(" ");
    }
  }

  if (parts.length === 1 && parts[0].length >= 4 && !NAME_STOP_WORDS.has(parts[0])) {
    return titleCaseWord(parts[0]);
  }

  return "";
}

function looksLikeNameStructure(line: string): boolean {
  const cleaned = normalizeName(line);
  if (cleaned.length < 4 || cleaned.length > 55) return false;
  if (EMAIL_RE.test(cleaned) || PHONE_RE.test(cleaned)) return false;
  if (/\d{2,}/.test(cleaned)) return false;
  if (/^(cv|curriculum|vitae|profil|expérience|experience|compétence|contact)/i.test(cleaned)) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[A-Za-zÀ-ÿ'’-]+$/.test(w));
}

function isPlausibleName(name: string, email?: string): boolean {
  const cleaned = normalizeName(name);
  if (!looksLikeNameStructure(cleaned)) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  const lowerWords = words.map((w) => w.toLowerCase());

  if (lowerWords.some((w) => NAME_STOP_WORDS.has(w))) return false;
  if (lowerWords.some((w) => w === "apply" || w.endsWith("apply"))) return false;

  // Faux positifs du type « AI APPLY », « TO APPLY »
  if (lowerWords.every((w) => w.length <= 4)) return false;

  if (email) {
    const fromEmail = nameFromEmail(email);
    if (fromEmail) {
      const emailParts = fromEmail.toLowerCase().split(/\s+/);
      const matchesEmail = lowerWords.some((w) =>
        emailParts.some((ep) => w === ep || w.startsWith(ep) || ep.startsWith(w))
      );
      if (!matchesEmail && lowerWords.some((w) => NAME_STOP_WORDS.has(w) || w.includes("apply"))) {
        return false;
      }
    }
  }

  return true;
}

function scoreNameAgainstEmail(name: string, email: string): number {
  const fromEmail = nameFromEmail(email);
  if (!fromEmail) return 0;

  const nameWords = name.toLowerCase().split(/\s+/);
  const emailParts = fromEmail.toLowerCase().split(/\s+/);
  let score = 0;

  for (const ep of emailParts) {
    for (const nw of nameWords) {
      if (nw === ep) score += 4;
      else if (nw.startsWith(ep) || ep.startsWith(nw)) score += 2;
    }
  }
  return score;
}

function extractNameNearEmail(lines: string[], email: string): string {
  const emailLower = email.toLowerCase();
  const local = emailLower.split("@")[0] ?? "";

  for (const line of lines.slice(0, 25)) {
    const lineLower = line.toLowerCase();
    if (!lineLower.includes(emailLower) && !lineLower.includes(local)) continue;

    let candidate = line
      .replace(EMAIL_RE, " ")
      .replace(/[|·•,/;()[\]{}<>@]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (candidate && isPlausibleName(candidate, email)) {
      return normalizeName(candidate);
    }
  }

  return "";
}

/** Nom fiable : CV d'abord, sinon dérivé de l'email si le CV est douteux. */
export function resolveFullName(fullName: string, email: string): string {
  const cleaned = normalizeName(fullName);
  if (cleaned && isPlausibleName(cleaned, email)) return cleaned;
  if (email) {
    const fromEmail = nameFromEmail(email);
    if (fromEmail) return fromEmail;
  }
  return cleaned;
}

function pickNameFromLines(lines: string[], email: string): string {
  if (email) {
    const nearEmail = extractNameNearEmail(lines, email);
    if (nearEmail) return nearEmail;
  }

  const candidates: string[] = [];
  for (const line of lines.slice(0, 15)) {
    const cleaned = normalizeName(line);
    if (isPlausibleName(cleaned, email)) {
      candidates.push(cleaned);
    }
  }

  if (email && candidates.length > 1) {
    candidates.sort(
      (a, b) => scoreNameAgainstEmail(b, email) - scoreNameAgainstEmail(a, email)
    );
  }

  if (candidates.length > 0) return candidates[0];

  if (email) {
    const fromEmail = nameFromEmail(email);
    if (fromEmail) return fromEmail;
  }

  return "";
}

export function parseCvProfile(text: string): CvProfile {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const joined = lines.join(" ");
  const emailMatch = joined.match(EMAIL_RE);
  const phoneMatch = joined.match(PHONE_RE);
  const email = emailMatch?.[0] ?? "";

  let full_name = pickNameFromLines(lines, email);
  full_name = resolveFullName(full_name, email);

  let location = "";
  for (const hint of LOCATION_HINTS) {
    const re = new RegExp(`\\b${hint}\\b`, "i");
    const hit = lines.slice(0, 12).find((l) => re.test(l) && l.length < 40);
    if (hit) {
      const cityMatch = hit.match(/\b(Paris|Lyon|Marseille|Bordeaux|Lille|Nantes|Toulouse)\b/i);
      location = cityMatch ? cityMatch[1] : hint;
      break;
    }
  }

  return {
    full_name,
    email,
    phone: phoneMatch ? normalizePhone(phoneMatch[0]) : "",
    location,
  };
}
