'use client';
import React, { useState, useEffect } from 'react';
import Navbar from '@/components/Layout/Navbar';
import Footer from '@/components/Layout/Footer';
import LoaderWrapper from '@/components/UI/LoaderWrapper';
import { getTranslation } from '@/lib/translations';
import { UploadCloud, CheckCircle, AlertTriangle, XOctagon, FileText, Search, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import AnalysisResults from '@/components/Analysis/AnalysisResults';

export default function Home() {
    const searchParams = useSearchParams();
    const lang = searchParams.get('lang') || 'uz';

    const [file, setFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [resultData, setResultData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const [me, setMe] = useState<any>(null);

    useEffect(() => {
        const fetchMe = async () => {
            try {
                const res = await fetch('/api/auth/me');
                const data = await res.json();
                if (data.isLoggedIn) {
                    setMe(data);
                } else {
                    window.location.href = `/admin/login?lang=${lang}`;
                }
            } catch (err) {
                window.location.href = `/admin/login?lang=${lang}`;
            }
        };
        fetchMe();
    }, [lang]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selected = e.target.files[0];
            const ext = selected.name.split('.').pop()?.toLowerCase();
            if (ext !== 'pdf' && ext !== 'docx' && ext !== 'doc') {
                setError(getTranslation(lang, 'error_format'));
                return;
            }
            setFile(selected);
            setError(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const selected = e.dataTransfer.files[0];
            const ext = selected.name.split('.').pop()?.toLowerCase();
            if (ext !== 'pdf' && ext !== 'docx' && ext !== 'doc') {
                setError(getTranslation(lang, 'error_format'));
                return;
            }
            setFile(selected);
            setError(null);
        }
    };

    const startAnalysis = async () => {
        if (!file) return;

        setIsLoading(true);
        setError(null);
        setStatusText(getTranslation(lang, 'status_reading'));

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('lang', lang);

            // Fetch bosqichi
            setTimeout(() => setStatusText(getTranslation(lang, 'status_analyzing')), 1500);
            setTimeout(() => setStatusText(getTranslation(lang, 'status_compliance')), 5000);
            setTimeout(() => setStatusText(getTranslation(lang, 'status_finalizing')), 8000);

            const response = await fetch('/api/analyze', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || getTranslation(lang, 'error_generic'));
            }

            setResultData(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
            setStatusText('');
        }
    };

    return (
        <>
            <Navbar isLoggedIn={!!me} role={me?.role} />
            <LoaderWrapper isLoading={isLoading} text={statusText} />
            
            <div className="container">
                <div className="hero" style={{ textAlign: 'center', marginBottom: '3rem' }}>
                    <h1 style={{ fontSize: '3rem', marginBottom: '1rem', fontWeight: 700 }}>{getTranslation(lang, 'hero_title')}</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '800px', margin: '0 auto' }}>{getTranslation(lang, 'hero_subtitle')}</p>
                </div>

                {!resultData && (
                    <section className="upload-container" id="drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
                        <input type="file" id="file" accept=".pdf,.docx,.doc" style={{ display: 'none' }} onChange={handleFileChange} />
                        {!file ? (
                            <div className="upload-box" onClick={() => document.getElementById('file')?.click()} style={{ cursor: 'pointer' }}>
                                <UploadCloud className="upload-icon" size={64} color="var(--primary)" />
                                <h3>{getTranslation(lang, 'upload_title')}</h3>
                                <p>{getTranslation(lang, 'upload_hint')}</p>
                                <button className="btn btn-primary">{getTranslation(lang, 'btn_analyze')}</button>
                            </div>
                        ) : (
                            <div id="file-info" style={{ display: 'block' }}>
                                <div className="file-card">
                                    <FileText size={24} />
                                    <span id="file-name">{file.name}</span>
                                    <button className="btn btn-icon" onClick={() => setFile(null)}><AlertTriangle size={18} /></button>
                                </div>
                                <button onClick={startAnalysis} className="btn btn-glow">{getTranslation(lang, 'btn_analyze')}</button>
                            </div>
                        )}
                        {error && <div style={{ color: 'var(--error)', marginTop: '2rem', textAlign: 'center', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '1rem', border: '1px solid rgba(239, 68, 68, 0.3)' }}><AlertTriangle size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }} /> {error}</div>}
                    </section>
                )}

                <div id="results" className={!resultData ? 'hidden' : ''}>
                    {resultData && <AnalysisResults data={resultData} lang={lang} file={file} />}
                </div>
            </div>
            <Footer />
        </>
    );
}
