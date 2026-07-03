import { Hono } from "hono";
import { resourceConfig, resourceKeys, filterFields } from "../config/resources.js";
import {
    listRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
} from "../lib/crud.js";
import { parseBody } from "../lib/parse-body.js";

export const apiRoutes = new Hono();

function filterFromQuery(c: { req: { query: (k: string) => string | undefined } }, key: string) {
    const config = resourceConfig(key);
    const filter: Record<string, string> = {};
    for (const f of filterFields(config)) {
        const v = c.req.query(f.name);
        if (v) filter[f.name] = v;
    }
    return filter;
}

function sortFromQuery(c: { req: { query: (k: string) => string | undefined } }, key: string) {
    const config = resourceConfig(key);
    if (!config.listSort) return undefined;
    return c.req.query(config.listSort.param) || config.listSort.default;
}

apiRoutes.get("/", (c) => {
    return c.json({
        resources: resourceKeys().map((key) => ({
            key,
            label: resourceConfig(key).label,
            endpoints: {
                list: `/api/${key}`,
                item: `/api/${key}/:id`,
            },
        })),
    });
});

for (const key of resourceKeys()) {
    const routes = new Hono();

    routes.get("/", async (c) => {
        const seite = Math.max(1, Number(c.req.query("seite")) || 1);
        const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
        const suche = (c.req.query("suche") || "").trim();
        const { rows, total } = await listRecords(key, {
            seite, limit, suche,
            filter: filterFromQuery(c, key),
            sort: sortFromQuery(c, key),
        });
        return c.json({ data: rows, total, seite, limit, pages: Math.ceil(total / limit) });
    });

    routes.get("/:id", async (c) => {
        const id = Number(c.req.param("id"));
        const row = await getRecord(key, id);
        if (!row) return c.json({ error: "Nicht gefunden" }, 404);
        return c.json(row);
    });

    routes.post("/", async (c) => {
        try {
            const body = await parseBody(c);
            const row = await createRecord(key, body);
            return c.json(row, 201);
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : "Fehler" }, 400);
        }
    });

    routes.put("/:id", async (c) => {
        try {
            const id = Number(c.req.param("id"));
            const body = await parseBody(c);
            const row = await updateRecord(key, id, body);
            return c.json(row);
        } catch (err) {
            const status = err instanceof Error && err.message.includes("nicht gefunden") ? 404 : 400;
            return c.json({ error: err instanceof Error ? err.message : "Fehler" }, status);
        }
    });

    routes.delete("/:id", async (c) => {
        try {
            const id = Number(c.req.param("id"));
            await deleteRecord(key, id);
            return c.json({ ok: true });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Fehler";
            const status = msg.includes("nicht gefunden") ? 404 : msg.startsWith("Löschen nicht möglich") ? 409 : 400;
            return c.json({ error: msg }, status);
        }
    });

    apiRoutes.route(`/${key}`, routes);
}
