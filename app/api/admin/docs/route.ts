import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { callGeminiStream } from '@/lib/gemini';
import { extractTextFromDoc } from '@/lib/docExtract';

const mammoth = require('mammoth');

export async function GET() {
    try {
        const session = await getSession();
        if (!session.isLoggedIn || (session.role !== 'super_admin' && session.role !== 'admin')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        
        let where = {};
        if (session.role === 'admin') {
            where = {
                OR: [
                    { is_global: true },
                    { airport: session.airport }
                ]
            };
        }

        const docs = await prisma.internalDoc.findMany({
            where,
            orderBy: { created_at: 'desc' }
        });
        
        return NextResponse.json({ success: true, docs });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session.isLoggedIn || (session.role !== 'super_admin' && session.role !== 'admin')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const title = formData.get('title') as string;

        if (!file || !title) {
            return NextResponse.json({ success: false, error: 'Fayl va nomi talab qilinadi.' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const fileExt = file.name.split('.').pop()?.toLowerCase();
        
        // Extract Text
        let content = '';
        if (fileExt === 'pdf') {
            const base64Data = buffer.toString('base64');
            const dataForGemini = {
                contents: [{
                    role: "user",
                    parts: [
                        { text: "Extract all text from this document and return it in the following JSON format: {\"extracted_text\": \"...\"}" },
                        { inlineData: { mimeType: 'application/pdf', data: base64Data } }
                    ]
                }],
                generationConfig: { responseMimeType: "application/json" }
            };
            const extractedJson = await callGeminiStream(dataForGemini);
            content = extractedJson.extracted_text || '';
        } else if (fileExt === 'docx') {
            const result = await mammoth.extractRawText({ buffer });
            content = result.value;
        } else if (fileExt === 'doc') {
            const docResult = await extractTextFromDoc(buffer);
            content = docResult.text;
        } else {
            return NextResponse.json({ success: false, error: 'Faqat PDF, DOCX va DOC.' }, { status: 400 });
        }
        
        const isGlobal = session.role === 'super_admin';
        const airport = session.role === 'super_admin' ? 'ALL' : session.airport;

        const newDoc = await prisma.internalDoc.create({
            data: {
                title,
                content,
                file_type: fileExt,
                airport,
                is_global: isGlobal
            }
        });

        return NextResponse.json({ success: true, doc: newDoc });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session.isLoggedIn || (session.role !== 'super_admin' && session.role !== 'admin')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await req.json();
        
        const doc = await prisma.internalDoc.findUnique({ where: { id } });
        if (!doc) return NextResponse.json({ success: false, error: 'Topilmadi.' });

        // Admin can only delete their own docs
        if (session.role === 'admin' && doc.airport !== session.airport) {
            return NextResponse.json({ success: false, error: 'Access denied' });
        }

        await prisma.internalDoc.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

