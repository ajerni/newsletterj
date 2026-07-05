import { access, constants } from "node:fs/promises";
import puppeteer from "puppeteer";

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

const CHROME_KANDIDATEN = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function chromePfadErmitteln(): Promise<string | undefined> {
    for (const kandidat of CHROME_KANDIDATEN) {
        if (!kandidat) continue;
        try {
            await access(kandidat, constants.X_OK);
            return kandidat;
        } catch {
            continue;
        }
    }
    return undefined;
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

export async function dossierPdfErzeugen(inhaltHtml: string): Promise<Uint8Array> {
    const executablePath = await chromePfadErmitteln();

    const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
    });

    try {
        const page = await browser.newPage();
        await page.setContent(pdfHtmlDokument(inhaltHtml), { waitUntil: "load" });
        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "18mm", right: "14mm", bottom: "18mm", left: "14mm" },
        });
        return pdf;
    } finally {
        await browser.close();
    }
}

export function dossierPdfDateiname(id: number, zeitraumLabel: string): string {
    const slug = zeitraumLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "");
    return `Schulmonitor-Dossier-${id}${slug ? `-${slug}` : ""}.pdf`;
}
