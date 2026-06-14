const DB_NAME = "jp_onboarding";
const STORE = "cv";
const CV_KEY = "pending";

type CvRecord = {
  blob: Blob;
  name: string;
  type: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePendingCv(file: File): Promise<void> {
  const db = await openDb();
  const record: CvRecord = {
    blob: file,
    name: file.name,
    type: file.type || "application/pdf",
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, CV_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingCv(): Promise<File | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(CV_KEY);
    req.onsuccess = () => {
      const row = req.result as CvRecord | undefined;
      if (!row?.blob) {
        resolve(null);
        return;
      }
      resolve(new File([row.blob], row.name, { type: row.type }));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingCv(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(CV_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function uploadPendingCvForUser(
  userId: string
): Promise<{ url: string; filename: string; path: string } | null> {
  const file = await getPendingCv();
  if (!file) return null;

  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const path = `${userId}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
  const { error } = await supabase.storage.from("cvs").upload(path, file, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (error) throw error;

  const { data: signedData, error: signedError } = await supabase.storage
    .from("cvs")
    .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 an
  if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("URL indisponible");
  await clearPendingCv();
  return { url: signedData.signedUrl, filename: file.name, path };
}

function filenameFromStorageObject(name: string, fallback?: string): string {
  const stripped = name.replace(/^\d+_/, "");
  if (stripped.toLowerCase().endsWith(".pdf")) return stripped;
  return fallback || stripped || "CV.pdf";
}

/** Retrouve un CV déjà uploadé dans le bucket (après signup ou session perdue). */
export async function recoverCvFromStorage(
  userId: string,
  preferredFilename?: string
): Promise<{ url: string; filename: string; path: string } | null> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data: files, error } = await supabase.storage.from("cvs").list(userId, {
    limit: 20,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error || !files?.length) return null;

  const objects = files.filter((f) => f.name && /\.pdf$/i.test(f.name));
  if (!objects.length) return null;

  const preferred = preferredFilename?.trim().toLowerCase();
  const picked =
    (preferred
      ? objects.find((f) => f.name.toLowerCase().includes(preferred.replace(/[^\w.\-]/g, "_").toLowerCase()))
      : null) || objects[0];

  if (!picked?.name) return null;

  const path = `${userId}/${picked.name}`;
  const { data: signedData, error: signedError } = await supabase.storage
    .from("cvs")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signedError || !signedData?.signedUrl) return null;

  return {
    url: signedData.signedUrl,
    filename: filenameFromStorageObject(picked.name, preferredFilename),
    path,
  };
}

export async function resolveProfileCv(
  userId: string,
  opts?: { cvUrl?: string | null; cvFilename?: string | null }
): Promise<{ url: string; filename: string } | null> {
  const currentUrl = opts?.cvUrl?.trim();
  const filename = opts?.cvFilename?.trim() || "CV.pdf";
  if (currentUrl && currentUrl !== "local") {
    return { url: currentUrl, filename };
  }

  const pending = await uploadPendingCvForUser(userId);
  if (pending) return { url: pending.url, filename: pending.filename };

  const recovered = await recoverCvFromStorage(userId, opts?.cvFilename || undefined);
  if (recovered) return { url: recovered.url, filename: recovered.filename };

  return null;
}
