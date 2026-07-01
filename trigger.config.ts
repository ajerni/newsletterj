import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
    project: "newsletterj",
    runtime: "node",
    logLevel: "log",
    maxDuration: 600,
    dirs: ["src/trigger"],
});
