import WordExtractor from 'word-extractor';
import mammoth from 'mammoth';

export interface DocExtractResult {
    text: string;
    html: string;
}

/**
 * .doc (Word 97-2004 OLE binary) fayllardan matn ajratib olish.
 * Agar fayl aslida .docx bo'lib faqat kengaytmasi .doc qilingan bo'lsa,
 * avtomatik tarzda mammoth orqali o'qish zaxira varianti mavjud.
 */
export async function extractTextFromDoc(buffer: Buffer): Promise<DocExtractResult> {
    // 1. WordExtractor orqali klassik .doc (OLE2 binary) o'qish
    try {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        const headers = extracted.getHeaders() || '';
        const body = extracted.getBody() || '';
        const footers = extracted.getFooters() || '';

        const fullText = [headers, body, footers].filter(Boolean).join('\n\n').trim();
        if (fullText) {
            const html = fullText
                .split('\n\n')
                .filter(p => p.trim())
                .map(p => `<p>${p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`)
                .join('');
            return { text: fullText, html };
        }
    } catch (docErr) {
        console.warn('[docExtract] WordExtractor xatoligi (balki fayl aslida docx formatidadir):', docErr);
    }

    // 2. Mammoth orqali zaxira o'qish (agar fayl aslida docx bo'lsa)
    try {
        const rawResult = await mammoth.extractRawText({ buffer });
        const htmlResult = await mammoth.convertToHtml({ buffer });
        if (rawResult.value && rawResult.value.trim()) {
            return {
                text: rawResult.value.trim(),
                html: htmlResult.value || ''
            };
        }
    } catch (mammothErr) {
        console.warn('[docExtract] Mammoth fallback xatoligi:', mammothErr);
    }

    throw new Error('.doc faylidan matn ajratib olishning imkoni bo\'lmadi.');
}
