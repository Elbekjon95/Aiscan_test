'use client';

import React, { useState, useEffect } from 'react';
import { getTranslation } from '@/lib/translations';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Plus, Trash2, Globe, ShieldCheck, Upload, Loader2 } from 'lucide-react';

export default function DocsManagement() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const lang = searchParams.get('lang') || 'uz';
    
    const [docs, setDocs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    const [newDoc, setNewDoc] = useState({
        title: '',
        file: null as File | null
    });

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const res = await fetch('/api/auth/me');
                const data = await res.json();
                if (!data.isLoggedIn || (data.role !== 'admin' && data.role !== 'super_admin')) {
                    window.location.href = `/admin/login?lang=${lang}`;
                } else {
                    fetchDocs();
                }
            } catch (err) {
                window.location.href = `/admin/login?lang=${lang}`;
            }
        };
        checkAuth();
    }, [lang]);

    const fetchDocs = async () => {
        try {
            const res = await fetch('/api/admin/docs');
            const data = await res.json();
            if (data.success) {
                setDocs(data.docs);
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError('Hujjatlarni yuklashda xatolik.');
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDoc.file || !newDoc.title) {
            setError('Iltimos, fayl va sarlavhani kiriting.');
            return;
        }

        setError('');
        setSuccess('');
        setIsUploading(true);

        try {
            const formData = new FormData();
            formData.append('file', newDoc.file);
            formData.append('title', newDoc.title);

            const res = await fetch('/api/admin/docs', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Hujjat muvaffaqiyatli yuklandi va tahlil qilindi.');
                setNewDoc({ title: '', file: null });
                fetchDocs();
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError('Server bilan bog\'lanishda xatolik.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Ushbu hujjatni o\'chirishga ishonchingiz komilmi?')) return;
        try {
            const res = await fetch('/api/admin/docs', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Hujjat o\'chirildi.');
                fetchDocs();
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError('Xatolik yuz berdi.');
        }
    };

    if (loading) return <div style={{ textAlign: 'center', padding: '5rem' }}>Yuklanmoqda...</div>;

    return (
        <div className="admin-container" style={{ padding: '2rem 5%', maxWidth: '1400px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
            <h1 style={{ fontWeight: 800, letterSpacing: '-1px', marginBottom: '1rem' }}>{getTranslation(lang, 'nav_docs')}</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: '3rem', maxWidth: '800px' }}>
                Ushbu bo'limda tahlil jarayonida "Ichki nizomlar" sifatida foydalaniladigan hujjatlarni boshqaring. 
                Siz yuklagan hujjatlar AI tahlil jarayonida me'yoriy asos bo'lib xizmat qiladi.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(350px, 1fr) 2.5fr', gap: '2.5rem', alignItems: 'start' }}>
                {/* Form to Add Doc */}
                <div className="admin-card">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2rem' }}>
                        <Plus size={22} className="color-primary" /> Yangi Nizom Qo'shish
                    </h3>
                    <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div className="input-group">
                            <label className="form-label">Nizom Nomi (Sarlavha)</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                value={newDoc.title}
                                onChange={e => setNewDoc({ ...newDoc, title: e.target.value })}
                                placeholder="Masalan: Ichki xaridlar nizomi"
                                required 
                            />
                        </div>
                        <div className="input-group">
                            <label className="form-label">Fayl (PDF, DOCX yoki DOC)</label>
                            <input 
                                type="file" 
                                className="input-field" 
                                onChange={e => setNewDoc({ ...newDoc, file: e.target.files ? e.target.files[0] : null })}
                                accept=".pdf,.docx,.doc"
                                required 
                                style={{ padding: '0.6rem' }}
                            />
                        </div>
                        
                        {(error || success) && (
                            <p style={{ color: error ? 'var(--error)' : 'var(--success)', fontSize: '0.85rem', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem', textAlign: 'center' }}>
                                {error || success}
                            </p>
                        )}

                        <button type="submit" className="btn btn-primary btn-glow" disabled={isUploading} style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '1.2rem' }}>
                            {isUploading ? <><Loader2 className="animate-spin" size={20} /> Yuklanmoqda...</> : <><Upload size={20} /> Yuklash</>}
                        </button>
                    </form>
                </div>

                {/* Docs List */}
                <div className="admin-card">
                    <div style={{ overflowX: 'auto' }}>
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Hujjat nomi</th>
                                    <th style={{ textAlign: 'center' }}>Qamrov</th>
                                    <th style={{ textAlign: 'center' }}>Turi</th>
                                    <th style={{ textAlign: 'center' }}>Sana</th>
                                    <th style={{ textAlign: 'center' }}>Amallar</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                                <FileText size={48} style={{ opacity: 0.2 }} />
                                                Hozircha hujjatlar mavjud emas.
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    docs.map(doc => (
                                        <tr key={doc._id}>
                                            <td style={{ fontWeight: 600 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <FileText size={18} className="color-primary" />
                                                    {doc.title}
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {doc.is_global ? (
                                                    <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <Globe size={14} /> GLOBAL
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <ShieldCheck size={14} /> {doc.airport}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)' }}>
                                                    {doc.file_type?.toUpperCase()}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                {new Date(doc.created_at).toLocaleDateString()}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                    <button onClick={() => handleDelete(doc._id)} className="action-btn delete" title="O'chirish">
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
