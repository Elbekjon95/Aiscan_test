import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import JSZip from 'jszip';

/**
 * DOCX faylni ZIP sifatida ochib, document.xml ichidagi matnlarni
 * optimized_replacements orqali almashtiradi.
 * Original formatlash 100% saqlanadi chunki biz faqat matn qismlarini o'zgartiramiz.
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session.isLoggedIn) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const replacementsStr = formData.get('replacements') as string || '[]';

        if (!file) {
            return NextResponse.json({ success: false, error: 'Fayl yuklanmadi' }, { status: 400 });
        }

        let replacements: { original_phrase: string; corrected_phrase: string }[] = [];
        try {
            replacements = JSON.parse(replacementsStr);
        } catch {
            return NextResponse.json({ success: false, error: 'Replacements formati noto\'g\'ri' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const fileExt = file.name.split('.').pop()?.toLowerCase();

        if (fileExt !== 'docx') {
            // PDF uchun oddiy matn asosida yangi DOCX yaratamiz (eski usulda)
            // PDF ni to'g'ridan-to'g'ri tahrirlash mumkin emas
            return NextResponse.json({ 
                success: false, 
                error: 'Faqat DOCX fayllarni original formatlash bilan tuzatish mumkin. PDF va DOC fayllar uchun Word (DOCX) formatida yuklab oling.' 
            }, { status: 400 });
        }

        // DOCX faylni ZIP sifatida ochish
        const zip = await JSZip.loadAsync(buffer);
        
        // word/document.xml ni olish — bu asosiy hujjat matni
        const docXmlFile = zip.file('word/document.xml');
        if (!docXmlFile) {
            return NextResponse.json({ success: false, error: 'DOCX fayl tuzilishi noto\'g\'ri' }, { status: 400 });
        }

        let docXml = await docXmlFile.async('string');

        // Har bir replacement uchun XML ichidan matnni topib almashtirish
        for (const rep of replacements) {
            if (!rep.original_phrase || !rep.corrected_phrase) continue;

            const origTrimmed = rep.original_phrase.trim();
            const corrTrimmed = rep.corrected_phrase.trim();
            if (origTrimmed.length === 0) continue;

            // DOCX XML da matn <w:t> teglari ichida bo'ladi.
            // Ba'zan bitta gap bir nechta <w:r><w:t> teglarga bo'lingan bo'ladi.
            // Shuning uchun avval barcha <w:t> teglar ichidagi matnni yig'ib,
            // original phrase ni topamiz, keyin almashtiramiz.

            // 1-strategiya: Oddiy string replace (bitta <w:t> ichida joylashgan matnlar uchun)
            // XML spetsial belgilarni escape qilish
            const xmlEscapedOrig = escapeXml(origTrimmed);
            const xmlEscapedCorr = escapeXml(corrTrimmed);

            if (docXml.includes(xmlEscapedOrig)) {
                docXml = docXml.replace(xmlEscapedOrig, xmlEscapedCorr);
                continue;
            }

            // 2-strategiya: Matn bir nechta <w:r> (run) larga bo'lingan bo'lishi mumkin.
            // Bu holda barcha <w:t> matnlarini yig'ib, jumlani topamiz va almashtiramiz.
            docXml = replaceAcrossRuns(docXml, origTrimmed, corrTrimmed);
        }

        // Yangilangan XML ni ZIP ga qaytarish
        zip.file('word/document.xml', docXml);

        // ZIP ni qaytadan DOCX formatida yaratish
        const outputBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        // Fayl nomini tayyorlash
        const baseName = file.name.replace(/\.docx$/i, '');
        const asciiName = baseName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const encodedName = encodeURIComponent(baseName);

        return new NextResponse(new Uint8Array(outputBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': `attachment; filename="${asciiName}_corrected.docx"; filename*=UTF-8''${encodedName}_corrected.docx`,
            }
        });

    } catch (err: any) {
        console.error("Download-corrected error:", err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

/**
 * XML spetsial belgilarni escape qilish
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Matnni bir nechta <w:r> (run) lar bo'ylab qidirib almashtirish.
 * 
 * DOCX XML da bitta gap ko'pincha bir nechta <w:r> teglarga bo'linadi:
 *   <w:r><w:t>Birinchi </w:t></w:r><w:r><w:t>qism</w:t></w:r>
 * 
 * Bu funksiya barcha <w:t> teglarning matnini birlashtiradi,
 * original phrase ni topadi, va to'g'rilangan matn bilan almashtiradi.
 */
function replaceAcrossRuns(xml: string, originalPhrase: string, correctedPhrase: string): string {
    // Paragraf teglarini topish (<w:p ...> ... </w:p>)
    const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    
    return xml.replace(pRegex, (paragraph) => {
        // Paragraf ichidagi barcha <w:t ...>matn</w:t> larni topish
        const tRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
        const matches: { fullMatch: string; text: string; index: number }[] = [];
        let m;
        
        while ((m = tRegex.exec(paragraph)) !== null) {
            matches.push({ fullMatch: m[0], text: m[1], index: m.index });
        }
        
        if (matches.length === 0) return paragraph;
        
        // Barcha matnlarni birlashtirish
        const fullText = matches.map(m => m.text).join('');
        
        // XML escape qilingan original phrase ni oddiy matnga qaytarish
        const escapedOriginal = escapeXml(originalPhrase);
        
        // Birlashtirilgan matnda qidirish
        const idx = fullText.indexOf(escapedOriginal);
        if (idx === -1) {
            // Oddiy matn bilan ham sinab ko'ramiz
            const plainIdx = fullText.indexOf(originalPhrase);
            if (plainIdx === -1) return paragraph;
            
            return replaceTextInParagraph(paragraph, matches, originalPhrase, correctedPhrase);
        }
        
        return replaceTextInParagraph(paragraph, matches, escapedOriginal, escapeXml(correctedPhrase));
    });
}

/**
 * Paragraf ichidagi <w:t> teglar bo'ylab matnni almashtirish.
 * Birinchi tegga to'g'rilangan matnni joylashtirib, qolgan teglarni bo'shatish.
 */
function replaceTextInParagraph(
    paragraph: string, 
    matches: { fullMatch: string; text: string; index: number }[], 
    searchText: string, 
    replaceText: string
): string {
    const fullText = matches.map(m => m.text).join('');
    const searchIdx = fullText.indexOf(searchText);
    if (searchIdx === -1) return paragraph;
    
    const searchEnd = searchIdx + searchText.length;
    
    // Har bir <w:t> tegining matn diapazonini aniqlash
    let charOffset = 0;
    let result = paragraph;
    let replacementDone = false;
    
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const matchStart = charOffset;
        const matchEnd = charOffset + match.text.length;
        charOffset = matchEnd;
        
        // Bu teg almashtirilayotgan matnning qaysi qismini o'z ichiga oladi?
        if (matchEnd <= searchIdx || matchStart >= searchEnd) {
            // Bu teg almashtirilayotgan matn chegarasidan tashqarida — o'zgartirmaymiz
            continue;
        }
        
        // Almashtirilayotgan matnga tegishli qism
        const overlapStart = Math.max(matchStart, searchIdx) - matchStart;
        const overlapEnd = Math.min(matchEnd, searchEnd) - matchStart;
        
        let newText = match.text;
        
        if (!replacementDone) {
            // Birinchi tegga to'g'rilangan matnni joylashtiramiz
            newText = match.text.substring(0, overlapStart) + replaceText + match.text.substring(overlapEnd);
            replacementDone = true;
        } else {
            // Keyingi teglardagi mos keladigan qismni o'chiramiz
            newText = match.text.substring(0, overlapStart) + match.text.substring(overlapEnd);
        }
        
        // XML tegni yangi matn bilan almashtirish
        const newTag = match.fullMatch.replace(`>${match.text}<`, `>${newText}<`);
        result = result.replace(match.fullMatch, newTag);
    }
    
    return result;
}
