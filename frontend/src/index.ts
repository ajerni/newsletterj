import "dotenv/config";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { dashboardRoutes } from "./routes/dashboard.js";
import { artikelRoutes } from "./routes/artikel.js";
import { personenRoutes } from "./routes/personen.js";
import { ereignisseRoutes } from "./routes/ereignisse.js";
import { gemeindenRoutes } from "./routes/gemeinden.js";
import { laeufeRoutes } from "./routes/laeufe.js";
import { faelleRoutes } from "./routes/faelle.js";
import { sucheRoutes } from "./routes/suche.js";
import { chatRoutes } from "./routes/chat.js";
import { dossierRoutes } from "./routes/dossier.js";
import { esc } from "./html.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = "newsletterj_session";
const SESSION_TOKEN = randomBytes(32).toString("hex");
const USERNAME = "admin";
const PASSWORD = process.env.FRONTEND_PW || "admin";

const app = new Hono();

function secureCompare(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function hasSession(cookieValue: string | undefined): boolean {
    return typeof cookieValue === "string" && secureCompare(cookieValue, SESSION_TOKEN);
}

function safeNext(next: FormDataEntryValue | string | null): string {
    if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) {
        return "/";
    }
    return next === "/login" || next.startsWith("/login?") ? "/" : next;
}

function loginPage(params: { error?: boolean; loggedOut?: boolean; next?: string } = {}): string {
    const next = params.next ? safeNext(params.next) : "/";

    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Anmelden | Schulmonitor ZH</title>
    <script>
        (function () {
            const gespeichert = localStorage.getItem("theme");
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            const theme = gespeichert === "dark" || gespeichert === "light"
                ? gespeichert
                : (prefersDark ? "dark" : "light");
            document.documentElement.setAttribute("data-theme", theme);
        })();
    </script>
    <link rel="stylesheet" href="/styles.css">
</head>
<body class="login-body">
    <main class="login-shell">
        <section class="login-panel" aria-labelledby="login-title">
            <div class="login-kicker">Schulmonitor ZH</div>
            <h1 id="login-title">Medienspiegel</h1>
            <p>Geschützter Zugang für die Auswertung von Bildungs- und Schulpolitik im Kanton Zürich.</p>
            ${params.error ? `<div class="login-alert" role="alert">Benutzername oder Passwort ist falsch.</div>` : ""}
            ${params.loggedOut ? `<div class="login-alert login-alert-success" role="status">Sie wurden abgemeldet.</div>` : ""}
            <form method="post" action="/login" class="login-form">
                <input type="hidden" name="next" value="${esc(next)}">
                <label>
                    Benutzername
                    <input type="text" name="username" value="admin" autocomplete="username" required autofocus>
                </label>
                <label>
                    Passwort
                    <input type="password" name="password" autocomplete="current-password" required>
                </label>
                <button type="submit" class="btn btn-primary login-submit">Anmelden</button>
            </form>
        </section>
    </main>
</body>
</html>`;
}

app.use("/styles.css", serveStatic({ root: path.resolve(__dirname, "../public") }));

app.get("/login", (c) => {
    if (hasSession(getCookie(c, SESSION_COOKIE))) {
        return c.redirect(safeNext(c.req.query("next") ?? "/"));
    }

    return c.html(loginPage({
        loggedOut: c.req.query("logged_out") === "1",
        next: c.req.query("next") ?? "/",
    }));
});

app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!secureCompare(username, USERNAME) || !secureCompare(password, PASSWORD)) {
        return c.html(loginPage({ error: true, next: safeNext(body.next ?? "/") }), 401);
    }

    setCookie(c, SESSION_COOKIE, SESSION_TOKEN, {
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(c.req.url).protocol === "https:",
        path: "/",
    });

    return c.redirect(safeNext(body.next ?? "/"));
});

app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/login?logged_out=1");
});

app.use("*", async (c, next) => {
    if (hasSession(getCookie(c, SESSION_COOKIE))) {
        await next();
        return;
    }

    const url = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
});

app.route("/api/dashboard", dashboardRoutes);
app.route("/api/artikel", artikelRoutes);
app.route("/api/personen", personenRoutes);
app.route("/api/ereignisse", ereignisseRoutes);
app.route("/api/gemeinden", gemeindenRoutes);
app.route("/api/laeufe", laeufeRoutes);
app.route("/api/faelle", faelleRoutes);
app.route("/api/suche", sucheRoutes);
app.route("/api/chat", chatRoutes);
app.route("/api/dossier", dossierRoutes);

app.use("/*", serveStatic({ root: path.resolve(__dirname, "../public") }));

const port = parseInt(process.env.PORT ?? "3001", 10);
console.log(`Frontend running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
