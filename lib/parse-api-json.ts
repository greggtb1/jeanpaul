export async function parseApiJson<T extends Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(res.ok ? "Réponse vide du serveur" : `Erreur ${res.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? "Réponse invalide du serveur" : `Erreur ${res.status}`);
  }
}
