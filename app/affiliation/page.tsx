'use client';
import React, { useState, useEffect } from 'react';
import Navbar from '@/components/Layout/Navbar';
import Footer from '@/components/Layout/Footer';
import LoaderWrapper from '@/components/UI/LoaderWrapper';
import { getTranslation } from '@/lib/translations';
import { UploadCloud, Network, Link as LinkIcon, Building2, Calculator, AlertTriangle, XOctagon, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export default function Affiliation() {
    const searchParams = useSearchParams();
    const lang = searchParams.get('lang') || 'uz';

    const [files, setFiles] = useState<File[]>([]);
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
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);
            const valid = selectedFiles.every(f => {
                const ext = f.name.split('.').pop()?.toLowerCase();
                return ext === 'pdf' || ext === 'docx' || ext === 'doc';
            });
            
            if (!valid) {
                setError(getTranslation(lang, 'error_format'));
                return;
            }
            if (selectedFiles.length < 2) {
                setError("Kamida 2 ta fayl yuklashingiz kerak.");
                return;
            }
            setFiles(selectedFiles);
            setError(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files) {
            const selectedFiles = Array.from(e.dataTransfer.files);
            
            const valid = selectedFiles.every(f => {
                const ext = f.name.split('.').pop()?.toLowerCase();
                return ext === 'pdf' || ext === 'docx' || ext === 'doc';
            });
            
            if (!valid) {
                setError(getTranslation(lang, 'error_format'));
                return;
            }
            if (selectedFiles.length < 2) {
                setError("Kamida 2 ta fayl yuklashingiz kerak.");
                return;
            }
            setFiles(selectedFiles);
            setError(null);
        }
    };

    const startAnalysis = async () => {
        if (files.length < 2) return;

        setIsLoading(true);
        setError(null);
        setStatusText(getTranslation(lang, 'aff_status_extracting'));

        try {
            const formData = new FormData();
            files.forEach(f => formData.append('files', f));
            formData.append('lang', lang);

            setTimeout(() => setStatusText(getTranslation(lang, 'aff_status_searching')), 2000);
            setTimeout(() => setStatusText(getTranslation(lang, 'aff_status_linking')), 8000);

            const response = await fetch('/api/analyze-affiliation', {
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
                    <h1 style={{ fontSize: '3rem', marginBottom: '1rem', fontWeight: 700 }}>{getTranslation(lang, 'aff_hero_title')}</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '800px', margin: '0 auto' }}>{getTranslation(lang, 'aff_hero_subtitle')}</p>
                </div>

                {!resultData && (
                    <section className="upload-container" id="drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
                        <input type="file" id="files" accept=".pdf,.docx,.doc" multiple style={{ display: 'none' }} onChange={handleFileChange} />
                        {files.length === 0 ? (
                            <div className="upload-box" onClick={() => document.getElementById('files')?.click()} style={{ cursor: 'pointer' }}>
                                <Network className="upload-icon" size={64} color="var(--error)" />
                                <h3>{getTranslation(lang, 'aff_upload_title')}</h3>
                                <p>{getTranslation(lang, 'upload_hint')}</p>
                                <button className="btn btn-primary" style={{ background: 'var(--error)' }}>{getTranslation(lang, 'btn_upload')}</button>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center' }}>
                                <div className="file-card">
                                    <Network size={24} color="var(--error)" />
                                    <span style={{ fontWeight: 600 }}>{files.length} ta fayl tanlandi</span>
                                    <button className="btn btn-icon" onClick={() => setFiles([])}><AlertTriangle size={18} /></button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                                    {files.map((f, i) => <span key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>{f.name}</span>)}
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                    <button onClick={() => document.getElementById('files')?.click()} className="btn btn-secondary">{getTranslation(lang, 'btn_replace')}</button>
                                    <button onClick={startAnalysis} className="btn" style={{ background: 'var(--error)', border: 'none', color: 'white', padding: '1rem 2.5rem', borderRadius: '1rem', fontWeight: 600 }}>{getTranslation(lang, 'aff_btn_analyze')}</button>
                                </div>
                            </div>
                        )}
                        {error && <div style={{ color: 'var(--error)', marginTop: '2rem', textAlign: 'center', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '1rem', border: '1px solid rgba(239, 68, 68, 0.3)' }}><AlertTriangle size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }} /> {error}</div>}
                    </section>
                )}

                <div id="results" className={!resultData ? 'hidden' : ''}>
                    {resultData && <AffiliationResults data={resultData} lang={lang} />}
                </div>
            </div>
            
            <Footer />
        </>
    );
}

function AffiliationResults({ data, lang }: { data: any, lang: string }) {
    const { links, companies, collusion_status, summary, price_analysis } = data;
    
    let stColor = 'var(--success)'; 
    let stIcon = <ShieldCheck color={stColor} size={32} />; 
    let stText = "Xavf yo'q";
    
    if (collusion_status === 'suspected_collusion') {
        stColor = 'var(--warning)'; 
        stIcon = <AlertTriangle color={stColor} size={32} />; 
        stText = "Shubhali (Katta ehtimol bilan til biriktirilgan)";
    } else if (collusion_status === 'direct_affiliation') {
        stColor = 'var(--error)'; 
        stIcon = <XOctagon color={stColor} size={32} />; 
        stText = "To'g'ridan-to'g'ri Affiliatsiya (Tasdiqlandi)";
    }

    const getEvidenceIcon = (type: string) => {
        if(type === 'legal') return <AlertTriangle color="var(--error)" size={24} style={{ minWidth: 24 }} />;
        if(type === 'digital') return <Network color="var(--warning)" size={24} style={{ minWidth: 24 }} />;
        return <LinkIcon size={24} style={{ minWidth: 24 }} />;
    };

    return (
        <div className="analysis-grid">
            <div className="analysis-card" style={{ gridColumn: '1 / -1', background: 'rgba(0,0,0,0.2)', borderLeft: `5px solid ${stColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
                    {stIcon}
                    <h2 style={{ fontSize: '1.6rem', color: stColor, margin: 0 }}>{stText}</h2>
                </div>
                <p style={{ fontSize: '1.15rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>{summary || 'Xulosa mavjud emas.'}</p>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                <Building2 color="var(--primary)" /> <h3 style={{ margin: 0 }}>Ishtirokchilar korxonalari</h3>
            </div>

            {companies?.map((comp: any, idx: number) => (
                <div key={idx} className="analysis-card" style={{ padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>STIR: {comp.stir || '---'}</div>
                    <h4 style={{ margin: '0.5rem 0' }}>{comp.name}</h4>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Fayl: {comp.file}</div>
                    <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}><strong>Ta'sischi:</strong> {comp.founders?.join(', ') || ''}</div>
                </div>
            ))}

            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2rem' }}>
                <Network color="var(--primary)" /> <h3 style={{ margin: 0 }}>Yashirin Bog'liqliklar (Dalillar)</h3>
            </div>

            {(!links || links.length === 0) ? (
                <div className="analysis-card success" style={{ gridColumn: '1 / -1' }}>Hech qanday shubhali bog'liqlik topilmadi.</div>
            ) : (
                links.map((link: any, idx: number) => (
                    <div key={`link-${idx}`} className="analysis-card" style={{ gridColumn: '1 / -1', borderLeft: `4px solid ${link.severity === 'high' ? 'var(--error)' : 'var(--warning)'}` }}>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                            {getEvidenceIcon(link.evidence_type)}
                            <div>
                                <strong style={{ fontSize: '1.1rem' }}>{link.reason}</strong>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>Isbot turi: {link.evidence_type}</div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
                                    {link.involved_companies.map((cId: string, i: number) => {
                                        const cName = companies.find((c: any) => c.id === cId)?.name || cId;
                                        return (
                                            <React.Fragment key={cId}>
                                                <span style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem' }}>{cName}</span>
                                                {i < link.involved_companies.length - 1 && <LinkIcon size={12} style={{ opacity: 0.3 }} />}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            )}

            {price_analysis && price_analysis.length > 0 && (
                <div style={{ gridColumn: '1 / -1', marginTop: '3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <Calculator color="var(--primary)" /> <h3 style={{ margin: 0 }}>Narxlar Taxlili (Sun'iy kartel tekshiruvi)</h3>
                    </div>
                    <div style={{ overflowX: 'auto', background: 'var(--card-bg)', border: '1px solid var(--glass-border)', borderRadius: '1rem', padding: '1rem' }}>
                        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '600px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                                    <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Mahsulot/Xizmat nomi</th>
                                    <th style={{ padding: '1rem', color: 'var(--info)' }}>Chamalangan Bozor Narxi</th>
                                    <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Ishtirokchilar takliflari (Farqlar)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {price_analysis.map((p: any, idx: number) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '1rem', fontWeight: 600 }}>{p.item_name}</td>
                                        <td style={{ padding: '1rem', color: 'var(--info)', fontWeight: 700 }}>{p.market_price}</td>
                                        <td style={{ padding: '1rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {p.quotes?.map((q: any, qIdx: number) => (
                                                    <div key={qIdx} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{q.company}</span>
                                                        <strong style={{ color: 'var(--warning)' }}>{q.price}</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
