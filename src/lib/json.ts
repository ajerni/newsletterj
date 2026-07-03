type InhaltTeil = { type?: string; text?: string };

export interface OpenRouterChatAntwort {
    choices?: Array<{
        finish_reason?: string;
        message?: {
            content?: string | InhaltTeil[] | null;
            // Reasoning models (e.g. minimax-m3) may put text here when content is empty
            reasoning?: string | null;
            reasoning_content?: string | null;
        };
    }>;
    error?: { message?: string };
}

/**
 * Extracts textual content from an OpenRouter chat response, tolerating
 * error payloads, null content, and content-part arrays (multimodal/reasoning
 * models). Falls back to reasoning fields when content is empty, since some
 * reasoning models emit their JSON answer there. Throws with a clear message
 * when no usable text is present.
 */
export function llmInhaltExtrahieren(daten: OpenRouterChatAntwort): string {
    if (daten?.error) {
        throw new Error(`OpenRouter Fehler: ${daten.error.message ?? "unbekannt"}`);
    }

    const message = daten?.choices?.[0]?.message;
    const content = message?.content;

    let text = "";
    if (typeof content === "string") {
        text = content;
    } else if (Array.isArray(content)) {
        text = content.map((teil) => (typeof teil?.text === "string" ? teil.text : "")).join("").trim();
    }

    if (!text.trim()) {
        const reasoning = message?.reasoning_content ?? message?.reasoning;
        if (typeof reasoning === "string" && reasoning.trim()) {
            text = reasoning;
        }
    }

    if (!text.trim()) {
        const finishReason = daten?.choices?.[0]?.finish_reason;
        if (finishReason === "length") {
            throw new Error("OpenRouter Antwort abgeschnitten (max_tokens erreicht, kein Inhalt)");
        }
        throw new Error("OpenRouter lieferte keinen Textinhalt");
    }

    return text;
}

/**
 * Parses JSON returned by an LLM that may wrap the payload in markdown code
 * fences (```json ... ```) or add surrounding prose, despite response_format.
 */
export function llmJsonParsen<T = any>(inhalt: string): T {
    if (typeof inhalt !== "string") {
        throw new Error("LLM-Antwort ist kein String");
    }

    // Strip BOM and zero-width characters that break JSON.parse
    let text = inhalt.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\u2060]/g, "").trim();

    // Strip a leading/trailing markdown code fence (```json ... ``` or ``` ... ```)
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    } else {
        // Fence embedded in surrounding prose (e.g. "Here is the JSON: ```json {...} ``` Hope that helps")
        const eingebettet = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (eingebettet && eingebettet[1].trim().match(/^[{\[]/)) {
            text = eingebettet[1].trim();
        }
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        // Fallback 1: extract the first balanced JSON object/array from the text
        const ausschnitt = ersteJsonStrukturExtrahieren(text);
        if (ausschnitt) {
            try {
                return JSON.parse(ausschnitt) as T;
            } catch {
                // Fallback 2: repair trailing commas ({"a": 1,} / [1, 2,])
                const repariert = ausschnitt.replace(/,\s*([}\]])/g, "$1");
                try {
                    return JSON.parse(repariert) as T;
                } catch {
                    // fall through to error below
                }
            }
        }
        throw new Error(`Konnte JSON nicht parsen: ${inhalt.slice(0, 200)}`);
    }
}

function ersteJsonStrukturExtrahieren(text: string): string | null {
    const startObj = text.indexOf("{");
    const startArr = text.indexOf("[");
    let start = -1;
    if (startObj === -1) start = startArr;
    else if (startArr === -1) start = startObj;
    else start = Math.min(startObj, startArr);
    if (start === -1) return null;

    const oeffner = text[start];
    const schliesser = oeffner === "{" ? "}" : "]";
    let tiefe = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const zeichen = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (zeichen === "\\") {
                escaped = true;
            } else if (zeichen === '"') {
                inString = false;
            }
            continue;
        }
        if (zeichen === '"') {
            inString = true;
        } else if (zeichen === oeffner) {
            tiefe++;
        } else if (zeichen === schliesser) {
            tiefe--;
            if (tiefe === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null;
}
