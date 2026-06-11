import type { PipelineRun } from "@/components/PipelineLog";

export type PipelineRunMode = "full" | "autoapply" | "analyze";

export type PipelineSubPhase =
  | "boot"
  | "scrape_prepare"
  | "scrape_query"
  | "scrape_desc"
  | "scrape_done"
  | "analyze"
  | "hunt_fill"
  | "generate"
  | "sync"
  | "autoapply_boot"
  | "autoapply_fill"
  | "autoapply_ready"
  | "done";

export type PipelinePhase = {
  mode: PipelineRunMode;
  step: 0 | 1 | 2 | 3;
  subPhase: PipelineSubPhase;
  stepLabel: string;
  detail: string;
  subdetail: string;
  lastLine: string;
  queriesTotal: number;
  queriesDone: number;
  currentQuery: string | null;
  maxPerQuery: number;
  offersThisQuery: number;
  descCurrent: number;
  descTotal: number;
  offersNew: number;
  offersTotal: number;
  analyzeTotal: number;
  analyzeDone: number;
  qualifying: number;
  generated: number;
  generateMax: number;
  autoapplyCurrent: number;
  autoapplyTotal: number;
  autoapplyReady: number;
  formPage: number;
  progress: number;
};

const FULL_STEPS = [
  { id: 1 as const, label: "Recherche + analyse" },
  { id: 2 as const, label: "CV + lettres" },
];

const ANALYZE_STEPS = [
  { id: 1 as const, label: "Analyse" },
  { id: 2 as const, label: "CV + lettres" },
];

const AUTOAPPLY_STEPS = [
  { id: 1 as const, label: "Préparation" },
  { id: 2 as const, label: "Remplissage" },
  { id: 3 as const, label: "Validation" },
];

export function getPipelineSteps(mode: PipelineRunMode = "full") {
  if (mode === "autoapply") return AUTOAPPLY_STEPS;
  if (mode === "analyze") return ANALYZE_STEPS;
  return FULL_STEPS;
}

export function isAutoapplyRun(run: PipelineRun | null): boolean {
  const log = run?.log || "";
  if (run?.result?.mode === "autoapply") return true;
  return /Auto-apply|auto-apply|main\.py auto-apply|onglet\(s\) prêt|Remplissage — \d+ onglet/i.test(
    log
  );
}

function lastNonEmptyLine(log: string): string {
  const lines = log.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function countAfterMarker(log: string, marker: RegExp, pattern: RegExp): number {
  const m = log.match(marker);
  if (!m || m.index === undefined) return 0;
  const slice = log.slice(m.index);
  return [...slice.matchAll(pattern)].length;
}

function parseAutoapplyMetrics(log: string) {
  const totalMatch =
    log.match(/(\d+)\s+candidature\(s\)\s+à processer/i) ||
    log.match(/Auto-apply\s*:\s*(\d+)\s+candidature/i) ||
    log.match(/Remplissage —\s*(\d+)\s+onglet/i) ||
    log.match(/(\d+)\s+offre\(s\)\s+sélectionnée\(s\)/i);

  const jobBox = [...log.matchAll(/[│|]\s*\((\d+)\/(\d+)\)/g)].pop();
  const candidatureLine = [...log.matchAll(/Candidature\s+(\d+)\/(\d+)/gi)].pop();
  const readySummary = log.match(/(\d+)\/(\d+)\s+onglet\(s\)\s+prêt/i);
  const ongletReady = [...log.matchAll(/Onglet\s+(\d+)(?:\/(\d+))?\s+prêt/gi)];
  const pageMatch = [...log.matchAll(/──\s*Page\s+(\d+)/gi)].pop();

  let autoapplyTotal = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  let autoapplyCurrent = 0;
  let autoapplyReady = 0;

  if (readySummary) {
    autoapplyReady = parseInt(readySummary[1], 10);
    autoapplyTotal = parseInt(readySummary[2], 10) || autoapplyTotal;
    autoapplyCurrent = autoapplyReady;
  } else if (jobBox) {
    autoapplyCurrent = parseInt(jobBox[1], 10);
    autoapplyTotal = parseInt(jobBox[2], 10) || autoapplyTotal;
  } else if (candidatureLine) {
    autoapplyCurrent = parseInt(candidatureLine[1], 10);
    autoapplyTotal = parseInt(candidatureLine[2], 10) || autoapplyTotal;
  }

  if (ongletReady.length) {
    const last = ongletReady[ongletReady.length - 1];
    autoapplyReady = parseInt(last[1], 10);
    if (last[2]) autoapplyTotal = parseInt(last[2], 10) || autoapplyTotal;
  }

  const formPage = pageMatch ? parseInt(pageMatch[1], 10) : 0;

  return { autoapplyCurrent, autoapplyTotal, autoapplyReady, formPage };
}

export function parsePipelinePhase(
  run: PipelineRun | null,
  _jobsFound = 0
): PipelinePhase {
  const log = run?.log || "";
  const backendProgress = run?.progress ?? 0;
  const lastLine = lastNonEmptyLine(log);
  const autoapply = isAutoapplyRun(run);
  const analyzeOnly = /Reprise\s*:\s*analyse|sans scraping|mode.*analyze/i.test(log);
  const mode: PipelineRunMode = autoapply
    ? "autoapply"
    : analyzeOnly || run?.result?.mode === "analyze"
      ? "analyze"
      : "full";

  const {
    autoapplyCurrent,
    autoapplyTotal,
    autoapplyReady,
    formPage,
  } = parseAutoapplyMetrics(log);

  const step1 = /──\s*Étape\s*1/i.test(log);
  const step2 = /──\s*Étape\s*2/i.test(log);
  const step3 = /──\s*Étape\s*3/i.test(log);
  const step2Generate = /──\s*Étape\s*2\s*:\s*Génération/i.test(log);
  const huntPipeline = /Recherche \+ analyse|Hunt-fill|cible\s*:\s*\d+\s+offres/i.test(log);

  let step: 0 | 1 | 2 | 3 = 0;
  if (autoapply) {
    if (
      run?.status === "done" ||
      /Auto-apply terminé/i.test(log)
    ) {
      step = 3;
    } else if (
      /onglet\(s\) prêt|Ferme la fenêtre Chromium|Va sur chaque onglet|Chromium reste ouvert/i.test(
        log
      )
    ) {
      step = 3;
    } else if (
      autoapplyCurrent > 0 ||
      formPage > 0 ||
      /Formulaire prêt|Remplissage —|candidature\(s\) à processer/i.test(log)
    ) {
      step = 2;
    } else if (run?.status === "running" || run?.status === "pending") {
      step = 1;
    }
  } else if (mode === "analyze") {
    if (step3) step = 2;
    else if (step2) step = 1;
    else if (run?.status === "running" || run?.status === "pending") step = 1;
  } else if (huntPipeline) {
    if (step2Generate || step3) step = 2;
    else if (step1 || run?.status === "running" || run?.status === "pending") step = 1;
  } else if (step3) step = 3;
  else if (step2) step = 2;
  else if (step1 || run?.status === "running" || run?.status === "pending") step = 1;

  const reqMatch = log.match(/Requetes\s*:\s*([^\n]+)/i);
  const queriesFromLog = reqMatch
    ? reqMatch[1].split(",").map((s) => s.trim()).filter(Boolean).length
    : 0;

  const queryMatches = [...log.matchAll(/LinkedIn\s*->\s*([^\n]+)/gi)];
  const queriesDone = queryMatches.length;
  const queriesTotal = queriesFromLog || queriesDone || 0;
  const currentQuery = queriesDone
    ? queryMatches[queriesDone - 1][1].trim()
    : null;

  const maxMatch = log.match(/Max\/requete\s*:\s*(\d+)/i);
  const maxPerQuery = maxMatch ? parseInt(maxMatch[1], 10) : 18;

  const offerMatches = [...log.matchAll(/(\d+)\s+offres?\s+trouv[eé]es?/gi)];
  const offersThisQuery = offerMatches.length
    ? parseInt(offerMatches[offerMatches.length - 1][1], 10)
    : 0;

  const descMatch = [...log.matchAll(/\[(\d+)\/(\d+)\]\s*Desc/gi)].pop();
  const descCurrent = descMatch ? parseInt(descMatch[1], 10) : 0;
  const descTotal = descMatch ? parseInt(descMatch[2], 10) : 0;

  const newMatch = log.match(/(\d+)\s+nouvelles?\s+offres?\s+ajout[eé]es?/i);
  const offersNew = newMatch ? parseInt(newMatch[1], 10) : 0;

  const totalMatch = log.match(/Total en base\s*:\s*(\d+)/i);
  const offersTotal = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  const analyzeMatch = log.match(/Analyse de (\d+)/i);
  const analyzeTotal = analyzeMatch ? parseInt(analyzeMatch[1], 10) : offersNew || 0;
  const analyzeDone = countAfterMarker(log, /──\s*Étape\s*2/i, /^\s+->\s+/gm);

  const qualRunMatch = log.match(/(\d+)\s+nouvelle\(s\)\s+offre\(s\)\s+≥6\/10/i);
  const qualHuntMatches = [...log.matchAll(/Qualifiante\s+(\d+)(?:\/(\d+))?/gi)];
  const qualHuntDetail = qualHuntMatches.length ? qualHuntMatches[qualHuntMatches.length - 1] : null;
  const huntTargetMatch = log.match(/arrêt à (\d+) offres|cible\s*:\s*(\d+)\s+offres/i);
  const huntTarget = huntTargetMatch
    ? parseInt(huntTargetMatch[1] || huntTargetMatch[2], 10)
    : 10;
  const qualifying = qualRunMatch
    ? parseInt(qualRunMatch[1], 10)
    : qualHuntDetail
      ? parseInt(qualHuntDetail[1], 10)
      : qualHuntMatches.length
        ? parseInt(qualHuntMatches[qualHuntMatches.length - 1][1], 10)
        : 0;

  const genMatches = [...log.matchAll(/Candidature\s+(\d+)\/(\d+)/gi)];
  const generated = genMatches.length
    ? parseInt(genMatches[genMatches.length - 1][1], 10)
    : 0;
  const generateMax = genMatches.length
    ? parseInt(genMatches[genMatches.length - 1][2], 10)
    : 10;

  const huntFill = /chasse élargie|Hunt-fill|Recherche \+ analyse|Qualifiante/i.test(log);
  const syncing = /Synchronisation des documents/i.test(log);
  const scrapeDone = offersNew > 0 || /Total en base/i.test(log);

  let subPhase: PipelineSubPhase = "boot";
  if (autoapply) {
    if (run?.status === "done" || /Auto-apply terminé/i.test(log)) subPhase = "done";
    else if (step === 3) subPhase = "autoapply_ready";
    else if (step === 2) subPhase = "autoapply_fill";
    else subPhase = "autoapply_boot";
  } else if (run?.status === "done") subPhase = "done";
  else if (syncing) subPhase = "sync";
  else if (step === 2 && (step2Generate || step3 || mode === "full" || mode === "analyze"))
    subPhase = "generate";
  else if (step === 1 && huntFill && huntPipeline) subPhase = "hunt_fill";
  else if (step === 2) subPhase = huntFill ? "hunt_fill" : "analyze";
  else if (step === 3) subPhase = "generate";
  else if (step === 1) {
    if (scrapeDone) subPhase = "scrape_done";
    else if (descCurrent > 0) subPhase = "scrape_desc";
    else if (queriesDone > 0) subPhase = "scrape_query";
    else if (/Scraping/i.test(log)) subPhase = "scrape_prepare";
    else subPhase = "boot";
  }

  let stepLabel = "Démarrage";
  let detail = "Initialisation du moteur";
  let subdetail = "";

  if (subPhase === "boot") {
    stepLabel = "Connexion au moteur";
    detail = "Préparation des requêtes LinkedIn";
  } else if (subPhase === "scrape_prepare") {
    stepLabel = "Scraping LinkedIn";
    detail = queriesTotal
      ? `${queriesTotal} requête${queriesTotal > 1 ? "s" : ""} · max ${maxPerQuery}/requête`
      : "Lecture de votre profil";
    subdetail = "Ouverture du scraper…";
  } else if (subPhase === "scrape_query") {
    stepLabel = "Scraping LinkedIn";
    detail = currentQuery ? `Recherche : ${currentQuery}` : "Pagination LinkedIn";
    subdetail = `Requête ${queriesDone}/${queriesTotal || "?"}${
      offersThisQuery ? ` · ${offersThisQuery} offres listées` : ""
    }`;
  } else if (subPhase === "scrape_desc") {
    stepLabel = "Scraping LinkedIn";
    detail = currentQuery ? `Descriptions : ${currentQuery}` : "Récupération des descriptions";
    subdetail = `Desc ${descCurrent}/${descTotal} · requête ${queriesDone}/${queriesTotal || "?"}`;
  } else if (subPhase === "scrape_done") {
    stepLabel = "Scraping terminé";
    detail = offersNew
      ? `${offersNew} nouvelle${offersNew > 1 ? "s" : ""} offre${offersNew > 1 ? "s" : ""} ajoutée${offersNew > 1 ? "s" : ""}`
      : "Filtrage et dédoublonnage";
    subdetail = offersTotal ? `${offersTotal} offres en base` : "Passage à l'analyse…";
  } else if (subPhase === "hunt_fill") {
    stepLabel = "Recherche intelligente";
    detail = qualHuntDetail
      ? `${qualifying}/${qualHuntDetail[2] || huntTarget} offres ≥6/10`
      : qualifying
        ? `${qualifying}/${huntTarget} offres ≥6/10`
        : "Scrape + analyse au fil de l'eau";
    subdetail = "Arrêt dès l'objectif atteint — pas d'offres non analysées";
  } else if (subPhase === "analyze") {
    stepLabel = "Analyse JEAN PAUL";
    detail = analyzeTotal
      ? `${analyzeDone}/${analyzeTotal} offres scorées`
      : "Notation fit /10";
    subdetail = analyzeDone
      ? qualifying
        ? `${qualifying} ≥ 6/10 sur ce run`
        : "Comparaison profil / offre"
      : "Démarrage de l'analyse…";
  } else if (subPhase === "generate") {
    stepLabel = "Génération CV + lettres";
    detail = generated
      ? `${generated}/${generateMax} candidature${generated > 1 ? "s" : ""}`
      : "Offres ≥ 6/10 uniquement";
    subdetail = /Lettre/i.test(lastLine)
      ? "Lettre de motivation…"
      : /CV/i.test(lastLine)
        ? "Adaptation du CV…"
        : "Rédaction des documents";
  } else if (subPhase === "sync") {
    stepLabel = "Synchronisation";
    detail = "Envoi vers le dashboard";
    subdetail = "CV + lettres";
  } else if (subPhase === "autoapply_boot") {
    stepLabel = "Préparation Chromium";
    detail = "Ouverture du navigateur LinkedIn";
    subdetail = /sélectionnée/i.test(log)
      ? "Chargement des offres sélectionnées"
      : "Session LinkedIn conservée";
  } else if (subPhase === "autoapply_fill") {
    stepLabel = "Remplissage auto";
    detail = autoapplyTotal
      ? `Candidature ${autoapplyCurrent || 1}/${autoapplyTotal}`
      : "Pré-remplissage des formulaires";
    subdetail = formPage
      ? `Page formulaire ${formPage}`
      : autoapplyReady
        ? `${autoapplyReady} onglet${autoapplyReady > 1 ? "s" : ""} prêt${autoapplyReady > 1 ? "s" : ""}`
        : "JEAN PAUL remplit les champs…";
  } else if (subPhase === "autoapply_ready") {
    stepLabel = "Validation dans Chromium";
    detail = autoapplyTotal
      ? `${autoapplyReady || autoapplyTotal}/${autoapplyTotal} formulaire${autoapplyTotal > 1 ? "s" : ""} prêt${autoapplyTotal > 1 ? "s" : ""}`
      : "Formulaires prêts";
    subdetail = "Vérifiez chaque onglet et cliquez « Envoyer la candidature »";
  } else if (subPhase === "done") {
    stepLabel = autoapply ? "Auto-postulation terminée" : "Terminé";
    if (autoapply) {
      detail = autoapplyTotal
        ? `${autoapplyReady || autoapplyTotal}/${autoapplyTotal} onglet${autoapplyTotal > 1 ? "s" : ""} traité${autoapplyTotal > 1 ? "s" : ""}`
        : "Session auto-apply close";
      subdetail = "Marque les offres soumises dans le dashboard";
    } else {
      detail = offersNew
        ? `${offersNew} nouvelle${offersNew > 1 ? "s" : ""} offre${offersNew > 1 ? "s" : ""}`
        : "Recherche complète";
      subdetail = generated
        ? `${generated} candidature${generated > 1 ? "s" : ""} générée${generated > 1 ? "s" : ""}`
        : "";
    }
  }

  let progress = 4;
  if (subPhase === "boot") progress = 6;
  else if (subPhase === "scrape_prepare") progress = 10;
  else if (subPhase === "scrape_query" && queriesTotal) {
    const qFrac = (queriesDone - 1 + 0.35) / queriesTotal;
    progress = 10 + qFrac * 22;
  } else if (subPhase === "scrape_desc" && descTotal) {
    const qBase = queriesTotal ? (queriesDone - 1) / queriesTotal : 0;
    const dFrac = descCurrent / descTotal;
    progress = 10 + (qBase + dFrac / queriesTotal) * 22;
  } else if (subPhase === "scrape_done") progress = 34;
  else if (subPhase === "analyze" && analyzeTotal) {
    progress = 36 + (analyzeDone / analyzeTotal) * 26;
  } else if (subPhase === "hunt_fill") {
    const ht = qualHuntDetail?.[2] ? parseInt(qualHuntDetail[2], 10) : huntTarget;
    progress = 12 + (qualifying / Math.max(ht, 1)) * 40;
  } else if (subPhase === "generate" && generateMax) {
    progress = 66 + (generated / generateMax) * 24;
  } else if (subPhase === "sync") progress = 92;
  else if (subPhase === "autoapply_boot") progress = 8;
  else if (subPhase === "autoapply_fill" && autoapplyTotal) {
    const cur = autoapplyReady || autoapplyCurrent || 1;
    progress = 12 + (cur / autoapplyTotal) * 78;
  } else if (subPhase === "autoapply_fill") progress = 20;
  else if (subPhase === "autoapply_ready") progress = 100;
  else if (subPhase === "done") progress = 100;

  progress = Math.max(progress, backendProgress);

  return {
    mode,
    step,
    subPhase,
    stepLabel,
    detail,
    subdetail,
    lastLine,
    queriesTotal: queriesTotal || queriesDone,
    queriesDone,
    currentQuery,
    maxPerQuery,
    offersThisQuery,
    descCurrent,
    descTotal,
    offersNew,
    offersTotal,
    analyzeTotal,
    analyzeDone,
    qualifying,
    generated,
    generateMax,
    autoapplyCurrent,
    autoapplyTotal,
    autoapplyReady,
    formPage,
    progress: Math.min(100, Math.round(progress)),
  };
}
