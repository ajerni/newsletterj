/**
 * Parses JSON returned by an LLM that may wrap the payload in markdown code
 * fences (```json ... ```) or add surrounding prose, despite response_format.
 */
export function llmJsonParsen<T = any>(inhalt: string): T {
    if (typeof inhalt !== "string") {
        throw new Error("LLM-Antwort ist kein String");
    }

    let text = inhalt.trim();

    // Strip a leading/trailing markdown code fence (```json ... ``` or ``` ... ```)
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        // Fallback: extract the first balanced JSON object/array from the text
        const ausschnitt = ersteJsonStrukturExtrahieren(text);
        if (ausschnitt) {
            return JSON.parse(ausschnitt) as T;
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
