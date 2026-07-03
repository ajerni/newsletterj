import type { Context } from "hono";

export async function parseBody(c: Context): Promise<Record<string, unknown>> {
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
