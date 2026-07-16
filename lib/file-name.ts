const NAME_JUNK = new Set([
  "application",
  "for",
  "company",
  "candidature",
  "pour",
  "entreprise",
  "candidat",
  "candidate",
  "cv",
  "resume",
  "lettre",
  "motivation",
  "cover",
  "letter",
  "profile",
  "profil",
  "job",
  "jobs",
  "role",
  "poste",
]);

/**
 * Mots typiques d'intitulés de poste : leur présence trahit un titre d'offre
 * capturé à la place d'un vrai nom (ex. « Customer Operations Lead Bigblue »).
 */
const JOB_TITLE_WORDS = new Set([
  "lead",
  "manager",
  "management",
  "operations",
  "operation",
  "customer",
  "success",
  "officer",
  "engineer",
  "engineering",
  "developer",
  "developpeur",
  "director",
  "directeur",
  "directrice",
  "head",
  "senior",
  "junior",
  "intern",
  "internship",
  "stagiaire",
  "alternant",
  "alternance",
  "specialist",
  "specialiste",
  "consultant",
  "consultante",
  "analyst",
  "analyste",
  "coordinator",
  "coordinateur",
  "coordinatrice",
  "associate",
  "executive",
  "assistant",
  "assistante",
  "responsable",
  "charge",
  "chargee",
  "ingenieur",
  "ingenieure",
  "product",
  "project",
  "projet",
  "marketing",
  "sales",
  "account",
  "growth",
  "designer",
  "design",
  "data",
  "software",
  "fullstack",
  "frontend",
  "backend",
  "devops",
  "recruiter",
  "recruteur",
  "hr",
  "rh",
  "finance",
  "chef",
  "cheffe",
  "owner",
  "scientist",
  "technicien",
  "technicienne",
  "support",
  "commercial",
  "commerciale",
]);

/**
 * Nom de personne exploitable pour signature / fichier (pas un label de template
 * CV ni un intitulé de poste capturé par erreur).
 */
export function isPlausiblePersonName(fullName: string | null | undefined): boolean {
  const clean = (fullName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s'-]/g, " ")
    .trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();
  if (lower === "candidat" || lower === "candidate") return false;
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return false;
  const lowerParts = parts.map((p) => p.toLowerCase());
  if (lowerParts.every((p) => NAME_JUNK.has(p))) return false;
  const junkCount = lowerParts.filter((p) => NAME_JUNK.has(p)).length;
  // Ex. « APPLICATION FOR COMPANY » / « Candidature Pour Entreprise »
  if (junkCount >= 2) return false;
  // Ex. « Customer Operations Lead Bigblue » : un seul mot d'intitulé suffit à écarter.
  if (lowerParts.some((p) => JOB_TITLE_WORDS.has(p))) return false;
  return true;
}

/**
 * Construit un suffixe de nom de fichier « _Prenom_Nom » à partir d'un nom complet.
 * Retourne "" si aucun nom exploitable n'est trouvé.
 */
export function nameFileSuffix(fullName: string | null | undefined): string {
  if (!isPlausiblePersonName(fullName)) return "";
  const clean = (fullName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean).slice(0, 3);
  if (!parts.length) return "";
  return "_" + parts.join("_");
}
