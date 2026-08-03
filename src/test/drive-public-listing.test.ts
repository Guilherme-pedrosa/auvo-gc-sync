import { describe, expect, it } from "vitest";
import { parsePublicDriveFolderHtml } from "../../supabase/functions/genspark-ai/drive-public-listing";

describe("parsePublicDriveFolderHtml", () => {
  it("extracts folders and PDFs from the public Google Drive page", () => {
    const html = `
      <div data-id="folder-rational" data-tooltip="RATIONAL Shared folder">
        <span><strong class="DNoYtb">RATIONAL</strong></span>
      </div>
      <div data-id="pdf-manual" data-tooltip="80.51.878_ServiceReferenz_iCombiPro_Q_pt-BR.pdf PDF">
        <span><strong class="DNoYtb">80.51.878_ServiceReferenz_iCombiPro_Q_pt-BR.pdf</strong></span>
      </div>
    `;

    expect(parsePublicDriveFolderHtml(html)).toEqual([
      {
        id: "folder-rational",
        name: "RATIONAL",
        mimeType: "application/vnd.google-apps.folder",
        size: "0",
      },
      {
        id: "pdf-manual",
        name: "80.51.878_ServiceReferenz_iCombiPro_Q_pt-BR.pdf",
        mimeType: "application/pdf",
        size: "0",
      },
    ]);
  });

  it("decodes names and ignores duplicate entries", () => {
    const html = `
      <div data-id="same" data-tooltip="Manual PDF"><strong>Manual &amp; Peças.pdf</strong></div>
      <div data-id="same" data-tooltip="Manual PDF"><strong>Duplicado.pdf</strong></div>
    `;

    expect(parsePublicDriveFolderHtml(html)).toHaveLength(1);
    expect(parsePublicDriveFolderHtml(html)[0].name).toBe("Manual & Peças.pdf");
  });
});
