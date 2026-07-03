import { Hono, type Context } from "hono";
import { resourceConfig, resourceKeys } from "../config/resources.js";
import {
    listRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
} from "../lib/crud.js";

async function parseBody(c: Context): Promise<Record<string, unknown>> {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
        return await c.req.json<Record<string, unknown>>();
    }
    const form = await c.req.parseBody();
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
        body[key] = value;
    }
    return body;
}

export const apiRoutes = new Hono();

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
        const { rows, total } = await listRecords(key, seite, limit);
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
            const status = err instanceof Error && err.message.includes("nicht gefunden") ? 404 : 400;
            return c.json({ error: err instanceof Error ? err.message : "Fehler" }, status);
        }
    });

    apiRoutes.route(`/${key}`, routes);
}
