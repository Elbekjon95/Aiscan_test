// lib/gemini.ts
import { jsonrepair } from 'jsonrepair';

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-argon';

export async function callGeminiStream(data: any, returnText: boolean = false): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // Generation configni har doim sozlaymiz
    if (!data.generationConfig) {
        data.generationConfig = {};
    }
    
    // maxOutputTokens ni default qiymat bilan ta'minlash (agar berilmagan bo'lsa)
    if (!data.generationConfig.maxOutputTokens) {
        data.generationConfig.maxOutputTokens = 8192; // Default qiymat
    }

    let response;
    let retries = 5;
    let errorBody = "";

    while (retries > 0) {
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                break; // Muvaffaqiyatli
            }

            errorBody = await response.text();
            
            // Agar 503 High Demand bo'lsa, biroz kutib qayta urinamiz (Exponential backoff)
            if (response.status === 503) {
                const waitTime = (6 - retries) * 3000; // 3s, 6s, 9s, 12s, 15s
                console.warn(`Gemini API 503 xatosi. Qayta urinish... Qolgan urinishlar: ${retries - 1}. Kutish vaqti: ${waitTime / 1000}s`);
                retries--;
                if (retries === 0) break;
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            // Boshqa xatoliklar uchun darhol to'xtaymiz
            console.error(`Gemini API Error (Status ${response.status}):`, errorBody);
            throw new Error(`Gemini API error: ${response.status} - ${errorBody.substring(0, 200)}`);
        } catch (err: any) {
            if (retries === 1 || err.message.includes("Gemini API error")) throw err;
            const waitTime = (6 - retries) * 3000;
            console.warn(`Tarmoq xatosi (fetch): ${err.message}. Qayta urinish... Kutish vaqti: ${waitTime / 1000}s`);
            retries--;
            await new Promise(r => setTimeout(r, waitTime));
        }
    }

    if (!response || !response.ok) {
        throw new Error(`Gemini API error (Max retries reached): ${response?.status} - ${errorBody.substring(0, 200)}`);
    }

        const json = await response.json();
        let textResponse = "";

        if (json.candidates?.[0]?.content?.parts) {
            for (const part of json.candidates[0].content.parts) {
                // Agar part thought (fikrlash/reasoning) bo'lsa, uni JSON ga qo'shmaymiz
                if (part.text && !part.thought) {
                    textResponse += part.text;
                }
            }
            // Agar thought filterlangandan keyin bo'sh qolsa (eski format), barcha textlarni olamiz
            if (!textResponse.trim()) {
                for (const part of json.candidates[0].content.parts) {
                    if (part.text) {
                        textResponse += part.text;
                    }
                }
            }
        }

        // Agar model qidiruv natijasini (Grounding) qaytarsa, log qilamiz
        if (json.candidates?.[0]?.groundingMetadata) {
            console.log("Grounding metadata found");
        }

        const finishReason = json.candidates?.[0]?.finishReason;
        if (finishReason === 'MAX_TOKENS') {
            console.warn("Gemini response was cut off (MAX_TOKENS). Increase maxOutputTokens.");
        }

        if (!textResponse) {
            console.error(
                "Gemini returned empty text. finishReason:",
                finishReason,
                "Full JSON:",
                JSON.stringify(json).substring(0, 600)
            );
            throw new Error(`Gemini empty response content (finishReason: ${finishReason})`);
        }

        if (returnText) {
            return textResponse;
        }

        let cleanJson = textResponse.trim();
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        }
        
        const firstBrace = cleanJson.indexOf('{');
        const firstBracket = cleanJson.indexOf('[');
        let startIdx = Infinity;
        let endIdx = -1;

        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
            startIdx = firstBrace;
            endIdx = cleanJson.lastIndexOf('}');
        } else if (firstBracket !== -1) {
            startIdx = firstBracket;
            endIdx = cleanJson.lastIndexOf(']');
        }
        
        if (startIdx !== Infinity && endIdx !== -1 && endIdx >= startIdx) {
            cleanJson = cleanJson.substring(startIdx, endIdx + 1);
        }

        // 1. Standart JSON.parse
        try {
            return JSON.parse(cleanJson);
        } catch (e) {
            // 2. jsonrepair orqali tozalash va tiklash (kesilgan yoki tirnoqlar buzilgan bo'lsa)
            try {
                const repaired = jsonrepair(cleanJson);
                return JSON.parse(repaired);
            } catch (rErr) {
                // 3. To'liq matn ustida jsonrepair qilib ko'rish
                try {
                    const repairedFull = jsonrepair(textResponse);
                    return JSON.parse(repairedFull);
                } catch (fullErr) {
                    console.error("Failed to parse JSON. Raw text:", textResponse.substring(0, 500));
                    try { require('fs').writeFileSync('gemini_error.log', textResponse); } catch(err) {}
                    throw new Error(`Invalid JSON format from AI. Qaytarilgan matn: AI javobi serverga (gemini_error.log) yozildi!`);
                }
            }
        }
}
