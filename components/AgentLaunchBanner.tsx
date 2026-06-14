"use client";

import Link from "next/link";

export default function AgentLaunchBanner({
  onRetry,
  awaitingAgent,
}: {
  onRetry: () => void;
  awaitingAgent: boolean;
}) {
  return (
    <div className="agent-banner" role="status">
      <div className="agent-banner__body">
        <strong>Agent desktop requis</strong>
        <p>
          L&apos;auto-apply s&apos;exécute sur votre machine (Chromium visible). Ouvrez JEAN PAUL
          Agent ou installez-le si ce n&apos;est pas déjà fait.
        </p>
        {awaitingAgent && (
          <p className="agent-banner__wait">
            En attente de l&apos;agent… Si rien ne se passe, cliquez « Relancer le lien ».
          </p>
        )}
      </div>
      <div className="agent-banner__actions">
        <button type="button" className="btn btn--coral btn--sm" onClick={onRetry}>
          Relancer le lien
        </button>
        <Link
          href="/download"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--outline btn--sm"
        >
          Installer l&apos;agent
        </Link>
      </div>
    </div>
  );
}
