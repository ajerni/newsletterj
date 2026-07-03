import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { apiRoutes } from "./routes/api.js";
import { adminRoutes } from "./routes/admin.js";
import { resourceKeys, resourceConfig } from "./config/resources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

app.use(
    "*",
    basicAuth({
        username: "admin",
        password: process.env.FRONTEND_PW || "admin",
    })
);

app.route("/api", apiRoutes);
app.route("/admin", adminRoutes);

app.get("/health", (c) => c.json({ ok: true }));

app.get("/", (c) => {
    const nav = resourceKeys().map((key) => {
        const label = resourceConfig(key).label;
        return `<button class="nav-btn" hx-get="/admin/${key}" hx-target="#crud-main" onclick="setActive(this)">${label}</button>`;
    }).join("");

    return c.html(`<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Schulmonitor CRUD</title>
    <link rel="stylesheet" href="/styles.css">
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
    <header>
        <div class="container">
            <h1><a href="/" hx-boost="true">Schulmonitor CRUD</a></h1>
            <nav>${nav}</nav>
        </div>
    </header>
    <main class="container">
        <div id="crud-main" hx-get="/admin/${resourceKeys()[0]}" hx-trigger="load" hx-target="this">
            <p class="muted">Laden…</p>
        </div>
        <div id="crud-panel-wrap"></div>
    </main>
    <script>
        function setActive(el) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('crud-panel')?.remove();
        }
        document.body.addEventListener('htmx:afterSwap', (e) => {
            if (e.detail.target.id === 'crud-main') {
                document.getElementById('crud-panel-wrap').innerHTML = '';
            }
        });
    </script>
</body>
</html>`);
});

app.use("/*", serveStatic({ root: path.resolve(__dirname, "../public") }));

const port = parseInt(process.env.PORT ?? "3002", 10);
console.log(`CRUD backend running at http://localhost:${port}`);
console.log(`  Admin UI:  http://localhost:${port}/`);
console.log(`  REST API:  http://localhost:${port}/api`);
serve({ fetch: app.fetch, port });
