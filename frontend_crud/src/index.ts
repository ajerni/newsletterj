import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { apiRoutes } from "./routes/api.js";
import { adminRoutes } from "./routes/admin.js";

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

app.use("/*", serveStatic({ root: path.resolve(__dirname, "../public") }));

const port = parseInt(process.env.PORT ?? "3002", 10);
console.log(`CRUD backend running at http://localhost:${port}`);
console.log(`  Admin UI:  http://localhost:${port}/`);
console.log(`  REST API:  http://localhost:${port}/api`);
serve({ fetch: app.fetch, port });
