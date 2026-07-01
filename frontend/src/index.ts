import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { dashboardRoutes } from "./routes/dashboard.js";
import { artikelRoutes } from "./routes/artikel.js";
import { personenRoutes } from "./routes/personen.js";
import { ereignisseRoutes } from "./routes/ereignisse.js";
import { gemeindenRoutes } from "./routes/gemeinden.js";
import { laeufeRoutes } from "./routes/laeufe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

app.use(
    "*",
    basicAuth({
        username: "admin",
        password: process.env.FRONTEND_PW || "admin",
    })
);

app.route("/api/dashboard", dashboardRoutes);
app.route("/api/artikel", artikelRoutes);
app.route("/api/personen", personenRoutes);
app.route("/api/ereignisse", ereignisseRoutes);
app.route("/api/gemeinden", gemeindenRoutes);
app.route("/api/laeufe", laeufeRoutes);

app.use("/*", serveStatic({ root: path.resolve(__dirname, "../public") }));

const port = parseInt(process.env.PORT ?? "3001", 10);
console.log(`Frontend running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
