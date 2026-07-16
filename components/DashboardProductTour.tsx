"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const STORAGE_KEY = "jp_dashboard_product_tour_v1";
const FORCE_SESSION_KEY = "jp_force_dashboard_tour";
const DEMO_STEP_IDS = new Set(["score", "cv", "letter", "mark"]);

export function hasSeenDashboardProductTour(): boolean {
  if (typeof window === "undefined") return true;
  return !!localStorage.getItem(STORAGE_KEY);
}

export function shouldForceDashboardProductTour(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(FORCE_SESSION_KEY) === "1";
}

export function queueDashboardProductTourAfterOnboarding(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(FORCE_SESSION_KEY, "1");
}

export function clearForcedDashboardProductTour(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(FORCE_SESSION_KEY);
}

export function shouldOfferDashboardProductTour(firstSearchDone?: boolean | null): boolean {
  if (shouldForceDashboardProductTour()) return true;
  if (hasSeenDashboardProductTour()) return false;
  if (firstSearchDone) return false; // scan déjà fait → ne pas proposer
  return true;
}

export function markDashboardProductTourSeen(persist = true): void {
  if (!persist) return;
  localStorage.setItem(STORAGE_KEY, "1");
}

type Placement = "top" | "bottom" | "left" | "right" | "center";

type TourStep = {
  id: string;
  title: string;
  body: string;
  hint?: string;
  target?: string;
  clickTarget?: string;
  placement: Placement;
  mobilePlacement?: Placement;
  simulateClick?: boolean;
  preview?: "cv" | "letter" | "sent";
  intro?: boolean;
  outro?: boolean;
};

const STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Bienvenue",
    body: "20 secondes pour découvrir votre tableau de bord.",
    placement: "center",
    intro: true,
  },
  {
    id: "scan",
    title: "Scanner",
    body: "Lancez un scan pour trouver les meilleures offres qui vous correspondent.",
    target: "[data-tour='scan-btn']",
    clickTarget: "[data-tour='scan-btn']",
    placement: "bottom",
    mobilePlacement: "bottom",
    simulateClick: true,
  },
  {
    id: "prefs",
    title: "Vos critères",
    body: "Onglet Critères de recherche : postes, villes, contrat… modifiables à tout moment.",
    target: "[data-tour='prefs-link']",
    placement: "right",
    mobilePlacement: "top",
  },
  {
    id: "score",
    title: "Note /10",
    body: "Score par offre. Dès 6/10 : CV + lettre générés.",
    target: "[data-tour='demo-job']",
    clickTarget: "[data-tour='demo-score']",
    placement: "top",
    mobilePlacement: "bottom",
    simulateClick: true,
  },
  {
    id: "cv",
    title: "CV ciblé",
    body: "CV optimisé pour passer les filtres RH.",
    target: "[data-tour='demo-job']",
    clickTarget: "[data-tour='demo-cv']",
    placement: "top",
    mobilePlacement: "bottom",
    simulateClick: true,
    preview: "cv",
  },
  {
    id: "letter",
    title: "Lettre",
    body: "Rédigée sur mesure, prête à envoyer.",
    target: "[data-tour='demo-job']",
    clickTarget: "[data-tour='demo-letter']",
    placement: "top",
    mobilePlacement: "bottom",
    simulateClick: true,
    preview: "letter",
  },
  {
    id: "mark",
    title: "Suivi",
    body: "Cochez ✓ après candidature pour ne rien oublier.",
    target: "[data-tour='demo-job']",
    clickTarget: "[data-tour='demo-mark']",
    placement: "top",
    mobilePlacement: "bottom",
    simulateClick: true,
    preview: "sent",
  },
  {
    id: "apply",
    title: "Postuler",
    body: "Remplissage automatique des champs avec BLOW MY JOB et vos documents générés.",
    target: "[data-tour='apply-btn']",
    clickTarget: "[data-tour='apply-btn']",
    placement: "bottom",
    mobilePlacement: "bottom",
    simulateClick: true,
  },
];

const COUNTED_STEPS = STEPS.filter((s) => !s.intro && !s.outro);

function useMobileLayout(maxWidth = 900) {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);

  return mobile;
}

function useTargetRect(
  selector: string | undefined,
  stepIndex: number,
  active: boolean,
  scrollIntoView = true,
  remeasureKey?: unknown,
  holdReadyAcrossSteps = false
) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const wasReadyRef = useRef(false);
  const prevSelectorRef = useRef(selector);

  useLayoutEffect(() => {
    if (selector !== prevSelectorRef.current) {
      wasReadyRef.current = false;
      prevSelectorRef.current = selector;
    }

    if (!active || !selector) {
      setRect(null);
      setReady(false);
      wasReadyRef.current = false;
      return;
    }

    const keepReady = holdReadyAcrossSteps && wasReadyRef.current;
    if (!keepReady) {
      setReady(false);
      wasReadyRef.current = false;
    }
    let settleTimer: number | undefined;

    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) {
        setRect(null);
        return null;
      }
      const next = el.getBoundingClientRect();
      setRect(next);
      return el;
    };

    const el = measure();
    if (scrollIntoView) el?.scrollIntoView({ block: "nearest", behavior: "auto" });

    const settleMs = keepReady ? 0 : 320;
    settleTimer = window.setTimeout(() => {
      measure();
      requestAnimationFrame(() => {
        setReady(true);
        wasReadyRef.current = true;
      });
    }, settleMs);

    const onResize = () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        measure();
        setReady(true);
        wasReadyRef.current = true;
      }, 80);
    };

    window.addEventListener("resize", onResize);
    return () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      window.removeEventListener("resize", onResize);
    };
  }, [selector, stepIndex, active, scrollIntoView, remeasureKey, holdReadyAcrossSteps]);

  return { rect, ready };
}

function useDemoJobRect(
  active: boolean,
  anchorReady: boolean,
  stepIndex: number,
  animateEnter: boolean
) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const wasReadyRef = useRef(false);

  useLayoutEffect(() => {
    if (!active || !anchorReady) {
      setRect(null);
      setReady(false);
      wasReadyRef.current = false;
      return;
    }

    let settleTimer: number | undefined;
    let enterTimer: number | undefined;

    const measure = () => {
      const el = document.querySelector(".dpt__demo-anchor .dpt-demo-job");
      if (!el) {
        setRect(null);
        return null;
      }
      const next = el.getBoundingClientRect();
      setRect(next);
      return next;
    };

    // L'offre factice reste au même endroit d'une étape démo à l'autre :
    // on garde le surlignage affiché pour éviter le clignotement (glitch).
    if (!wasReadyRef.current) setReady(false);
    measure();

    const settle = () => {
      measure();
      requestAnimationFrame(() => {
        setReady(true);
        wasReadyRef.current = true;
      });
    };

    if (animateEnter && !wasReadyRef.current) {
      // Attendre la fin de l'animation d'entrée (dpt-demo-in, 0.45s) avant de
      // mesurer : sinon le surlignage apparaît décalé puis se recale.
      enterTimer = window.setTimeout(settle, 480);
    } else {
      settleTimer = window.setTimeout(settle, 0);
    }

    const onResize = () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 80);
    };

    window.addEventListener("resize", onResize);
    return () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      if (enterTimer) window.clearTimeout(enterTimer);
      window.removeEventListener("resize", onResize);
    };
  }, [active, anchorReady, stepIndex, animateEnter]);

  return { rect, ready };
}

function TourCursor({
  x,
  y,
  visible,
  clicking,
}: {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
}) {
  return (
    <div
      className={[
        "dpt-cursor",
        visible ? "dpt-cursor--visible" : "",
        clicking ? "dpt-cursor--click" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
      aria-hidden="true"
    >
      <svg className="dpt-cursor__pointer" width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path
          d="M4 3L4 23L10 17L14 25L17 23L13 15L21 15L4 3Z"
          fill="#fff"
          stroke="#0f172a"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {clicking && <span className="dpt-cursor__ripple" />}
    </div>
  );
}

export function TourDemoJob({ sent }: { sent?: boolean }) {
  return (
    <article
      className={`jr jr--seen jr--fit-8 dpt-demo-job${sent ? " dpt-demo-job--sent" : ""}`}
      data-tour="demo-job"
    >
      <div
        className="jr__dial"
        data-tour="demo-score"
        style={{
          background: "linear-gradient(145deg, #bfdbfe 0%, #93c5fd 100%)",
          borderColor: "#60a5fa",
          color: "#1e3a8a",
        }}
      >
        <span className="jr__dial-num">8</span>
        <span className="jr__dial-max">/10</span>
      </div>
      <div className="jr__main">
        <div className="jr__head">
          <h3 className="jr__title">Product Manager · CDI</h3>
          <span className="jr__pill jr__pill--fit-great">Excellent fit</span>
        </div>
        <p className="jr__meta">Helios Tech · Paris · Hybride</p>
      </div>
      <div className="jr__actions">
        <div className="jr__actions-body">
          <button type="button" className="jr__doc jr__doc--cv" data-tour="demo-cv">
            CV
          </button>
          <button type="button" className="jr__doc jr__doc--letter" data-tour="demo-letter">
            Lettre
          </button>
          <span className="jr__link jr__link--demo">voir l&apos;offre</span>
        </div>
        <button
          type="button"
          className={`jr__mark${sent ? " jr__mark--done" : ""}`}
          data-tour="demo-mark"
          aria-pressed={sent}
        >
          ✓
        </button>
      </div>
    </article>
  );
}

function TourPreview({ kind }: { kind: "cv" | "letter" | "sent" }) {
  if (kind === "cv") {
    return (
      <div className="dpt-preview dpt-preview--cv">
        <div className="dpt-preview__bar" />
        <div className="dpt-preview__line dpt-preview__line--lg" />
        <div className="dpt-preview__line" />
        <div className="dpt-preview__line dpt-preview__line--sm" />
        <p className="dpt-preview__caption">CV PDF · adapté au poste</p>
      </div>
    );
  }
  if (kind === "letter") {
    return (
      <div className="dpt-preview dpt-preview--letter">
        <div className="dpt-preview__line" />
        <div className="dpt-preview__line" />
        <div className="dpt-preview__line dpt-preview__line--lg" />
        <div className="dpt-preview__line" />
        <p className="dpt-preview__caption">Lettre · prête à envoyer</p>
      </div>
    );
  }
  return (
    <div className="dpt-preview dpt-preview--sent">
      <span className="dpt-preview__check">✓</span>
      <p>Dossier marqué comme candidaté</p>
    </div>
  );
}

function tooltipStyle(
  rect: DOMRect | null,
  placement: Placement,
  isMobile: boolean
): CSSProperties {
  if (placement === "center" || !rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: isMobile ? "calc(100vw - 24px)" : "420px",
    };
  }

  if (isMobile) {
    return {
      left: 12,
      right: 12,
      bottom: 12,
      width: "auto",
      maxWidth: "none",
    };
  }

  const pad = 16;
  const cardW = 340;
  const cardH = 240;

  let top = rect.bottom + pad;
  let left = rect.left + rect.width / 2 - cardW / 2;

  if (placement === "top") {
    const anchorTop = rect.top - pad;
    const maxHeight = Math.max(160, anchorTop - 12);
    left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
    return {
      top: anchorTop,
      left,
      width: cardW,
      maxWidth: "calc(100vw - 24px)",
      maxHeight,
      overflowY: "auto",
      transform: "translateY(-100%)",
    };
  }

  if (placement === "left") {
    top = rect.top + rect.height / 2 - cardH / 2;
    left = rect.left - cardW - pad;
  } else if (placement === "right") {
    top = rect.top + rect.height / 2 - cardH / 2;
    left = rect.right + pad;
  }

  left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
  top = Math.max(12, Math.min(top, window.innerHeight - cardH - 12));

  return { top, left, width: cardW, maxWidth: "calc(100vw - 24px)" };
}

export default function DashboardProductTour({
  onClose,
  persistSeen = true,
}: {
  onClose: () => void;
  persistSeen?: boolean;
}) {
  const isMobile = useMobileLayout();
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [demoAnchorEntered, setDemoAnchorEntered] = useState(false);
  const [demoEnterAnimating, setDemoEnterAnimating] = useState(false);
  const [cursor, setCursor] = useState({ x: -120, y: -120, visible: false, clicking: false });
  const [demoSent, setDemoSent] = useState(false);
  const cursorPosRef = useRef({ x: -120, y: -120 });
  const prevStepIndexRef = useRef(stepIndex);
  const pulseRef = useRef<Element | null>(null);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex >= STEPS.length - 1;
  const isCenter = step.placement === "center";
  const showDemoJob = DEMO_STEP_IDS.has(step.id);
  const countedStepIndex = COUNTED_STEPS.findIndex((s) => s.id === step.id);
  const effectivePlacement = isMobile && step.mobilePlacement ? step.mobilePlacement : step.placement;
  const { rect: jobsSlotRect } = useTargetRect(
    "[data-tour='jobs-slot']",
    stepIndex,
    showDemoJob,
    true,
    undefined,
    showDemoJob
  );
  const { rect: targetRect, ready: targetReady } = useTargetRect(
    step.target,
    stepIndex,
    true,
    !showDemoJob,
    showDemoJob ? jobsSlotRect?.top : undefined,
    showDemoJob
  );

  const prevStep = STEPS[prevStepIndexRef.current];
  const demoCursorChain =
    DEMO_STEP_IDS.has(prevStep?.id ?? "") && DEMO_STEP_IDS.has(step.id);

  const lastJobsSlotRectRef = useRef<DOMRect | null>(null);
  if (jobsSlotRect) lastJobsSlotRectRef.current = jobsSlotRect;
  const stableJobsSlotRect = jobsSlotRect ?? lastJobsSlotRectRef.current;

  useEffect(() => {
    if (stableJobsSlotRect && showDemoJob && !demoAnchorEntered) {
      setDemoAnchorEntered(true);
      setDemoEnterAnimating(true);
      const t = window.setTimeout(() => setDemoEnterAnimating(false), 480);
      return () => window.clearTimeout(t);
    }
  }, [stableJobsSlotRect, showDemoJob, demoAnchorEntered]);

  const demoAnchorStyle = useMemo((): CSSProperties | undefined => {
    if (!stableJobsSlotRect) return undefined;
    return {
      top: stableJobsSlotRect.top,
      left: stableJobsSlotRect.left,
      width: stableJobsSlotRect.width,
      maxWidth: stableJobsSlotRect.width,
    };
  }, [stableJobsSlotRect]);

  const demoAnchorReady = !!demoAnchorStyle;
  const { rect: demoJobRect, ready: demoJobReady } = useDemoJobRect(
    showDemoJob,
    demoAnchorReady,
    stepIndex,
    demoEnterAnimating
  );

  // Disponibilité stable pour piloter le curseur / la pulsation : un booléen qui
  // ne bascule qu'une fois par étape, pour éviter que le contour se relance à
  // chaque re-mesure (glitch étape 2→3).
  const interactionReady = showDemoJob ? demoAnchorReady && demoJobReady : targetReady;
  const targetRectRef = useRef<DOMRect | null>(null);
  targetRectRef.current = targetRect;

  const finish = useCallback(() => {
    if (persistSeen || dontShowAgain) {
      markDashboardProductTourSeen(true);
    }
    clearForcedDashboardProductTour();
    onClose();
  }, [onClose, persistSeen, dontShowAgain]);

  const goNext = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }, [stepIndex, finish]);

  const goPrev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    document.body.classList.add("dpt-active");
    if (isMobile) document.body.classList.add("dpt-active--mobile");
    return () => {
      document.body.classList.remove("dpt-active");
      document.body.classList.remove("dpt-active--mobile");
    };
  }, [isMobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, goNext, goPrev]);

  useEffect(() => {
    const markIdx = STEPS.findIndex((s) => s.id === "mark");
    setDemoSent(stepIndex >= markIdx && markIdx >= 0);
  }, [stepIndex]);

  useEffect(() => {
    pulseRef.current?.classList.remove("dpt-target--pulse");
    pulseRef.current = null;

    const prevIndex = prevStepIndexRef.current;
    const chainFromDemo =
      DEMO_STEP_IDS.has(STEPS[prevIndex]?.id ?? "") && DEMO_STEP_IDS.has(step.id);
    prevStepIndexRef.current = stepIndex;

    if (isCenter || !step.simulateClick) {
      setCursor((c) => ({ ...c, visible: false, clicking: false }));
      return;
    }

    if (!chainFromDemo && !interactionReady) {
      setCursor((c) => ({ ...c, visible: false, clicking: false }));
      return;
    }

    const clickEl = step.clickTarget ? document.querySelector(step.clickTarget) : null;
    const rect = clickEl?.getBoundingClientRect() ?? targetRectRef.current;
    if (!rect) {
      setCursor((c) => ({ ...c, visible: false, clicking: false }));
      return;
    }

    const x = rect.left + rect.width / 2 - 6;
    const y = rect.top + rect.height / 2 - 4;

    if (chainFromDemo) {
      setCursor({ x, y, visible: true, clicking: false });
      cursorPosRef.current = { x, y };

      const clickTimer = window.setTimeout(() => {
        setCursor({ x, y, visible: true, clicking: true });
        if (clickEl) {
          pulseRef.current = clickEl;
          clickEl.classList.add("dpt-target--pulse");
        }
      }, 280);

      const unclickTimer = window.setTimeout(() => {
        setCursor({ x, y, visible: true, clicking: false });
      }, 480);

      return () => {
        window.clearTimeout(clickTimer);
        window.clearTimeout(unclickTimer);
        pulseRef.current?.classList.remove("dpt-target--pulse");
      };
    }

    const from = cursorPosRef.current;
    setCursor({ x: from.x, y: from.y, visible: false, clicking: false });

    const showTimer = window.setTimeout(() => {
      setCursor({ x, y, visible: true, clicking: false });
      cursorPosRef.current = { x, y };
    }, 120);

    const clickTimer = window.setTimeout(() => {
      setCursor({ x, y, visible: true, clicking: true });
      if (clickEl) {
        pulseRef.current = clickEl;
        clickEl.classList.add("dpt-target--pulse");
      }
    }, isMobile ? 520 : 680);

    const unclickTimer = window.setTimeout(() => {
      setCursor({ x, y, visible: true, clicking: false });
    }, isMobile ? 760 : 920);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(clickTimer);
      window.clearTimeout(unclickTimer);
      pulseRef.current?.classList.remove("dpt-target--pulse");
    };
  }, [stepIndex, step, isCenter, interactionReady, isMobile]);

  const spotlightRect = showDemoJob && demoJobRect ? demoJobRect : targetRect;

  const spotlight = useMemo(() => {
    if (isCenter || !spotlightRect) return null;
    // Marge réduite sur les cibles serrées (ex. onglet sidebar) pour ne pas
    // déborder sur l'élément voisin.
    const tight = step?.id === "prefs";
    const padX = isMobile ? 6 : tight ? 2 : 8;
    const padY = isMobile ? 6 : tight ? -3 : 8;
    return {
      top: spotlightRect.top - padY,
      left: spotlightRect.left - padX,
      width: spotlightRect.width + padX * 2,
      height: spotlightRect.height + padY * 2,
    };
  }, [isCenter, spotlightRect, isMobile, step?.id]);

  const showDemoJobReady = showDemoJob && demoAnchorReady && demoJobReady;
  const spotlightReady = showDemoJob
    ? !isCenter && showDemoJobReady && !!spotlightRect
    : !isCenter && !!targetRect && targetReady;
  const keepDimmed = isCenter || !spotlightReady;
  const showCursor =
    !isMobile &&
    !!step.simulateClick &&
    (spotlightReady || demoCursorChain || (showDemoJob && cursor.visible));
  const tooltipAnchorRect =
    showDemoJob && stableJobsSlotRect && !isMobile ? stableJobsSlotRect : targetRect;
  const useDemoCardLayout = showDemoJob && !isCenter;
  const demoCardRaised = useDemoCardLayout && !!step.preview;

  const demoCardStyle = useMemo((): CSSProperties | undefined => {
    if (!useDemoCardLayout || !demoJobRect) return undefined;
    const gap = 14;
    const below = demoJobRect.bottom + gap;
    const spaceBelow = window.innerHeight - below - 16;
    // Si pas assez de place en dessous, on colle la carte au-dessus de l'offre.
    if (spaceBelow < 160 && demoJobRect.top > 200) {
      return {
        top: Math.max(12, demoJobRect.top - gap - 200),
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(400px, calc(100vw - 48px))",
        maxWidth: 400,
      };
    }
    return {
      top: below,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(400px, calc(100vw - 48px))",
      maxWidth: 400,
    };
  }, [useDemoCardLayout, demoJobRect]);

  return (
    <div
      className={`dpt${isMobile ? " dpt--mobile" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dpt-title"
    >
      <div className={`dpt__backdrop${keepDimmed ? " dpt__backdrop--dim" : ""}`} onClick={finish} />

      {showDemoJob && (
        <div
          className={`dpt__demo-anchor${demoAnchorStyle ? " dpt__demo-anchor--placed" : ""}${demoAnchorEntered ? " dpt__demo-anchor--enter" : ""}`}
          style={demoAnchorStyle}
        >
          <p className="dpt__demo-label">Exemple · dossier prêt</p>
          <TourDemoJob sent={demoSent} />
        </div>
      )}

      {spotlightReady && (
        <div
          className="dpt__spotlight"
          style={{
            top: spotlight!.top,
            left: spotlight!.left,
            width: spotlight!.width,
            height: spotlight!.height,
          }}
        />
      )}

      {showCursor && <TourCursor {...cursor} />}

      <div
        className={`dpt__card${isCenter ? " dpt__card--center" : ""}${useDemoCardLayout ? ` dpt__card--demo-below${demoCardRaised ? " dpt__card--demo-raised" : ""}` : isMobile && !isCenter ? " dpt__card--sheet" : ""}`}
        style={
          isCenter
            ? undefined
            : useDemoCardLayout
              ? demoCardStyle
              : tooltipStyle(tooltipAnchorRect, effectivePlacement, isMobile)
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dpt__card-head">
          <div className="dpt__progress" aria-hidden="true">
            {COUNTED_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={[
                  "dpt__dot",
                  i === countedStepIndex ? "dpt__dot--active" : "",
                  countedStepIndex >= 0 && i < countedStepIndex ? "dpt__dot--done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
          </div>
          <div className="dpt__head-actions">
            {isLastStep && (
              <label className="dpt__dont-show">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                />
                Ne plus afficher
              </label>
            )}
            <button type="button" className="dpt__skip" onClick={finish}>
              Passer
            </button>
          </div>
        </div>

        <div className="dpt__step" key={step.id}>
          {countedStepIndex >= 0 && (
            <p className="dpt__step-kicker">
              Étape {countedStepIndex + 1}/{COUNTED_STEPS.length}
            </p>
          )}
          <h2 id="dpt-title" className="dpt__title">
            {step.title}
          </h2>
          <p className="dpt__body">{step.body}</p>
          {step.hint && <p className="dpt__hint">{step.hint}</p>}
          {step.preview && <TourPreview kind={step.preview} />}
        </div>

        <div className="dpt__nav">
          <button
            type="button"
            className="dpt__btn dpt__btn--ghost"
            onClick={goPrev}
            disabled={stepIndex === 0}
          >
            Retour
          </button>
          <button type="button" className="dpt__btn dpt__btn--next" onClick={goNext}>
            {stepIndex >= STEPS.length - 1 ? "Terminer" : "Suivant"}
          </button>
        </div>
      </div>
    </div>
  );
}
