interface OpenRouterChatAntwort {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
    error?: { message?: string };
}

export async function openRouterChat(
    system: string,
    user: string,
    maxTokens = 2000
): Promise<string> {
    const modell = process.env.OPENROUTER_MODEL;
    if (!modell) {
        throw new Error("OPENROUTER_MODEL ist nicht konfiguriert");
    }
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY ist nicht konfiguriert");
    }

    const antwort = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modell,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            max_tokens: maxTokens,
            temperature: 0.2,
        }),
    });

    if (!antwort.ok) {
        const text = await antwort.text().catch(() => "");
        throw new Error(`OpenRouter fehlgeschlagen: ${antwort.status} ${text.slice(0, 150)}`);
    }

    const daten: OpenRouterChatAntwort = await antwort.json();
    if (daten?.error) {
        throw new Error(daten.error.message ?? "OpenRouter Fehler");
    }
    const content = daten?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenRouter lieferte keine Antwort");
    }
    return content.trim();
}
