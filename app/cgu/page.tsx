import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Conditions générales · JEAN PAUL",
};

export default function CguPage() {
  return (
    <LegalPage title="Conditions générales d'utilisation">
      <p><strong>Dernière mise à jour :</strong> juin 2026</p>

      <h2>Objet</h2>
      <p>
        Les présentes CGU régissent l&apos;accès et l&apos;utilisation de JEAN PAUL, service
        d&apos;aide à la recherche d&apos;emploi : scan d&apos;offres (notamment LinkedIn),
        notation de compatibilité, génération de CV et lettres, assistance au remplissage de
        formulaires de postulation.
      </p>

      <h2>Compte et éligibilité</h2>
      <p>
        Vous devez être majeur et fournir des informations exactes. Un compte par personne.
        Vous êtes responsable de la confidentialité de vos identifiants.
      </p>

      <h2>Offre et paiement</h2>
      <p>
        L&apos;accès au service est payant via Stripe (paiement unique en offre lancement, ou
        formule indiquée au moment du checkout). Les tarifs affichés sur le site prévalent.
        Remboursement : contactez-nous sous 14 jours pour un premier achat non utilisé ;
        au-delà, pas de remboursement automatique sauf obligation légale.
      </p>

      <h2>Utilisation du service</h2>
      <ul>
        <li>Vous restez seul responsable des dossiers candidatés. JEAN PAUL prépare ; vous validez.</li>
        <li>Pas d&apos;usage frauduleux, spam, ou contournement des plateformes tierces (LinkedIn, ATS).</li>
        <li>Les documents générés sont une aide : relisez-les avant envoi.</li>
        <li>Le service n&apos;est pas affilié à LinkedIn ni aux employeurs listés.</li>
      </ul>

      <h2>Disponibilité</h2>
      <p>
        Nous visons une haute disponibilité sans garantie de résultat (entretiens, embauches).
        Maintenance, évolutions et limites techniques peuvent interrompre temporairement le service.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        JEAN PAUL, son interface et son code restent notre propriété. Vous conservez vos CV,
        lettres et données personnelles.
      </p>

      <h2>Limitation de responsabilité</h2>
      <p>
        Dans les limites légales, JEAN PAUL n&apos;est pas responsable des décisions de
        recruteurs, des erreurs dans les formulaires tiers, ni des dommages indirects. Notre
        responsabilité est plafonnée au montant payé sur les 12 derniers mois.
      </p>

      <h2>Résiliation</h2>
      <p>
        Vous pouvez cesser d&apos;utiliser le service à tout moment. Nous pouvons suspendre un
        compte en cas de violation des CGU. Données : voir la politique de confidentialité.
      </p>

      <h2>Droit applicable</h2>
      <p>
        Droit français. Litiges : tribunaux compétents du ressort du siège de l&apos;éditeur,
        après tentative de résolution amiable par email.
      </p>

      <p>
        Contact : <a href="mailto:contact@jeanpaul.app">contact@jeanpaul.app</a>
      </p>
    </LegalPage>
  );
}
