import type { Metadata } from "next";
import ProLanding from "@/components/ProLanding";

export const metadata: Metadata = {
  title: "Campus · Employabilité pour l'enseignement supérieur",
  description:
    "Accompagnez vos étudiants à trouver leurs stages, alternances et premiers emplois. Une licence établissement, un accès gratuit pour vos promotions, un vrai levier sur votre taux d'insertion.",
  openGraph: {
    title: "Campus · Employabilité",
    description:
      "La solution employabilité clé en main pour les écoles de commerce et l'enseignement supérieur.",
    type: "website",
  },
};

export default function ProPage() {
  return <ProLanding />;
}
