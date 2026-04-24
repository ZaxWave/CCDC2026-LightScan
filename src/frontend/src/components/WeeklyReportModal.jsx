import { useState } from 'react';
import { generateWeeklyReport } from '../api/client';
import s from './WeeklyReportModal.module.css';

const IconReport = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);
const IconDownload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconSpark = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

export default function WeeklyReportModal({ onClose }) {
  const [status, setStatus]   = useState('idle');   // idle | loading | done | error
  const [report, setReport]   = useState(null);
  const [errMsg, setErrMsg]   = useState('');
  const username = localStorage.getItem('username') || '操作员';

  const handleGenerate = async () => {
    setStatus('loading');
    setErrMsg('');
    try {
      const data = await generateWeeklyReport();
      setReport(data);
      setStatus('done');
    } catch (e) {
      setErrMsg(e.message || '生成失败，请检查 DeepSeek API Key 配置');
      setStatus('error');
    }
  };

  // 浏览器 Print → PDF（原生中文字体，无依赖）
  const handlePrint = () => {
    if (!report) return;

    // ── 病害类型 SVG 饼图 ────────────────────────────────────
    const PIE_COLORS = { '坑槽': '#FF4444', '龟裂': '#FF1493', '横向裂缝': '#FF8800', '纵向裂缝': '#FFCC00' };
    const EXTRA_C    = ['#3E6AE1', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4'];
    const typeEntries = Object.entries(report.stats.by_type);
    const typeTotals  = typeEntries.reduce((s, [, v]) => s + v, 0);
    const typeColors  = typeEntries.map(([k], i) => PIE_COLORS[k] || EXTRA_C[i % EXTRA_C.length]);

    let piePaths = '';
    let legendHtml = '';
    const CX = 80, CY = 80, R = 65;
    let ang = -Math.PI / 2;
    typeEntries.forEach(([label, value], i) => {
      const a = typeTotals > 0 ? (value / typeTotals) * 2 * Math.PI : 0;
      if (a > 0) {
        const x1 = (CX + R * Math.cos(ang)).toFixed(1);
        const y1 = (CY + R * Math.sin(ang)).toFixed(1);
        ang += a;
        const x2 = (CX + R * Math.cos(ang)).toFixed(1);
        const y2 = (CY + R * Math.sin(ang)).toFixed(1);
        piePaths += `<path d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${a > Math.PI ? 1 : 0},1 ${x2},${y2} Z" fill="${typeColors[i]}" stroke="white" stroke-width="2"/>`;
      }
      const pct = typeTotals > 0 ? Math.round(value / typeTotals * 100) : 0;
      legendHtml += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="width:10px;height:10px;background:${typeColors[i]};border-radius:2px;flex-shrink:0"></span>
        <span style="font-size:11px;color:#333">${label}：<b>${value}</b> 处（${pct}%）</span>
      </div>`;
    });
    if (!piePaths) {
      piePaths = `<text x="${CX}" y="${CY + 5}" text-anchor="middle" font-size="11" fill="#aaa">无数据</text>`;
    }

    // ── 严重程度水平条形图 ────────────────────────────────────
    const sevData = [
      { label: '高危（坑槽类）', value: report.stats.severity['高'], color: '#FF4444' },
      { label: '中危（裂缝扩展）', value: report.stats.severity['中'], color: '#FF8800' },
      { label: '低危（轻微裂缝）', value: report.stats.severity['低'], color: '#FFCC00' },
    ];
    const sevMax = Math.max(...sevData.map(d => d.value), 1);
    const sevBars = sevData.map(({ label, value, color }) => {
      const w = Math.max(Math.round((value / sevMax) * 180), value > 0 ? 6 : 0);
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:3px">
          <span>${label}</span><span style="font-weight:600;color:${color}">${value}</span>
        </div>
        <div style="background:#f0f0f0;border-radius:2px;height:10px">
          <div style="width:${w}px;max-width:100%;height:10px;background:${color};border-radius:2px"></div>
        </div>
      </div>`;
    }).join('');

    // ── 重点病害位置表格 ─────────────────────────────────────
    const locs = report.top_locations || [];
    const locRows = locs.length > 0
      ? locs.map((loc, i) => `
        <tr>
          <td style="text-align:center;color:#999">${i + 1}</td>
          <td><span style="background:${PIE_COLORS[loc.label_cn] || '#3E6AE1'};color:white;padding:1px 8px;border-radius:2px;font-size:10px;font-weight:600">${loc.label_cn}</span></td>
          <td style="font-family:monospace;font-size:11px">${loc.lat?.toFixed(5) ?? '--'}, ${loc.lng?.toFixed(5) ?? '--'}</td>
          <td style="text-align:center;color:${(loc.confidence || 0) >= 0.8 ? '#d93025' : '#555'}">${loc.confidence != null ? (loc.confidence * 100).toFixed(0) + '%' : '--'}</td>
          <td style="color:#777;font-size:11px">${loc.timestamp ?? '--'}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px">本周暂无高置信度病害记录</td></tr>`;

    // ── 类型明细表 ────────────────────────────────────────────
    const typeDetailRows = typeEntries.length > 0
      ? typeEntries.map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right;font-weight:700;color:#3E6AE1">${v}</td></tr>`).join('')
      : `<tr><td colspan="2" style="color:#aaa">本周无检出记录</td></tr>`;

    const docNo = `LS-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}-W${String(Math.ceil(new Date().getDate()/7)).padStart(2,'0')}`;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>LightScan 道路巡检周报 ${report.week_range}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif;
       color: #1a1a1a; padding: 44px 52px; font-size: 13px; line-height: 1.75;
       max-width: 860px; margin: 0 auto; }

/* 红头 */
.redhead { background: #D93025; color: white; margin: -44px -52px 0; padding: 14px 52px;
           font-size: 11px; letter-spacing: 0.1em; display:flex; justify-content:space-between; align-items:center; }
.redhead-brand { font-size: 14px; font-weight: 700; letter-spacing: 0.15em; }

/* 文件头 */
.doc-header { border-bottom: 3px double #3E6AE1; padding: 20px 0 16px; margin-bottom: 20px; }
.doc-title { font-size: 22px; font-weight: 700; text-align: center; color: #1a1a1a; margin-bottom: 10px; letter-spacing: 0.05em; }
.doc-meta { display: flex; justify-content: space-between; font-size: 11px; color: #777; }
.doc-no { font-size: 11px; color: #999; text-align:center; margin-bottom:6px; letter-spacing:0.08em; }

/* 统计网格 */
.stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 20px; }
.stat-box { border: 1px solid #e0e0e0; border-top: 3px solid #3E6AE1; padding: 10px 14px; }
.stat-num { font-size: 26px; font-weight: 700; color: #3E6AE1; line-height: 1; margin-bottom: 4px; }
.stat-label { font-size: 10px; color: #999; letter-spacing: 0.06em; }

/* 分节标签 */
.sec { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
       color: #3E6AE1; margin-bottom: 10px; padding-left: 9px;
       border-left: 3px solid #3E6AE1; }

/* 图表行 */
.chart-row { display: grid; grid-template-columns: 240px 1fr; gap: 20px; margin-bottom: 20px; }
.chart-box { border: 1px solid #ebebeb; border-radius: 4px; padding: 14px 16px; }
.pie-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; }

/* 表格 */
table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
thead th { background: #f5f7ff; padding: 7px 10px; text-align: left; font-weight: 600;
           color: #555; border-bottom: 2px solid #3E6AE1; font-size: 11px; }
td { padding: 7px 10px; border-bottom: 1px solid #f2f2f2; vertical-align: middle; }
tr:last-child td { border-bottom: none; }

/* 报告正文 */
.report-body { white-space: pre-wrap; font-size: 12.5px; line-height: 2; color: #2a2a2a;
               border: 1px solid #e4e8f7; border-left: 4px solid #3E6AE1;
               padding: 20px 24px; background: #fafbff; margin-bottom: 20px; }

/* 页脚 */
.footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e0e0e0;
          font-size: 10px; color: #bbb; display: flex; justify-content: space-between; }

/* 签署区 */
.sign-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 24px; }
.sign-box { border-top: 1px solid #ccc; padding-top: 6px; font-size: 11px; color: #888; text-align:center; }

@media print {
  body { padding: 28px 36px; }
  .redhead { margin: -28px -36px 0; padding: 10px 36px; }
  .no-print { display: none !important; }
  .chart-row { break-inside: avoid; }
  .report-body { break-inside: avoid; }
}
</style>
</head>
<body>

<div class="redhead">
  <span class="redhead-brand">LIGHTSCAN 轻巡智维</span>
  <span>道路巡检智能管理平台</span>
</div>

<div style="height:20px"></div>

<div class="doc-no">文件编号：${docNo}</div>
<div class="doc-header">
  <div class="doc-title">道路巡检智能周报</div>
  <div class="doc-meta">
    <span>报告周期：${report.week_range}</span>
    <span>操作员：${report.operator}</span>
    <span>生成时间：${report.generated_at}</span>
  </div>
</div>

<!-- 核心指标 -->
<div class="stats-grid">
  <div class="stat-box">
    <div class="stat-num">${report.stats.total}</div>
    <div class="stat-label">本周检出病害</div>
  </div>
  <div class="stat-box">
    <div class="stat-num" style="color:#D93025">${report.stats.severity['高']}</div>
    <div class="stat-label">高危病害（坑槽）</div>
  </div>
  <div class="stat-box">
    <div class="stat-num">${report.stats.confidence.high}</div>
    <div class="stat-label">高置信检出（≥80%）</div>
  </div>
  <div class="stat-box">
    <div class="stat-num" style="color:#f59e0b">${report.stats.confidence.low}</div>
    <div class="stat-label">待人工复核（&lt;60%）</div>
  </div>
</div>

<!-- 图表行：饼图 + 严重度条形 -->
<div class="chart-row">
  <div class="chart-box">
    <div class="sec">类型分布</div>
    <div class="pie-wrap">
      <svg width="160" height="160" viewBox="0 0 160 160">
        ${piePaths}
      </svg>
      <div style="width:100%">${legendHtml || '<span style="font-size:11px;color:#aaa">无数据</span>'}</div>
    </div>
  </div>
  <div class="chart-box">
    <div class="sec">严重程度分布</div>
    <div style="padding-top:6px">${sevBars}</div>
    <div style="margin-top:14px">
      <div class="sec" style="margin-bottom:8px">类型明细</div>
      <table style="margin:0">
        <thead><tr><th>病害类型</th><th style="text-align:right">检出数</th></tr></thead>
        <tbody>${typeDetailRows}</tbody>
      </table>
    </div>
  </div>
</div>

<!-- 重点病害位置 -->
<div class="sec">本周重点病害位置（置信度 Top 5）</div>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th>病害类型</th>
      <th>GPS 坐标（纬度, 经度）</th>
      <th style="width:70px">置信度</th>
      <th>检出时间</th>
    </tr>
  </thead>
  <tbody>${locRows}</tbody>
</table>

<!-- AI 报告正文 -->
<div class="sec">智能分析报告（由 DeepSeek AI 生成）</div>
<div class="report-body">${report.report_text}</div>

<!-- 签署区 -->
<div class="sign-row">
  <div class="sign-box">制表人：${report.operator}</div>
  <div class="sign-box">审核人：</div>
  <div class="sign-box">日期：${report.generated_at.split(' ')[0]}</div>
</div>

<div class="footer">
  <span>由 LightScan 智能巡检系统自动生成 · 本报告仅供内部参考</span>
  <span>第19届中国大学生计算机设计大赛 · CCDC 2026</span>
</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=920,height=760');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>

        {/* ── 顶栏 ── */}
        <div className={s.header}>
          <div className={s.headerLeft}>
            <span className={s.headerIcon}><IconReport /></span>
            <div>
              <div className={s.headerTitle}>智能巡检周报</div>
              <div className={s.headerSub}>基于本周检测数据，由 DeepSeek AI 生成专业报告</div>
            </div>
          </div>
          <button className={s.closeBtn} onClick={onClose}><IconClose /></button>
        </div>

        {/* ── 内容区 ── */}
        <div className={s.body}>

          {/* 初始态 */}
          {status === 'idle' && (
            <div className={s.idleArea}>
              <div className={s.idleIcon}>
                <IconReport />
              </div>
              <div className={s.idleTitle}>生成本周巡检周报</div>
              <div className={s.idleSub}>
                系统将统计你本周（周一至今）的检测数据，<br />
                调用 DeepSeek AI 生成包含病害分析、风险预警、<br />
                养护建议等内容的专业报告。
              </div>
              <button className={s.generateBtn} onClick={handleGenerate}>
                <IconSpark /> 立即生成
              </button>
            </div>
          )}

          {/* 生成中 */}
          {status === 'loading' && (
            <div className={s.loadingArea}>
              <div className={s.spinner} />
              <div className={s.loadingTitle}>正在生成中...</div>
              <div className={s.loadingSteps}>
                <div className={s.step}>✓ 统计本周检测数据</div>
                <div className={s.step}>✓ 构建分析上下文</div>
                <div className={`${s.step} ${s.stepActive}`}>⟳ 调用 DeepSeek AI 生成报告</div>
              </div>
            </div>
          )}

          {/* 错误态 */}
          {status === 'error' && (
            <div className={s.errorArea}>
              <div className={s.errorMsg}>{errMsg}</div>
              <button className={s.retryBtn} onClick={handleGenerate}>
                重新生成
              </button>
            </div>
          )}

          {/* 完成态 */}
          {status === 'done' && report && (
            <div className={s.reportArea}>
              {/* 统计摘要 */}
              <div className={s.statsRow}>
                {[
                  { label: '本周检出', value: report.stats.total },
                  { label: '高危病害', value: report.stats.severity['高'] },
                  { label: '高置信检出', value: report.stats.confidence.high },
                  { label: '待复核', value: report.stats.confidence.low },
                ].map(c => (
                  <div key={c.label} className={s.statCard}>
                    <div className={s.statNum}>{c.value}</div>
                    <div className={s.statLabel}>{c.label}</div>
                  </div>
                ))}
              </div>

              {/* 类型分布 */}
              {Object.keys(report.stats.by_type).length > 0 && (
                <div className={s.typeRow}>
                  {Object.entries(report.stats.by_type).map(([k, v]) => (
                    <span key={k} className={s.typeTag}>{k} <strong>{v}</strong></span>
                  ))}
                </div>
              )}

              {/* 报告元信息 */}
              <div className={s.reportMeta}>
                <span>周期：{report.week_range}</span>
                <span>操作员：{report.operator}</span>
                <span>生成于：{report.generated_at}</span>
              </div>

              {/* 报告正文 */}
              <div className={s.reportText}>
                {report.report_text}
              </div>

              {/* 操作栏 */}
              <div className={s.actions}>
                <button className={s.regenBtn} onClick={handleGenerate}>重新生成</button>
                <button className={s.downloadBtn} onClick={handlePrint}>
                  <IconDownload /> 下载 PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
