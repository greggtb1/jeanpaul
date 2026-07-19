"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  className?: string;
  label?: string;
  onLoad?: () => void;
  onError?: () => void;
};

/**
 * Aperçu PDF sans le cadre sombre du viewer natif :
 * rend les pages en images, sinon fallback iframe.
 */
export default function PdfPreview({ src, className, label, onLoad, onError }: Props) {
  const [pages, setPages] = useState<string[]>([]);
  const [fallback, setFallback] = useState(false);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    setPages([]);
    setFallback(false);

    (async () => {
      try {
        const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        const pdf = await getDocumentProxy(data);
        const total = Math.min(pdf.numPages || 1, 3);
        const urls: string[] = [];
        for (let i = 1; i <= total; i++) {
          const buffer = await renderPageAsImage(pdf, i, { scale: 1.6 });
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(buffer)], { type: "image/png" })
          );
          created.push(url);
          urls.push(url);
        }
        if (cancelled) {
          created.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        setPages(urls);
        onLoadRef.current?.();
      } catch {
        if (cancelled) return;
        setFallback(true);
        onErrorRef.current?.();
      }
    })();

    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [src]);

  if (fallback) {
    return (
      <iframe
        className={className}
        src={`${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        title={label || "Aperçu PDF"}
        onLoad={onLoad}
      />
    );
  }

  if (!pages.length) return null;

  return (
    <div
      className={["pdf-preview", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
    >
      {pages.map((page) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={page} src={page} alt="" className="pdf-preview__page" draggable={false} />
      ))}
    </div>
  );
}
