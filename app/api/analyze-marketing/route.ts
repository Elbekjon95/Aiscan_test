import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { callGeminiStream } from '@/lib/gemini';
import { getSession } from '@/lib/auth';
import { extractTextFromDoc } from '@/lib/docExtract';

const mammoth = require('mammoth');

export const maxDuration = 300;

// orginfo.uz dan barcha yuridik ma'lumotlarni (STIR, Manzil, Tel, Email) qidirib topish funksiyasi
async function fetchOrgDetails(companyName: string) {
    try {
        // Nomni tozalash, lekin hammasini o'chirib tashlamaymiz
        const cleanName = companyName
            .replace(/["'«»]+/g, '')
            .replace(/(mas['`‘]uliyati cheklangan jamiyati|obshchestvo s ogranichennoy otvetstvennostyu)/gi, 'MChJ')
            .trim();
            
        // 1-urinish: To'liq nom bilan qidirish
        let searchUrl = `https://orginfo.uz/uz/search/organizations/?q=${encodeURIComponent(cleanName)}`;
        let searchResponse = await fetch(searchUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        
        if (!searchResponse.ok) return null;
        let searchHtml = await searchResponse.text();
        
        // Agar natija chiqmasa, faqat birinchi so'z bilan urinib ko'ramiz
        if (!searchHtml.includes('/uz/organization/')) {
            const firstWord = cleanName.split(' ')[0];
            if (firstWord.length > 3) {
                searchUrl = `https://orginfo.uz/uz/search/organizations/?q=${encodeURIComponent(firstWord)}`;
                searchResponse = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                searchHtml = await searchResponse.text();
            }
        }
        
        // Birinchi tashkilot linkini va nomini topamiz
        // Regexni biroz kengaytiramizki, nomni ham tutib olsin
        const linkMatch = searchHtml.match(/<a href="(\/uz\/organization\/[a-z0-9]+\/)"[^>]*>[\s\S]*?<h6[^>]*>([\s\S]*?)<\/h6>/i);
        if (!linkMatch) return null;
        
        const orgUrlPath = linkMatch[1];
        const foundNameOnSite = linkMatch[2].replace(/<[^>]*>/g, '').trim().toLowerCase();
        const searchNameLower = cleanName.toLowerCase();
        
        // NOMNI TEKSHIRISH (Validation): 
        // Agar topilgan nom qidirilgan nomga umuman o'xshamasam (masalan ELDAS vs ELJAS), uni olmaymiz.
        // Hech bo'lmaganda birinchi 3-4 harfi to'g'ri kelishi kerak.
        const searchBase = searchNameLower.split(' ')[0].substring(0, 4);
        if (!foundNameOnSite.includes(searchBase)) {
            console.log(`[Validation Failed] ${cleanName} vs ${foundNameOnSite}`);
            return null;
        }
        
        const orgUrl = `https://orginfo.uz${orgUrlPath}`;
        const orgResponse = await fetch(orgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!orgResponse.ok) return null;
        const html = await orgResponse.text();
        
        // JSON-LD ma'lumotlarini qidiramiz (eng aniq yo'li)
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
        if (jsonLdMatch) {
            try {
                const data = JSON.parse(jsonLdMatch[1].trim());
                return {
                    stir: data.taxID || data.identifier || null,
                    phone: data.telephone ? `+998${data.telephone}` : null,
                    email: (data.email && data.email !== "100000") ? data.email : null,
                    address: data.address ? `${data.address.addressLocality}, ${data.address.streetAddress}` : null
                };
            } catch(e) {}
        }
        
        // Zaxira sifatida regex orqali qidirish
        return {
            stir: (html.match(/STIR:[^>]*>(\d{9})/i) || html.match(/>(\d{9})<\/span>/i))?.[1] || null,
            phone: html.match(/(?:Telefon|Номер телефона):?\s*<[^>]*>([\d\s+]+)/i)?.[1]?.trim() || null,
            email: html.match(/(?:Email|Электронная почta):?\s*<[^>]*>([^<]+)/i)?.[1]?.trim() || null,
            address: html.match(/(?:Manzil|Адрес):?\s*<[^>]*>([^<]+)/i)?.[1]?.trim() || null,
        };
    } catch (e) {
        console.error(`OrgDetails fetch error for ${companyName}:`, e);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const lang = formData.get('lang') as string || 'uz';

        if (!file) {
            return NextResponse.json({ success: false, error: 'File not provided' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const fileExt = file.name.split('.').pop()?.toLowerCase();

        let text = '';
        if (fileExt === 'pdf') {
            text = '';
        } else if (fileExt === 'docx') {
            // HTML formatda olish — jadvallar va texnik talablar saqlanadi
            const htmlResult = await mammoth.convertToHtml({ buffer });
            text = htmlResult.value || '';
            if (!text) {
                const rawResult = await mammoth.extractRawText({ buffer });
                text = rawResult.value;
            }
        } else if (fileExt === 'doc') {
            const docResult = await extractTextFromDoc(buffer);
            text = docResult.html || docResult.text;
        } else {
            return NextResponse.json({ success: false, error: 'Faqat PDF, DOCX va DOC fayllari ruxsat etiladi.' }, { status: 400 });
        }

        const targetLangName = lang === 'uz' ? "O'zbek tili" : (lang === 'ru' ? "Rus tili" : "Ingliz tili");

        console.log("=== STARTING 3-STEP MARKETING ANALYSIS ===");

        // ==============================================
        // STEP 1: RESEARCH (Deep Search via Gemini Tool)
        // ==============================================
        console.log("[Step 1] Researching...");
        const researchPrompt = `
Siz O'zbekistonda xizmat ko'rsatgan yuqori darajadagi xaridlar (procurement) va marketing bo'yicha ekspertsiz. 
Men senga yuklagan Texnik Talablar (Technical Requirements) hujjatini diqqat bilan o'rganib chiq.

VAZIFA: 
1. **QAT'IY TALAB (10 TA FIRMA):** O'zbekiston va Xalqaro bozordan KAMIDA 10 TA tashkilot/firma topishingiz SHART! 10 tadan kam bo'lishi mumkin emas. Qidiruvni to'xtatmang.
2. **ENG MUHIM TALAB (NARXLAR):** Har bir tashkilot uchun mahsulotning REAL BOZOR NARXINI internetdan chuqur qidirib, aniq raqamlarda ko'rsating. Agar korxonaning o'z saytida narx bo'lmasa, B2B savdo platformalaridan (Alibaba, Prom.uz, Glotr.uz, Tiu.ru, Amazon va h.k.) o'sha korxonaning mahsulot narxini yoki o'rtacha narxini qidirib toping! Narx va uning aniq manbasi (URL) bo'lishi shart!
3. **Kompaniya rekvizitlari:** Topilgan har bir O'zbekiston kompaniyasi uchun "orginfo.uz [Kompaniya nomi]" orqali qidirib faqat STIR (INN), yuridik manzil, Telefon va Emailni oling. DIQQAT: STIR (INN) raqamlarini ASLO o'ylab topmang (masalan 123456789 qilib uydirmang)! Agar aniq hujjatli STIR topilmasa, "Topilmadi" deb qoldiring. Soxta ma'lumot yozish qat'iyan man etiladi!
4. **QAT'IY OGOHLANTIRISH:** orginfo.uz yoki korxona.uz bu kompaniyaning rasmiy veb-sayti EMAS! U yerdagi linklarni "Kompaniya veb-sayti" yoki "Narx manbasi" sifatida aslo yozmang.
5. Kompaniyaning haqiqiy veb-sayti va narx ko'rsatilgan mahsulot linkini (URL) izlab toping. Agar kompaniyaning o'zini haqiqiy sayti bo'lmasa, URL o'rniga qat'iyan "null" (mavjud emas) deb belgilang.
6. Xalqaro kompaniyalar uchun rasmiy veb-saytidan ularning kontaktlari va manzillarini qidirib toping.

Quyidagi Text formatida erkin, lekin iloji boricha ko'p va ANIQ ma'lumot qidirib yozing (Hali JSON kerak emas, tahliliy qoralama tayyorlang):

TEKNIK TALAB MATNI:
${text.substring(0, 500000)}
`;

        const researchParts: any[] = [{ text: researchPrompt }];
        if (fileExt === 'pdf') {
            researchParts.push({
                inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') }
            });
        }

        const researchData = {
            contents: [{ role: "user", parts: researchParts }],
            tools: [{ googleSearch: {} }], // Enable Internet Search
            generationConfig: {
                temperature: 0.0,
                maxOutputTokens: 8192
            }
        };

        const researchText = await callGeminiStream(researchData, true); // true = raw text
        console.log("[Step 1] Research Complete.");

        // ==============================================
        // STEP 2: REPORT GENERATION (Format to JSON)
        // ==============================================
        console.log("[Step 2] Formatting Report...");
        const formatPrompt = `
Siz yig'ilgan ma'lumotlarni qat'iy JSON formatga o'tkazadigan mutaxassissiz.
Quyida keltirilgan Qidiruv Natijalarini (Research Notes) o'qib, ularni faqatgina JSON formatda qaytaring. 
Agar qidiruv natijalarida biror joy kam bo'lsa, uni o'zingiz mantiqan to'ldiring. Hech qanday qo'shimcha matn yozmang.

Qidiruv Natijalari:
${researchText}

Kutilyotgan JSON FORMATI:
{
  "organizations": [
    {
      "name": "Full Organization Name",
      "stir": "9-digit TIN (DIQQAT: Aslo uydirmang! Agar aniq topilmasa qat'iyan null yozing. 12345678 kabi ketma-ket sonlar taqiqlanadi)",
      "product_name": "Specific product model or service name found",
      "activity_type": "Main activity",
      "email": "info@company.com",
      "phone": "+998...",
      "website": "https://www.company.com (YOKI agar haqiqiy sayti bo'lmasa null. orginfo.uz yozmang!)",
      "product_url": "https://www.company.com/products/item-link (YOKI null)",
      "price_source_url": "https://specific-price-page-link.com (YOKI null. orginfo.uz narx manbasi bo'la olmaydi!)",
      "country": "Davlat nomi",
      "address": "City, Country, Street",
      "match_percent": 85,
      "market_price": "15,000,000 UZS ($1,200)",
      "reasoning": "Izoh"
    }
  ],
  "requirements_summary": "Qisqacha mazmun"
}

Javob tili: ${targetLangName}
`;

        const formatData = {
            contents: [{ role: "user", parts: [{ text: formatPrompt }] }],
            generationConfig: {
                temperature: 0.0,
                maxOutputTokens: 8192,
                responseMimeType: "application/json"
            }
        };

        let reportJson = await callGeminiStream(formatData, false);
        if (Array.isArray(reportJson) && reportJson.length > 0) {
            reportJson = reportJson[0];
        }
        console.log("[Step 2] Formatting Complete.");

        // ==============================================
        // STEP 2.5: FETCH FULL LEGAL DETAILS FROM ORGINFO.UZ
        // ==============================================
        console.log("[Step 2.5] Fetching full details from orginfo.uz...");
        if (reportJson.organizations && Array.isArray(reportJson.organizations)) {
            await Promise.all(reportJson.organizations.map(async (org: any) => {
                if (org.country && (org.country.toLowerCase().includes("o'zbekiston") || org.country.toLowerCase().includes("uzbekistan"))) {
                    const details = await fetchOrgDetails(org.name);
                    if (details) {
                        if (details.stir) org.stir = details.stir;
                        if (details.address) org.address = details.address;
                        if (details.phone) org.phone = details.phone;
                        if (details.email) org.email = details.email;
                        console.log(`[OrgDetails] Updated for ${org.name}`);
                    }
                }
            }));
        }

        // ==============================================
        // STEP 3: FACT-CHECKING (Verify Prices and Links)
        // ==============================================
        console.log("[Step 3] Fact Checking...");
        
        let orgsList = "";
        if (reportJson.organizations && Array.isArray(reportJson.organizations)) {
            orgsList = reportJson.organizations.map((o: any) => `- Kompaniya: ${o.name} | Narx: ${o.market_price} | Veb-sayt/Manba: ${o.website || ''} ${o.price_source_url || ''}`).join('\n');
        }

        const factCheckPrompt = `
Siz qat'iy Fakt-Cheker va Auditor hisoblanasiz.
Quyida tashkilotlar ro'yxati (nomi, narxi, manbasi) berilgan.
Sizning vazifangiz internet qidiruvi orqali ushbu tashkilotlar, ularning saytlari va narxlari rost yoki soxta ekanligini TEKSHIRISH.

Faqatgina har bir kompaniya uchun tekshiruv natijasini qisqa JSON Array formatida qaytaring:
[
  {
    "name": "Kompaniya nomi (ro'yxatdagidek)",
    "fact_check_status": "Verified (agar rost bo'lsa) YOKI Suspicious (agar yolg'on/xato bo'lsa)",
    "fact_check_reason": "Qisqa izoh"
  }
]

DIQQAT: Hech qanday qo'shimcha gap yozmang, faqat aniq JSON Array qaytaring!

Tashkilotlar ro'yxati:
${orgsList}
`;

        const factCheckData = {
            contents: [{ role: "user", parts: [{ text: factCheckPrompt }] }],
            tools: [{ googleSearch: {} }], // Enable Internet Search for Fact Checking
            generationConfig: {
                temperature: 0.0,
                maxOutputTokens: 2048
            }
        };

        let finalJson = reportJson;
        try {
            let factChecks = await callGeminiStream(factCheckData, false);
            if (factChecks && typeof factChecks === 'object' && !Array.isArray(factChecks) && factChecks.fact_checks) {
                factChecks = factChecks.fact_checks;
            }
            
            if (Array.isArray(factChecks)) {
                for (const org of finalJson.organizations) {
                    const check = factChecks.find((c: any) => c.name && c.name.includes(org.name) || org.name.includes(c.name));
                    if (check) {
                        org.fact_check_status = check.fact_check_status;
                        org.fact_check_reason = check.fact_check_reason;
                    } else {
                        org.fact_check_status = "Unverified";
                        org.fact_check_reason = "Tekshirishni imkoni bo'lmadi.";
                    }
                }
            }
        } catch(e) {
            console.error("Fact check extraction failed, skipping...", e);
            // Agar fakt-cheking yiqilsa, hech bo'lmasa tayyor reportJson ni yuboramiz.
        }
        
        console.log("[Step 3] Fact Checking Complete.");

        // Check blacklist on final verified data
        if (finalJson.organizations) {
            for (const org of finalJson.organizations) {
                org.is_blacklisted = false;
                org.blacklist_reason = null;
                
                const orQuery: any = [];
                if (org.stir) orQuery.push({ stir: org.stir });
                if (org.name) orQuery.push({ name: { contains: org.name, mode: 'insensitive' } });

                if (orQuery.length > 0) {
                    const blacklisted = await prisma.blacklist.findFirst({
                        where: { OR: orQuery }
                    });
                    if (blacklisted) {
                        org.is_blacklisted = true;
                        org.blacklist_reason = blacklisted.reason;
                    }
                }
            }
        }

        const session = await getSession();
        const airport = session.airport || 'TAS';

        let auditorName = '777';
        if (session.userId) {
            const user = await prisma.user.findUnique({ where: { id: session.userId } });
            if (user) {
                auditorName = user.role === 'super_admin' ? '777' : user.username;
            }
        }

        const newReq = await prisma.request.create({
            data: {
                file_name: file.name,
                file_type: fileExt,
                analysis_type: 'marketing',
                airport: airport,
                auditor_name: auditorName,
                language: lang,
                full_analysis: finalJson
            }
        });

        return NextResponse.json({ ...finalJson, success: true, request_id: newReq.id, auditor_name: auditorName });

    } catch (err: any) {
        console.error("Marketing API error:", err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
