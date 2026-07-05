import { spawn } from "node:child_process";
import { access, constants, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF_STYLES = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 11pt;
        line-height: 1.45;
        color: #1f2937;
        padding: 0;
    }
    a { color: #1d4ed8; word-break: break-all; }
    h2 { font-size: 18pt; font-weight: 600; color: #111827; margin: 0 0 6px; }
    h3 { font-size: 13pt; font-weight: 600; color: #374151; margin: 0 0 10px; }
    h4 { font-size: 11pt; font-weight: 600; margin: 16px 0 8px; }
    .muted { color: #6b7280; font-size: 10pt; }
    .dossier-report-header {
        margin-bottom: 24px;
        padding-bottom: 12px;
        border-bottom: 1px solid #e5e7eb;
    }
    .dossier-section {
        margin-bottom: 28px;
        page-break-inside: avoid;
    }
    .dossier-stats { margin: 10px 0; padding-left: 20px; }
    .dossier-stats li { margin: 3px 0; }
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 8px 0 16px;
        font-size: 9pt;
        page-break-inside: auto;
    }
    thead th {
        background: #f9fafb;
        padding: 8px 10px;
        text-align: left;
        font-size: 8pt;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #6b7280;
        border: 1px solid #e5e7eb;
    }
    tbody td {
        padding: 8px 10px;
        border: 1px solid #e5e7eb;
        vertical-align: top;
    }
    tr { page-break-inside: avoid; }
    .badge {
        display: inline-block;
        padding: 2px 7px;
        border-radius: 10px;
        font-size: 8pt;
        font-weight: 500;
    }
    .badge-hoch { background: #fecaca; color: #991b1b; }
    .badge-mittel { background: #fef3c7; color: #92400e; }
    .badge-tief { background: #f3f4f6; color: #6b7280; }
    .badge-kategorie { background: #eff6ff; color: #1d4ed8; }
    .dossier-bar {
        height: 8px;
        border-radius: 4px;
        background: #1d4ed8;
    }
    .dossier-table-quellen td:last-child { word-break: break-all; }
`;

const WKHTMLTOPDF_KANDIDATEN = [
    process.env.WKHTMLTOPDF_PATH,
    "/usr/bin/wkhtmltopdf",
    "/usr/local/bin/wkhtmltopdf",
];

async function wkhtmltopdfPfadErmitteln(): Promise<string> {
    for (const kandidat of WKHTMLTOPDF_KANDIDATEN) {
        if (!kandidat) continue;
        try {
            await access(kandidat, constants.X_OK);
            return kandidat;
        } catch {
            continue;
        }
    }
    throw new Error(
        "wkhtmltopdf nicht gefunden. Installieren Sie es (Docker: apt install wkhtmltopdf, macOS: brew install wkhtmltopdf)."
    );
}

function pdfHtmlDokument(inhaltHtml: string): string {
    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <style>${PDF_STYLES}</style>
</head>
<body>${inhaltHtml}</body>
</html>`;
}

function wkhtmltopdfAusfuehren(binaer: string, htmlPfad: string, pdfPfad: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(binaer, [
            "--quiet",
            "--page-size", "A4",
            "--margin-top", "18mm",
            "--margin-right", "14mm",
            "--margin-bottom", "18mm",
            "--margin-left", "14mm",
            "--encoding", "UTF-8",
            "--enable-local-file-access",
            htmlPfad,
            pdfPfad,
        ], {
            env: {
                ...process.env,
                XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "/tmp",
            },
        });

        let stderr = "";
        proc.stderr.on("data", (chunk) => { stderr += String(chunk); });

        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `wkhtmltopdf beendet mit Code ${code}`));
        });
    });
}

export async function dossierPdfErzeugen(inhaltHtml: string): Promise<Uint8Array> {
    const binaer = await wkhtmltopdfPfadErmitteln();
    const tempDir = await mkdtemp(join(tmpdir(), "dossier-pdf-"));
    const htmlPfad = join(tempDir, "dossier.html");
    const pdfPfad = join(tempDir, "dossier.pdf");

    try {
        await writeFile(htmlPfad, pdfHtmlDokument(inhaltHtml), "utf8");
        await wkhtmltopdfAusfuehren(binaer, htmlPfad, pdfPfad);
        return await readFile(pdfPfad);
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export function dossierPdfDateiname(id: number, zeitraumLabel: string): string {
    const slug = zeitraumLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "");
    return `Schulmonitor-Dossier-${id}${slug ? `-${slug}` : ""}.pdf`;
}
