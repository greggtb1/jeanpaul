import { isPlausiblePersonName } from "@/lib/file-name";

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
  "application",
  "for",
  "company",
  "pour",
  "entreprise",
  "lettre",
  "motivation",
  "cover",
  "letter",
  "role",
  "poste",
]);

const NAME_JUNK_PHRASES = [
  "application for company",
  "application for",
  "candidature pour entreprise",
  "candidature pour",
];

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

function isPlausibleName(name: string, _email?: string): boolean {
  const cleaned = normalizeName(name);
  if (!looksLikeNameStructure(cleaned)) return false;
  // Source de vérité : écarte intitulés de poste, bannières, labels template.
  return isPlausiblePersonName(cleaned);
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

/** Prénom + nom depuis le nom de fichier (Thomas_Petit_….pdf → Thomas Petit). */
export function nameFromCvFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").trim();
  const tokens = base.split(/[_\-\s]+/).filter(Boolean);
  const words: string[] = [];

  for (const token of tokens) {
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*$/.test(token)) break;
    if (NAME_STOP_WORDS.has(token.toLowerCase())) break;
    if (/^(cdi|cdd|stage|alternance|dev|fullstack|saas|cv|resume)$/i.test(token)) break;
    words.push(titleCaseWord(token));
    if (words.length >= 4) break;
  }

  if (words.length >= 2) {
    const joined = words.join(" ");
    return isPlausiblePersonName(joined) ? joined : "";
  }
  return "";
}

function collectEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(new RegExp(EMAIL_RE.source, "g"))) {
    const em = match[0].toLowerCase();
    if (!seen.has(em)) {
      seen.add(em);
      out.push(match[0]);
    }
  }
  return out;
}

/** Ne retient un email que s'il correspond au nom extrait du CV. */
function pickEmailForName(emails: string[], fullName: string): string {
  if (emails.length === 0) return "";
  const nameParts = fullName
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !NAME_STOP_WORDS.has(p));
  if (nameParts.length === 0) return "";

  let best = "";
  let bestScore = 0;
  for (const em of emails) {
    const local = em.split("@")[0].toLowerCase().replace(/[._+\-]/g, " ");
    let score = 0;
    for (const part of nameParts) {
      if (local.includes(part)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = em;
    }
  }
  return bestScore > 0 ? best : "";
}

/** Retourne le nom s'il est lisible dans le CV, sinon chaîne vide (l'utilisateur complète). */
export function resolveFullName(fullName: string): string {
  const cleaned = normalizeName(fullName);
  if (cleaned && isPlausibleName(cleaned, "")) {
    return cleaned;
  }
  return "";
}

/** Identité depuis le CV uniquement — jamais de fallback sur d'anciennes valeurs. */
export function identityFromCvExtraction(
  profile: CvProfile,
  filename: string,
  rawText = ""
): CvProfile {
  const full_name =
    resolveFullName(profile.full_name) || nameFromCvFilename(filename);
  const emails = collectEmails(rawText || profile.email);
  const email = pickEmailForName(emails, full_name);

  return {
    full_name,
    email,
    phone: profile.phone?.trim() || "",
    location: profile.location?.trim() || "",
  };
}

function pickNameFromLines(lines: string[], cvEmail: string): string {
  if (cvEmail) {
    const nearEmail = extractNameNearEmail(lines, cvEmail);
    if (nearEmail && isPlausibleName(nearEmail, "")) return nearEmail;
  }

  for (const line of lines.slice(0, 15)) {
    // Ignore bannières d'offre / lignes mélangées (poste · entreprise).
    if (/[·|]/.test(line) || /\s[-–—]\s/.test(line)) continue;
    if (/\b(cdi|cdd|stage|alternance|remote|full[\s-]?remote)\b/i.test(line)) continue;
    const cleaned = normalizeName(line);
    if (isPlausibleName(cleaned, "")) {
      return cleaned;
    }
  }

  return "";
}

export function parseCvProfile(text: string): CvProfile {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const joined = lines.join(" ");
  const emails = collectEmails(joined);
  const phoneMatch = joined.match(PHONE_RE);
  const full_name = pickNameFromLines(lines, emails[0] ?? "");
  const email = pickEmailForName(emails, full_name);

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
