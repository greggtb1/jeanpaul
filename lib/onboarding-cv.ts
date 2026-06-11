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
