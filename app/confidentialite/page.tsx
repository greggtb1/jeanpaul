import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Politique de confidentialité · JEAN PAUL",
};

export default function ConfidentialitePage() {
  return (
    <LegalPage title="Politique de confidentialité">
      <p><strong>Dernière mise à jour :</strong> juin 2026</p>

      <h2>Responsable du traitement</h2>
      <p>
        JEAN PAUL est un service en ligne d&apos;aide à la recherche d&apos;emploi et à la
        préparation de dossiers. Pour toute question :{" "}
        <a href="mailto:contact@jeanpaul.app">contact@jeanpaul.app</a>.
      </p>

      <h2>Données collectées</h2>
      <ul>
        <li>Identité et contact : nom, email, téléphone, ville (profil et CV).</li>
        <li>Données de recherche : postes visés, lieux, type de contrat, préférences remote.</li>
        <li>Documents : CV (PDF), lettre type, CV et lettres générés par offre.</li>
        <li>Activité : offres analysées, scores, dossiers prêts ou candidatés.</li>
        <li>Paiement : identifiants Stripe (nous ne stockons pas vos coordonnées bancaires).</li>
        <li>Technique : logs de session, cookies d&apos;authentification Supabase.</li>
      </ul>

      <h2>Finalités</h2>
      <p>
        Fournir le service (scan d&apos;offres, scoring, génération de documents, aide au
        remplissage de formulaires), gérer votre compte et la facturation, améliorer le
        produit et assurer la sécurité.
      </p>

      <h2>Base légale</h2>
      <p>
        Exécution du contrat (utilisation du service), intérêt légitime (sécurité, support)
        et, le cas échéant, votre consentement pour les options facultatives.
      </p>

      <h2>Sous-traitants</h2>
      <ul>
        <li><strong>Supabase</strong> : hébergement base de données, authentification, stockage fichiers (UE / USA selon région projet).</li>
        <li><strong>Stripe</strong> : paiements sécurisés.</li>
        <li><strong>Anthropic</strong> : analyse d&apos;offres et rédaction assistée de CV / lettres (données limitées au nécessaire).</li>
      </ul>

      <h2>Durée de conservation</h2>
      <p>
        Données de compte : tant que le compte est actif, puis suppression sous 3 ans après
        clôture sauf obligation légale. Documents (CV, lettres) : selon votre utilisation,
        supprimables depuis le dashboard ou sur demande.
      </p>

      <h2>Vos droits</h2>
      <p>
        Accès, rectification, effacement, limitation, portabilité, opposition : écrivez à{" "}
        <a href="mailto:contact@jeanpaul.app">contact@jeanpaul.app</a>. Réclamation possible
        auprès de la CNIL.
      </p>

      <h2>Sécurité</h2>
      <p>
        Chiffrement en transit (HTTPS), accès restreint aux données, cloisonnement par
        utilisateur. Aucune méthode n&apos;est infaillible : gardez votre mot de passe confidentiel.
      </p>
    </LegalPage>
  );
}
