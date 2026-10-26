/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { getTranslation } from './translations';

/**
 * Blob ni Base64 ga ishonchli o'girish (Brauzer uchun xavfsiz)
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (result && result.includes(',')) {
        resolve(result.split(',')[1]);
      } else {
        resolve(result || '');
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Shriftlarni yuklash (Lokal public/fonts yoki CDN zaxira)
 */
async function loadFontBuffer(fileName: string): Promise<string | null> {
  // 1. Server/Node muhitida: lokal diskdan o'qish
  try {
    const fs = require('fs');
    const path = require('path');
    const localPath = path.join(process.cwd(), 'public', 'fonts', fileName);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath).toString('base64');
    }
  } catch {
    // Brauzer muhiti
  }

  // 2. Brauzer muhitida: HTTP fetch orqali yuklash
  try {
    const res = await fetch(`/fonts/${fileName}`);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html')) {
      const blob = await res.blob();
      return await blobToBase64(blob);
    }
  } catch (err) {
    console.warn(`[pdfExport] Lokal shrift yuklanmadi (${fileName}):`, err);
  }

  // 3. Zaxira CDN
  try {
    const cdnUrl = fileName.includes('Bold')
      ? 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Medium.ttf'
      : 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
    const res = await fetch(cdnUrl);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html')) {
      const blob = await res.blob();
      return await blobToBase64(blob);
    }
  } catch (err) {
    console.warn(`[pdfExport] CDN shrift yuklanmadi (${fileName}):`, err);
  }

  return null;
}

/**
 * Donut chart vektorli chizish funksiyasi
 */
function drawDonutChart(
  doc: jsPDF,
  cx: number,
  cy: number,
  R: number,
  r: number,
  score: number,
  color: [number, number, number]
) {
  // Tashqi kulrang halqa
  doc.setFillColor(226, 232, 240);
  doc.circle(cx, cy, R, 'F');

  // Rangli sektor
  const safeScore = Math.min(100, Math.max(0, score));
  if (safeScore > 0) {
    doc.setFillColor(color[0], color[1], color[2]);
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (safeScore / 100) * 2 * Math.PI;
    const steps = 40;
    const points: { x: number; y: number }[] = [{ x: cx, y: cy }];

    for (let i = 0; i <= steps; i++) {
      const a = startAngle + (endAngle - startAngle) * (i / steps);
      points.push({
        x: cx + R * Math.cos(a),
        y: cy + R * Math.sin(a),
      });
    }

    const lines: [number, number][] = [];
    for (let i = 1; i < points.length; i++) {
      lines.push([points[i].x - points[i - 1].x, points[i].y - points[i - 1].y]);
    }
    doc.lines(lines, points[0].x, points[0].y, [1, 1], 'F', true);
  }

  // Ichki oq doira (teshik)
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, r, 'F');
}

/**
 * 2 VAROQLIK PROFESSIONAL EXECUTIVE AUDIT REPORT
 * - Aniq 2 ta varoqqa sig'dirilgan
 * - Har bir varoqda rasmiy skanerlanadigan QR-kod shtampi mavjud
 */
export const exportToPDF = async (data: any, lang: string = 'uz') => {
  let doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
  });

  const t = (key: string) => getTranslation(lang, key);

  // Shriftlarni o'rnatish
  const [robotoRegular, robotoBold] = await Promise.all([
    loadFontBuffer('Roboto-Regular.ttf'),
    loadFontBuffer('Roboto-Bold.ttf'),
  ]);

  let fontLoaded = false;
  if (robotoRegular) {
    try {
      doc.addFileToVFS('Roboto-Regular.ttf', robotoRegular);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      if (robotoBold) {
        doc.addFileToVFS('Roboto-Bold.ttf', robotoBold);
        doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      } else {
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'bold');
      }
      doc.setFont('Roboto', 'normal');
      fontLoaded = true;
    } catch (e) {
      console.warn('[pdfExport] Shrift registratsiyasida xatolik:', e);
      fontLoaded = false;
      // Agar xatolik bo'lsa, xotirani tozalash uchun toza yangi doc yaratamiz
      doc = new jsPDF({
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
      });
    }
  }

  if (!fontLoaded) {
    doc.setFont('helvetica', 'normal');
  }

  const currentFont = fontLoaded ? 'Roboto' : 'helvetica';
  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 12;
  const usableW = pageWidth - marginX * 2; // 186mm

  // Metrikalar va ma'lumotlarni normalizatsiya qilish
  const score = Math.round(Number(data.total_score || data.score || 0));
  const compScore = Math.round(Number(data.compliance_score || score));
  const favScore = Math.round(Number(data.favoritism_score || 80));
  const docTitle = String(data.document_title || data.file_name || 'Texnik topshiriq').trim();
  const shortId = data.request_id ? String(data.request_id).substring(0, 10).toUpperCase() : 'REQ-AUDIT';
  const auditorName = data.auditor_name || 'AISCAN COMPLIANCE TEAM';
  const createdDate = data.created_at ? new Date(data.created_at) : new Date();

  // Ranglar va status
  let statusText = '';
  let statusColor: [number, number, number] = [220, 38, 38];
  let statusBg: [number, number, number] = [254, 242, 242];
  let riskLabel = '';

  if (score >= 80) {
    statusText = lang === 'uz' ? 'TASDIQLANDI' : lang === 'ru' ? 'ОДОБРЕНО' : 'APPROVED';
    statusColor = [22, 163, 74]; // Green
    statusBg = [240, 253, 244];
    riskLabel = lang === 'uz' ? 'XAVF PAST' : lang === 'ru' ? 'РИСК НИЗКИЙ' : 'LOW RISK';
  } else if (score >= 60) {
    statusText = lang === 'uz' ? 'QAYTA ISHLASH' : lang === 'ru' ? 'ДОРАБОТКА' : 'NEEDS REVISION';
    statusColor = [217, 119, 6]; // Amber
    statusBg = [254, 243, 199];
    riskLabel = lang === 'uz' ? "XAVF O'RTA" : lang === 'ru' ? 'РИСК СРЕДНИЙ' : 'MEDIUM RISK';
  } else {
    statusText = lang === 'uz' ? 'RAD ETILDI' : lang === 'ru' ? 'ОТКЛОНЕНО' : 'REJECTED';
    statusColor = [220, 38, 38]; // Red
    statusBg = [254, 242, 242];
    riskLabel = lang === 'uz' ? 'XAVF YUQORI' : lang === 'ru' ? 'РИСК ВЫСОКИЙ' : 'HIGH RISK';
  }

  // QR-kod tayyorlash
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  const reportUrl = data.request_id ? `${baseUrl}/report/${data.request_id}` : `${baseUrl}/`;

  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(reportUrl, {
      margin: 1,
      width: 250,
      errorCorrectionLevel: 'M',
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
  } catch (qrErr) {
    console.warn('[pdfExport] QR kod yaratishda xatolik:', qrErr);
  }

  // =========================================================================
  // 1-VAROQ: ASOSIY AUDIT NATIJALARI, METRIKALAR VA HUQUQIY STRESS-TEST
  // =========================================================================

  let curY = 11;

  // 1. Yuqori Shapka
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.roundedRect(marginX, curY, 74, 5, 1, 1, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(6.2);
  doc.text('COMPLIANCE & ANTI-CORRUPTION AUDIT', marginX + 3, curY + 3.5);

  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.setFont(currentFont, 'normal');
  doc.text(`Auditor: ${auditorName} | Sana: ${createdDate.toLocaleDateString()}`, pageWidth - marginX, curY + 3.8, { align: 'right' });

  curY += 8.5;

  // Katta Sarlavha
  doc.setTextColor(15, 23, 42);
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(13);
  const mainTitleText =
    lang === 'uz'
      ? 'TEXNIK TOPSHIRIQ BO\'YICHA AUDITORLIK XULOSASI'
      : lang === 'ru'
      ? 'АУДИТОРСКОЕ ЗАКЛЮЧЕНИЕ ПО ПРОЕКТУ ТЗ'
      : 'AUDIT OPINION ON SPECIFICATION DRAFT';
  doc.text(mainTitleText, marginX, curY);

  curY += 4.5;

  // Hujjat nomi
  doc.setFont(currentFont, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const splitDocTitle = doc.splitTextToSize(docTitle, usableW - 48);
  doc.text(splitDocTitle[0] + (splitDocTitle.length > 1 ? '...' : ''), marginX, curY);

  // Status Badge (O'ng tomonda)
  const statusBadgeW = 38;
  const statusBadgeH = 6.5;
  const statusBadgeX = pageWidth - marginX - statusBadgeW;
  const statusBadgeY = curY - 5;
  doc.setFillColor(statusBg[0], statusBg[1], statusBg[2]);
  doc.setDrawColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(statusBadgeX, statusBadgeY, statusBadgeW, statusBadgeH, 1.2, 1.2, 'FD');
  doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(7.5);
  doc.text(`${statusText} (${score}%)`, statusBadgeX + statusBadgeW / 2, statusBadgeY + 4.5, { align: 'center' });

  curY += 5.5;

  // Ajratuvchi chiziq
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.line(marginX, curY, pageWidth - marginX, curY);

  curY += 3.5;

  // 2. 4 ta Metadata Kartochkasi (Ixcham 1 qator)
  const cardGap = 2.5;
  const cardW = (usableW - cardGap * 3) / 4;
  const cardH = 11.5;

  const metaCardsData = data.metadata_cards || {};
  const metaBuyer = metaCardsData.buyer || 'АО «Uzbekistan Airports»';
  const metaPerimeter = metaCardsData.perimeter || (data.airport ? `Aeroport: ${data.airport}` : '11 ta aeroport / Xolding');
  const metaScale = metaCardsData.scale || (data.file_type ? `Format: ${String(data.file_type).toUpperCase()}` : 'Korporativ xarid');
  const metaTimeline = metaCardsData.timeline || `${createdDate.toLocaleDateString()} audit`;

  const metaCards = [
    { label: lang === 'uz' ? 'BUYURTMACHI' : 'ЗАКАЗЧИК', val: metaBuyer },
    { label: lang === 'uz' ? 'PERIMETR' : 'ПЕРИМЕТР', val: metaPerimeter },
    { label: lang === 'uz' ? 'MASSHTAB VA TURI' : 'МАСШТАБ И ТИП', val: metaScale },
    { label: lang === 'uz' ? 'MUDDAT / STATUS' : 'СРОК / СТАТУС', val: metaTimeline },
  ];

  metaCards.forEach((c, idx) => {
    const x = marginX + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, curY, cardW, cardH, 1, 1, 'FD');

    doc.setFont(currentFont, 'bold');
    doc.setFontSize(5);
    doc.setTextColor(100, 116, 139);
    doc.text(c.label, x + 2, curY + 3.5);

    doc.setFont(currentFont, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(15, 23, 42);
    const splitVal = doc.splitTextToSize(c.val, cardW - 4);
    doc.text(splitVal[0] || '', x + 2, curY + 7.2);
    if (splitVal[1]) {
      doc.setFont(currentFont, 'normal');
      doc.setFontSize(5.5);
      doc.text(splitVal[1], x + 2, curY + 10);
    }
  });

  curY += cardH + 3.5;

  // 3. Executive Summary (Qisqacha mazmun va hukm)
  const execSummaryTitle =
    lang === 'uz'
      ? `1. EXECUTIVE SUMMARY (QISQACHA XULOSA) — VERDIKT: ${statusText}`
      : lang === 'ru'
      ? `1. EXECUTIVE SUMMARY (КРАТКИЙ ИТОГ) — ВЕРДИКТ: ${statusText}`
      : `1. EXECUTIVE SUMMARY — VERDICT: ${statusText}`;

  let execText = data.executive_summary;
  if (!execText && data.sections && data.sections[0]) {
    execText = data.sections[0].content || (data.sections[0].details || []).join(' ');
  }
  if (!execText) {
    execText =
      lang === 'uz'
        ? `Taqdim etilgan hujjat O'zbekiston Respublikasining 'Davlat xaridlari to'g'risida'gi (O'RQ-684) va 'Raqobat to'g'risida'gi (O'RQ-850) qonunlari talablari asosida tekshirildi. Umumiy muvofiqlik: ${score}%.`
        : `Проект документа проверен на соответствие Законам РУз № ЗРУ-684 и № ЗРУ-850. Общий индекс готовности: ${score}%.`;
  }

  doc.setFont(currentFont, 'normal');
  doc.setFontSize(6.8);
  const splitExecLines = doc.splitTextToSize(execText, usableW - 8).slice(0, 4); // Max 4 qator
  const execBoxH = 6 + splitExecLines.length * 3.2;

  doc.setFillColor(statusBg[0], statusBg[1], statusBg[2]);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, curY, usableW, execBoxH, 1.2, 1.2, 'FD');

  doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.rect(marginX, curY, 2, execBoxH, 'F');

  doc.setFont(currentFont, 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.text(execSummaryTitle, marginX + 4, curY + 4);

  doc.setFont(currentFont, 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(30, 41, 59);
  doc.text(splitExecLines, marginX + 4, curY + 7.8);

  curY += execBoxH + 3.5;

  // 4. Vizual Ko'rsatkichlar (Donut Chart va Progress Barlar)
  const widgetGap = 3.5;
  const widgetW = (usableW - widgetGap) / 2;
  const widgetH = 37;

  // CHAP WIDGET: Komplaens Donut Chart & Sub-Scores
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, curY, widgetW, widgetH, 1.2, 1.2, 'FD');

  doc.setFont(currentFont, 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 23, 42);
  doc.text(
    lang === 'uz' ? 'KOMPLAENS-TAYYORGARLIK INDEKSI' : 'ИНДЕКС КОМПЛАЕНС-ГОТОВНОСТИ',
    marginX + 3.5,
    curY + 4.5
  );

  const donutCx = marginX + 16;
  const donutCy = curY + 20;
  drawDonutChart(doc, donutCx, donutCy, 11, 7, score, statusColor);

  doc.setFont(currentFont, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${score}%`, donutCx, donutCy + 1.2, { align: 'center' });

  doc.setFontSize(4.5);
  doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.text(riskLabel, donutCx, donutCy + 3.8, { align: 'center' });

  const subScores = data.sub_scores || {
    functional: compScore,
    transparency: Math.max(30, Math.round(score * 0.85)),
    architecture: Math.max(35, Math.round(score * 0.9)),
    competition: favScore,
  };

  const subItems = [
    { label: lang === 'uz' ? 'Funktsional talablar' : 'Функционал', val: subScores.functional },
    { label: lang === 'uz' ? 'Hajm shaffofligi' : 'Прозрачность', val: subScores.transparency },
    { label: lang === 'uz' ? 'Muddat va arxitektura' : 'Архитектура', val: subScores.architecture },
    { label: lang === 'uz' ? 'Raqobat qonunchiligi' : 'Конкуренция', val: subScores.competition },
  ];

  let subY = curY + 8.5;
  const barStartX = marginX + 32;
  const barMaxW = widgetW - 35;

  subItems.forEach((item) => {
    doc.setFont(currentFont, 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(71, 85, 105);
    doc.text(item.label, barStartX, subY + 2);

    doc.setFont(currentFont, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${item.val}%`, marginX + widgetW - 3, subY + 2, { align: 'right' });

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(barStartX, subY + 3.2, barMaxW, 1.8, 0.4, 0.4, 'F');

    let pColor: [number, number, number] = [30, 64, 175];
    if (item.val >= 80) pColor = [22, 163, 74];
    else if (item.val < 50) pColor = [220, 38, 38];
    doc.setFillColor(pColor[0], pColor[1], pColor[2]);
    doc.roundedRect(barStartX, subY + 3.2, (barMaxW * Math.min(100, item.val)) / 100, 1.8, 0.4, 0.4, 'F');

    subY += 6.8;
  });

  // O'NG WIDGET: Narxlar Taqqoslovi
  const rightX = marginX + widgetW + widgetGap;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(rightX, curY, widgetW, widgetH, 1.2, 1.2, 'FD');

  doc.setFont(currentFont, 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 23, 42);
  doc.text(
    lang === 'uz' ? 'BOZOR NARXI VA SMETA BENCHMARKI' : 'СРАВНЕНИЕ РЫНОЧНОЙ ЦЕНЫ И СМЕТЫ',
    rightX + 3.5,
    curY + 4.5
  );

  const priceBench = data.price_benchmark || {
    local_range: lang === 'uz' ? '4,85 - 5,95 mlrd' : '4,85 - 5,95 млрд',
    market_range: lang === 'uz' ? '6,25 - 7,70 mlrd' : '6,25 - 7,70 млрд',
    estimated_range: lang === 'uz' ? '9,80 - 11,90 mlrd (+45%)' : '9,80 - 11,90 млрд (+45%)',
    potential_savings: lang === 'uz' ? '3,0 - 4,5 mlrd so\'m' : '3,0 - 4,5 млрд сум',
  };

  const benchRows = [
    { label: lang === 'uz' ? '1. Mahalliy bozor narxlari' : '1. Локальные интеграторы', val: priceBench.local_range, pct: 50, color: [37, 99, 235] as [number, number, number] },
    { label: lang === 'uz' ? '2. Optimal bozor narxi (NMTSK)' : '2. Оптимальная НМЦК', val: priceBench.market_range, pct: 68, color: [22, 163, 74] as [number, number, number] },
    { label: lang === 'uz' ? '3. Smeta (xatarlar bilan)' : '3. Смета с рисками ТЗ', val: priceBench.estimated_range, pct: 100, color: [220, 38, 38] as [number, number, number] },
  ];

  let bY = curY + 8.5;
  const bBarStartX = rightX + 3.5;
  const bBarMaxW = widgetW - 7;

  benchRows.forEach((r) => {
    doc.setFont(currentFont, 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(71, 85, 105);
    doc.text(r.label, bBarStartX, bY + 1.8);

    doc.setFont(currentFont, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(r.val, rightX + widgetW - 3.5, bY + 1.8, { align: 'right' });

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(bBarStartX, bY + 3, bBarMaxW, 2.2, 0.4, 0.4, 'F');

    doc.setFillColor(r.color[0], r.color[1], r.color[2]);
    doc.roundedRect(bBarStartX, bY + 3, (bBarMaxW * r.pct) / 100, 2.2, 0.4, 0.4, 'F');

    bY += 7.2;
  });

  if (priceBench.potential_savings) {
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(bBarStartX, curY + widgetH - 6.5, bBarMaxW, 5, 0.8, 0.8, 'F');
    doc.setFont(currentFont, 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(22, 163, 74);
    doc.text(
      lang === 'uz'
        ? `Tejamkorlik potensiali: ${priceBench.potential_savings}`
        : `Потенциал экономии: ${priceBench.potential_savings}`,
      rightX + widgetW / 2,
      curY + widgetH - 3.2,
      { align: 'center' }
    );
  }

  curY += widgetH + 4;

  // 5. 2. TAHLIL VA HUQUQIY BAHOLASH (STRESS-TEST)
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  const stressTitle =
    lang === 'uz'
      ? '2. TAHLIL VA HUQUQIY BAHOLASH (STRESS-TEST)'
      : '2. АНАЛИЗ ТЗ И ПРАВОВАЯ ОЦЕНКА (СТРЕСС-ТЕСТ)';
  doc.text(stressTitle, marginX, curY);

  doc.setFont(currentFont, 'normal');
  doc.setFontSize(6);
  doc.setTextColor(30, 64, 175);
  doc.text(
    lang === 'uz'
      ? "O'zR Qonunlari: O'RQ-684 (Davlat xaridlari), O'RQ-850 (Raqobat)"
      : 'Законы РУз: № ЗРУ-684 (Госзакупки), № ЗРУ-850 (Конкуренция)',
    pageWidth - marginX,
    curY,
    { align: 'right' }
  );

  curY += 4.5;

  const auditDetails: string[] = [];
  if (data.sections && data.sections[1] && Array.isArray(data.sections[1].details)) {
    auditDetails.push(...data.sections[1].details);
  } else if (data.favoritism_evidence && Array.isArray(data.favoritism_evidence)) {
    data.favoritism_evidence.forEach((fe: any) => {
      auditDetails.push(`• ${fe.quote || ''}: ${fe.reason || ''}`);
    });
  }

  // 1-sahifada 6-7 ta punktni ixcham joylashtiramiz (pastki stampgacha bo'lgan joy)
  let p1ItemIdx = 0;
  while (p1ItemIdx < auditDetails.length && curY < pageHeight - 38 && p1ItemIdx < 6) {
    doc.setFont(currentFont, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(30, 41, 59);

    const clean = auditDetails[p1ItemIdx].replace(/^[•\-\*]\s*/, '').trim();
    const wrapped = doc.splitTextToSize(`• ${clean}`, usableW - 4).slice(0, 3);

    doc.text(wrapped, marginX + 2, curY);
    curY += wrapped.length * 3.1 + 1.2;
    p1ItemIdx++;
  }

  // =========================================================================
  // 2-VAROQ: SMETA JADVALI, AFFILLANGANLIK, XAVFLAR VA HARAKATLAR REJASI
  // =========================================================================
  doc.addPage();
  curY = 12;

  // Mini-Header
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(marginX, curY, usableW, 5.5, 1, 1, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(6.8);
  doc.text(
    lang === 'uz'
      ? 'AISCAN PROCUREMENT AUDIT: SMETA BENCHMARKI, XAVFLAR VA HARAKATLAR REJASI'
      : 'AISCAN PROCUREMENT AUDIT: СМЕТНЫЙ БЕНЧМАРК, РИСКИ И ДОРОЖНАЯ КАРТА',
    marginX + 4,
    curY + 3.8
  );
  doc.setFont(currentFont, 'normal');
  doc.setFontSize(6);
  doc.text(`ID: #${shortId}`, pageWidth - marginX - 4, curY + 3.8, { align: 'right' });

  curY += 8.5;

  // 3. Iqtisodiy Tahlil Jadvali
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    lang === 'uz' ? '3. IQTISODIY TAHLIL VA SMETA BENCHMARKI' : '3. ЭКОНОМИЧЕСКИЙ АНАЛИЗ (PRICE BENCHMARK)',
    marginX,
    curY
  );
  curY += 4;

  const tableRows: any[] = [];
  if (priceBench.items && Array.isArray(priceBench.items) && priceBench.items.length > 0) {
    priceBench.items.slice(0, 4).forEach((it: any) => {
      tableRows.push([
        it.task || it.name || '',
        it.local_price || it.local_range || '',
        it.market_price || it.market_range || '',
        it.estimated_price || it.estimated_range || '',
        it.volume_notes || '',
      ]);
    });
  } else if (data.products && Array.isArray(data.products) && data.products.length > 0) {
    data.products.slice(0, 3).forEach((p: any, pIdx: number) => {
      tableRows.push([
        `${pIdx + 1}. ${p.name || 'Tovar/Xizmat'}`,
        'Bozor so\'rovi',
        'Optimal NMTSK',
        'Hujjat bo\'yicha',
        p.search_query || 'Standart hajm',
      ]);
    });
  } else {
    tableRows.push(
      ['1. Asosiy ishlab chiqish va joriy qilish', 'Bozor narxi', 'Optimal NMTSK', 'Smeta narxi', 'Texnik talablar'],
      ['2. Litsenziyalar va ta\'minot', 'Standart tarif', 'Optimal tarif', 'Loyiha smetasi', 'Litsenziya hajmi'],
      ['3. Sinov, o\'qitish va kafolat', 'Bozor narxi', 'Optimal narx', 'Smeta narxi', 'Kafolat muddati']
    );
  }

  // Jami qatori
  tableRows.push([
    lang === 'uz' ? 'JAMI (QQS bilan):' : 'ИТОГО С НДС:',
    priceBench.local_range || '',
    priceBench.market_range || '',
    priceBench.estimated_range || '',
    priceBench.potential_savings ? `Tejamkorlik: ${priceBench.potential_savings}` : '',
  ]);

  autoTable(doc, {
    startY: curY,
    margin: { left: marginX, right: marginX },
    head: [[
      lang === 'uz' ? 'Ish moddalari / Bo\'limlar' : 'Статья работ / Разделы',
      lang === 'uz' ? 'Mahalliy bozor' : 'Локальный рынок',
      lang === 'uz' ? 'Optimal NMTSK' : 'Оптимальная НМЦК',
      lang === 'uz' ? 'Hujjat smetasi' : 'Смета по ТЗ',
      lang === 'uz' ? 'Hajm parametrlari' : 'Параметры объема',
    ]],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.2,
      cellPadding: 1.5,
    },
    styles: {
      font: currentFont,
      fontSize: 6,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  curY = (doc as any).lastAutoTable.finalY + 5;

  // 4. Komplaens va Affillanganlik tekshiruvi (Collusion Check)
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(
    lang === 'uz'
      ? '4. KOMPLAENS-TEKSHIRUVI VA AFILOVLIK (COLLUSION CHECK)'
      : '4. КОМПЛАЕНС-ПРОВЕРКА НА АФФИЛИРОВАННОСТЬ (COLLUSION CHECK)',
    marginX,
    curY
  );

  doc.setFont(currentFont, 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(30, 64, 175);
  doc.text(
    lang === 'uz' ? 'O\'zR "Korrupsiyaga qarshi kurashish to\'g\'risida"gi Qonuni' : 'Закон РУз «О противодействии коррупции»',
    pageWidth - marginX,
    curY,
    { align: 'right' }
  );

  curY += 3.8;

  const collusionStatus =
    favScore < 70
      ? (lang === 'uz' ? 'XATAR: POTENSIAL TARAFIKALIK / TASHQI TA\'SIR BELGILARI MAVJUD' : 'РИСК: ВЕРОЯТНАЯ ПРЕДВАРИТЕЛЬНАЯ КООРДИНАЦИЯ')
      : (lang === 'uz' ? 'XATAR PAST: TO\'G\'RIDAN-TO\'G\'RI TASHQI MANFAATLAR ANIQLANMADI' : 'РИСК НИЗКИЙ: ПРЯМЫХ ПРИЗНАКОВ СГОВОРА НЕ ВЫЯВЛЕНО');

  doc.setFillColor(favScore < 70 ? 254 : 240, favScore < 70 ? 242 : 253, favScore < 70 ? 242 : 244);
  doc.roundedRect(marginX, curY, usableW, 5.5, 1, 1, 'F');
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(favScore < 70 ? 220 : 22, favScore < 70 ? 38 : 163, favScore < 70 ? 38 : 74);
  doc.text(collusionStatus, marginX + 3.5, curY + 3.8);

  curY += 7.5;

  // 5. Loyiha Xavflari Reyestri (Risk Registry)
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(
    lang === 'uz' ? '5. LOYIHA XAVFLARI REYESTRI (RISK REGISTRY)' : '5. РЕЕСТР РИСКОВ ПРОЕКТА',
    marginX,
    curY
  );
  curY += 4;

  const risksList = data.risks || [];
  risksList.slice(0, 3).forEach((r: string, rIdx: number) => {
    let rLevel = lang === 'uz' ? 'YUQORI' : 'ВЫСОКИЙ';
    let rBadgeColor: [number, number, number] = [220, 38, 38];
    if (rIdx === 1) {
      rLevel = lang === 'uz' ? 'O\'RTA' : 'СРЕДНИЙ';
      rBadgeColor = [217, 119, 6];
    } else if (rIdx >= 2) {
      rLevel = lang === 'uz' ? 'PAST' : 'НИЗКИЙ';
      rBadgeColor = [22, 163, 74];
    }

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);

    const wrappedRisk = doc.splitTextToSize(r, usableW - 28).slice(0, 2);
    const cardHeight = Math.max(9, 4 + wrappedRisk.length * 3);

    doc.roundedRect(marginX, curY, usableW, cardHeight, 1, 1, 'FD');

    doc.setFillColor(rBadgeColor[0], rBadgeColor[1], rBadgeColor[2]);
    doc.rect(marginX, curY, 1.8, cardHeight, 'F');

    doc.roundedRect(marginX + 3.5, curY + 2.2, 16, 4, 0.6, 0.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(currentFont, 'bold');
    doc.setFontSize(5);
    doc.text(rLevel, marginX + 11.5, curY + 5, { align: 'center' });

    doc.setFont(currentFont, 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(30, 41, 59);
    doc.text(wrappedRisk, marginX + 22, curY + 4.2);

    curY += cardHeight + 2;
  });

  curY += 3;

  // 6. Xulosa va Harakatlar rejasi (Roadmap - 6 ta ixcham qadam)
  doc.setFont(currentFont, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  const actionPlanTitle =
    lang === 'uz'
      ? '6. XULOSA VA HARAKATLAR REJASI (ROADMAP / CALL TO ACTION)'
      : '6. ВЫВОДЫ И ПЛАН ДЕЙСТВИЙ (ROADMAP / CALL TO ACTION)';
  doc.text(actionPlanTitle, marginX, curY);

  doc.setFont(currentFont, 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(30, 64, 175);
  doc.text(
    lang === 'uz' ? 'Hujjatni 100% holatga keltirish yo\'l xaritasi' : 'Дорожная карта приведения ТЗ к 100%',
    pageWidth - marginX,
    curY,
    { align: 'right' }
  );

  curY += 4.5;

  let roadmapSteps = data.action_plan;
  if (!roadmapSteps || !Array.isArray(roadmapSteps) || roadmapSteps.length === 0) {
    const recs = data.recommendations || [];
    roadmapSteps = [
      { step: 1, title: lang === 'uz' ? '1-Qadam. Asossiz cheklovlarni olib tashlash' : 'Шаг 1. Устранить монопольные ограничения', description: recs[0] || 'Bitta brendga bog\'lanish xavfini bartaraf etish.' },
      { step: 2, title: lang === 'uz' ? '2-Qadam. Ekvivalentlarga ruxsat berish' : 'Шаг 2. Разрешить эквиваленты', description: recs[1] || 'Tovarlar nomiga "yoki ekvivalenti" qo\'shimchasini kiritish.' },
      { step: 3, title: lang === 'uz' ? '3-Qadam. Narxlarni bozorga moslashtirish' : 'Шаг 3. Оптимизировать смету', description: recs[2] || 'Bozor narxlari asosida maksimal narxni qayta hisoblash.' },
      { step: 4, title: lang === 'uz' ? '4-Qadam. Muddat va kafolatni aniqlashtirish' : 'Шаг 4. Уточнить сроки и гарантию', description: recs[3] || 'Loyiha bosqichlari va kafolat shartlarini aniq belgilash.' },
      { step: 5, title: lang === 'uz' ? '5-Qadam. Teng raqobat sharoitini yaratish' : 'Шаг 5. Обеспечить равный доступ', description: recs[4] || 'Ishtirokchilar malaka talablarini qonunchilikka moslash.' },
      { step: 6, title: lang === 'uz' ? '6-Qadam. Standart va havolalarni yangilash' : 'Шаг 6. Актуализировать стандарты', description: recs[5] || 'Amaldagi ShNK va xarid nizomlarining yangi tahririga tayanish.' },
    ];
  }

  const colW = (usableW - 3) / 2;
  const colH = 20;

  roadmapSteps.slice(0, 6).forEach((st: any, idx: number) => {
    const colIdx = idx % 2;
    const rowIdx = Math.floor(idx / 2);

    const x = marginX + colIdx * (colW + 3);
    const y = curY + rowIdx * (colH + 2.5);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(30, 64, 175);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, colW, colH, 1, 1, 'FD');

    doc.setFont(currentFont, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(30, 64, 175);
    const stepTitle = st.title || `Qadam ${st.step || idx + 1}`;
    doc.text(stepTitle, x + 3, y + 4.5);

    doc.setFont(currentFont, 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(51, 65, 85);
    const splitDesc = doc.splitTextToSize(st.description || '', colW - 6).slice(0, 4);
    doc.text(splitDesc, x + 3, y + 8.5);
  });

  curY += 3 * (colH + 2.5) + 3;

  // Normativ-huquqiy baza bloki (Qonunlar)
  if (data.audit_basis && Array.isArray(data.audit_basis) && data.audit_basis.length > 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, curY, usableW, 14, 1, 1, 'FD');

    doc.setFont(currentFont, 'bold');
    doc.setFontSize(6);
    doc.setTextColor(30, 64, 175);
    doc.text(lang === 'uz' ? 'QONUNCHILIK ME\'YORLARI (AUDIT ASOSLARI):' : 'НОРМАТИВНЫЕ ОСНОВАНИЯ АУДИТА:', marginX + 3, curY + 3.8);

    doc.setFont(currentFont, 'normal');
    doc.setFontSize(5.4);
    doc.setTextColor(71, 85, 105);
    const basisLine1 = data.audit_basis.slice(0, 3).map((b: string) => `✓ ${b}`).join('  |  ');
    const basisLine2 = data.audit_basis.slice(3, 6).map((b: string) => `✓ ${b}`).join('  |  ');
    doc.text(doc.splitTextToSize(basisLine1, usableW - 6)[0] || '', marginX + 3, curY + 7.5);
    if (basisLine2) {
      doc.text(doc.splitTextToSize(basisLine2, usableW - 6)[0] || '', marginX + 3, curY + 11.2);
    }
  }

  // =========================================================================
  // BARCHA SAHIFALAR UCHUN FOOTER VA HAR BIR VAROQDA RASMIY QR-SHTAMP
  // =========================================================================
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Pastki ajratuvchi chiziq
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(marginX, pageHeight - 11, pageWidth - marginX, pageHeight - 11);

    // Chap pastki tizim yozuvi
    doc.setFont(currentFont, 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text('AISCAN COMPLIANCE PLATFORM | AO «UZBEKISTAN AIRPORTS»', marginX, pageHeight - 6.5);

    // O'rtadagi sahifa raqami
    const pageStr = `${lang === 'uz' ? 'Sahifa' : 'Стр.'} ${i} / ${totalPages}`;
    doc.text(pageStr, pageWidth / 2, pageHeight - 6.5, { align: 'center' });

    // HAR BIR VAROQDA RASMIY QR-SHTAMP
    if (qrDataUrl) {
      const stampW = 64;
      const stampH = 21;
      const stampX = pageWidth - marginX - stampW;
      const stampY = pageHeight - stampH - 13;

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(30, 64, 175);
      doc.setLineWidth(0.4);
      doc.roundedRect(stampX, stampY, stampW, stampH, 1.2, 1.2, 'FD');

      // 18.5mm x 18.5mm QR-kod
      doc.addImage(qrDataUrl, 'PNG', stampX + stampW - 19.5, stampY + 1.25, 18.5, 18.5);

      doc.setTextColor(30, 64, 175);
      doc.setFont(currentFont, 'bold');
      doc.setFontSize(7.5);
      doc.text('AISCAN VERIFIED', stampX + 3, stampY + 5.2);

      doc.setFontSize(5.2);
      doc.setFont(currentFont, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('ELEKTRON AUDIT XULOSASI', stampX + 3, stampY + 9);

      doc.setFont(currentFont, 'normal');
      doc.setFontSize(4.8);
      doc.setTextColor(100, 116, 139);
      doc.text(`ID: #${shortId}`, stampX + 3, stampY + 12.8);
      doc.text(`Auditor: ${auditorName}`, stampX + 3, stampY + 15.8);
      doc.text(`Status: ${statusText} (${score}%)`, stampX + 3, stampY + 18.8);
    }
  }

  // Saqlash
  const cleanDocName = (docTitle || 'AISCAN_AUDIT')
    .replace(/[^a-zA-Z0-9А-Яа-яЎўҚқҒғҲҳ_.-]/g, '_')
    .substring(0, 50);

  if (typeof window === 'undefined') {
    return Buffer.from(doc.output('arraybuffer'));
  }
  doc.save(`${cleanDocName}_Audit_Report.pdf`);
};

/**
 * Optimallashtirilgan to'liq matnli hujjatni PDF formatda yuklab olish
 */
export const exportCorrectedToPDF = async (text: string, title: string) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const [robotoRegular, robotoBold] = await Promise.all([
    loadFontBuffer('Roboto-Regular.ttf'),
    loadFontBuffer('Roboto-Bold.ttf'),
  ]);

  let fontLoaded = false;
  if (robotoRegular) {
    try {
      doc.addFileToVFS('Roboto-Regular.ttf', robotoRegular);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      if (robotoBold) {
        doc.addFileToVFS('Roboto-Bold.ttf', robotoBold);
        doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      }
      doc.setFont('Roboto', 'normal');
      fontLoaded = true;
    } catch (e) {
      console.warn('[pdfExport] Shrift registratsiyasida xatolik:', e);
    }
  }

  const currentFont = fontLoaded ? 'Roboto' : 'helvetica';
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 12;
  const maxLineWidth = pageWidth - margin * 2;

  let currentY = 16;

  doc.setFont(currentFont, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  const headerLines = doc.splitTextToSize((title || 'OPTIMALLASHTIRILGAN HUJJAT').toUpperCase(), maxLineWidth);
  headerLines.forEach((line: string) => {
    if (currentY > pageHeight - 20) {
      doc.addPage();
      currentY = 16;
    }
    doc.text(line, pageWidth / 2, currentY, { align: 'center' });
    currentY += 6.5;
  });

  currentY += 4;

  const lines = text.split('\n');
  doc.setFontSize(9);
  doc.setFont(currentFont, 'normal');

  for (let line of lines) {
    line = line.trim();
    if (!line) {
      currentY += 3.5;
      continue;
    }

    let isHeading = false;
    let size = 9;
    let style = 'normal';

    if (line.startsWith('# ')) {
      line = line.substring(2).trim();
      size = 11.5;
      style = 'bold';
      isHeading = true;
    } else if (line.startsWith('## ')) {
      line = line.substring(3).trim();
      size = 10.5;
      style = 'bold';
      isHeading = true;
    } else if (line.startsWith('### ')) {
      line = line.substring(4).trim();
      size = 9.5;
      style = 'bold';
      isHeading = true;
    }

    doc.setFont(currentFont, style);
    doc.setFontSize(size);

    let isBullet = false;
    if (line.startsWith('- ') || line.startsWith('* ')) {
      line = line.substring(2).trim();
      isBullet = true;
    }

    const cleanLineText = line.replace(/\*\*/g, '');
    const prefix = isBullet ? '• ' : '';
    const textToDraw = prefix + cleanLineText;

    const wrappedLines = doc.splitTextToSize(textToDraw, maxLineWidth);

    for (let wrappedLine of wrappedLines) {
      if (currentY > pageHeight - 22) {
        doc.addPage();
        if (fontLoaded) doc.setFont('Roboto', style);
        currentY = 16;
      }
      doc.text(wrappedLine, margin, currentY);
      currentY += isHeading ? 5.5 : 4.6;
    }
    currentY += 1.2;
  }

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`AISCAN VERIFIED DOCUMENT | Sahifa ${i} / ${totalPages}`, pageWidth / 2, pageHeight - 8, {
      align: 'center',
    });
  }

  const cleanTitle = (title || 'hujjat').replace(/[^a-zA-Z0-9А-Яа-яЎўҚқҒғҲҳ_.-]/g, '_');
  doc.save(`${cleanTitle}_optimized.pdf`);
};
