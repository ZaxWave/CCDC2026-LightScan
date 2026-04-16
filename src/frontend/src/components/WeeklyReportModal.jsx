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

  // 浏览器 Print → PDF（原生支持中文字体）
  const handlePrint = () => {
    if (!report) return;
    const typeRows = Object.entries(report.stats.by_type)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v} 处</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>LightScan 巡检周报 ${report.week_range}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
         color: #1a1a1a; padding: 48px 56px; font-size: 13px; line-height: 1.8; }
  .header { border-bottom: 2px solid #3E6AE1; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 6px; }
  .header .meta { font-size: 12px; color: #666; display: flex; gap: 24px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
  .stat-box { border: 1px solid #e0e0e0; border-top: 2px solid #3E6AE1; padding: 10px 14px; }
  .stat-num { font-size: 24px; font-weight: 700; color: #3E6AE1; line-height: 1; margin-bottom: 4px; }
  .stat-label { font-size: 10px; color: #999; letter-spacing: 0.06em; text-transform: uppercase; }
  .section-label { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
                   color: #999; margin-bottom: 8px; border-left: 3px solid #3E6AE1; padding-left: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
  th { background: #f5f5f5; padding: 8px 12px; text-align: left; font-weight: 600;
       border-bottom: 1px solid #e0e0e0; color: #555; }
  td { padding: 7px 12px; border-bottom: 1px solid #f0f0f0; color: #333; }
  .report-body { white-space: pre-wrap; font-size: 13px; line-height: 2; color: #2a2a2a;
                 border: 1px solid #e8e8e8; border-left: 3px solid #3E6AE1;
                 padding: 20px 24px; background: #fafafa; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0;
            font-size: 10px; color: #bbb; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 32px 40px; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>LightScan 道路巡检周报</h1>
  <div class="meta">
    <span>报告周期：${report.week_range}</span>
    <span>操作员：${report.operator}</span>
    <span>生成时间：${report.generated_at}</span>
  </div>
</div>

<div class="stats-grid">
  <div class="stat-box">
    <div class="stat-num">${report.stats.total}</div>
    <div class="stat-label">本周检出</div>
  </div>
  <div class="stat-box">
    <div class="stat-num">${report.stats.severity['高']}</div>
    <div class="stat-label">高危病害</div>
  </div>
  <div class="stat-box">
    <div class="stat-num">${report.stats.confidence.high}</div>
    <div class="stat-label">高置信检出</div>
  </div>
  <div class="stat-box">
    <div class="stat-num">${report.stats.confidence.low}</div>
    <div class="stat-label">待人工复核</div>
  </div>
</div>

<div class="section-label">病害类型明细</div>
<table>
  <thead><tr><th>病害类型</th><th>检出数量</th></tr></thead>
  <tbody>${typeRows || '<tr><td colspan="2" style="color:#999">本周无检出记录</td></tr>'}</tbody>
</table>

<div class="section-label">智能巡检报告（由 DeepSeek AI 生成）</div>
<div class="report-body">${report.report_text}</div>

<div class="footer">
  <span>由 LightScan 智能巡检系统自动生成</span>
  <span>第19届中国大学生计算机设计大赛 · CCDC 2026</span>
</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
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
