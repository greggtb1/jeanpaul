import SearchPreferencesForm from "@/components/SearchPreferencesForm";

export default function PreferencesPage() {
  return (
    <main className="db__main db__main--narrow db__main--prefs">
      <div className="db-page-head db-page-head--compact">
        <h1>Critères de recherche</h1>
        <p>Postes visés, CV, critères et ton de vos lettres.</p>
      </div>
      <SearchPreferencesForm />
    </main>
  );
}
