import SearchPreferencesForm from "@/components/SearchPreferencesForm";

export default function PreferencesPage() {
  return (
    <main className="db__main db__main--prefs">
      <div className="db-page-head db-page-head--prefs">
        <h1>Critères de recherche</h1>
      </div>
      <SearchPreferencesForm />
    </main>
  );
}
