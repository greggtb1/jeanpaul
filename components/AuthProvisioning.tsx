export default function AuthProvisioning({
  title = "Création de votre espace",
  step,
}: {
  title?: string;
  step?: string;
}) {
  return (
    <div className="auth-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="auth-card auth-card--provisioning">
        <div className="auth-spinner" role="status" aria-label="Chargement" />
        <h1>{title}</h1>
        <p className="auth-card__lead">{step || "Quelques secondes…"}</p>
      </div>
    </div>
  );
}
