export type PublicDriveItem = {
  id: string;
  name: string;
  mimeType: string;
  size: string;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

function decodeHtml(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function inferMimeType(name: string, tooltip: string): string {
  if (/\bfolder\b/i.test(tooltip)) return FOLDER_MIME;
  if (/\.pdf$/i.test(name) || /\bPDF\b/i.test(tooltip)) return "application/pdf";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.html?$/i.test(name)) return "text/html";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.(md|txt|log|ini|cfg|ya?ml|tsv)$/i.test(name)) return "text/plain";
  if (/\.(zip|rar|7z)$/i.test(name) || /archive/i.test(tooltip)) return "application/zip";
  return "application/octet-stream";
}

/**
 * Google Drive exposes public folder entries in the server-rendered HTML even
 * when Files.list returns an empty array for an API-key-only request. This
 * parser extracts only the stable file id/name/type fields needed by the
 * technical-library crawler.
 */
export function parsePublicDriveFolderHtml(html: string): PublicDriveItem[] {
  const items = new Map<string, PublicDriveItem>();
  const entryPattern = /data-id="([^"]+)"[^>]*data-tooltip="([^"]*)"[^>]*>[\s\S]{0,900}?<strong[^>]*>([\s\S]*?)<\/strong>/g;

  for (const match of String(html || "").matchAll(entryPattern)) {
    const id = decodeHtml(match[1]);
    const tooltip = decodeHtml(match[2]);
    const name = decodeHtml(match[3]);
    if (!id || !name || items.has(id)) continue;
    items.set(id, {
      id,
      name,
      mimeType: inferMimeType(name, tooltip),
      size: "0",
    });
  }

  return Array.from(items.values());
}
