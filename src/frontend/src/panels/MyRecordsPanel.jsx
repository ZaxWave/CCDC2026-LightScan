import { useState, useEffect, useMemo } from 'react';
import { getMyGisRecords, deleteRecord, getMyStats } from '../api/client';
import WeeklyReportModal from '../components/WeeklyReportModal';
import s from './MyRecordsPanel.module.css';

const LABELS = ['全部', '坑槽', '纵横裂缝', '网状裂缝', '横向裂缝'];

function confColor(v) {
  if (v >= 0.8) return '#3E6AE1';
  if (v >= 0.6) return '#1a8045';
  if (v >= 0.4) return '#d97706';
  return '#D93025';
}

function ConfBar({ value }) {
  const pct = value != null ? (value * 100).toFixed(1) : null;
  return (
    <div className={s.confWrap}>
      <div className={s.confTrack}>
        <div className={s.confFill} style={{ width: `${pct ?? 0}%`, background: confColor(value ?? 0) }} />
      </div>
      <span className={s.confNum} style={{ color: confColor(value ?? 0) }}>
        {pct != null ? `${pct}%` : '--'}
      </span>
    </div>
  );
}

// ── 导出工具函数 ──────────────────────────────────────────────
function exportCSV(rows) {
  const headers = ['ID', '病害类型', '标签代码', '置信度(%)', '纬度', '经度', '检测时间', '来源文件'];
  const body = rows.map(r => [
    r.id,
    r.label_cn || '',
    r.label || '',
    r.confidence != null ? (r.confidence * 100).toFixed(2) : '',
    r.lat ?? '',
    r.lng ?? '',
    r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN', { hour12: false }) : '',
    r.filename || '',
  ]);
  const csv = [headers, ...body]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  triggerDownload('\uFEFF' + csv, `lightscan_records_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
}

function exportGeoJSON(rows) {
  const features = rows
    .filter(r => r.lat != null && r.lng != null)
    .map(r => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parseFloat(r.lng), parseFloat(r.lat)] },
      properties: {
        id: r.id,
        label: r.label,
        label_cn: r.label_cn,
        confidence: r.confidence,
        color_hex: r.color_hex,
        timestamp: r.timestamp,
        filename: r.filename,
      },
    }));
  const geojson = { type: 'FeatureCollection', features };
  triggerDownload(JSON.stringify(geojson, null, 2), `lightscan_records_${Date.now()}.geojson`, 'application/json');
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── 图标 ─────────────────────────────────────────────────────
const IconDownload = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const IconReport = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────
export default function MyRecordsPanel() {
  const [records, setRecords] = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('全部');
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const PAGE_SIZE = 12;

  useEffect(() => {
    Promise.all([
      getMyGisRecords().then(setRecords),
      getMyStats().then(setStats),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (filter === '全部') return records;
    return records.filter(r => (r.label_cn || '').includes(filter));
  }, [records, filter]);

  const paged      = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteRecord(deleteId);
      setRecords(prev => prev.filter(r => r.id !== deleteId));
    } catch (e) { alert(e.message); }
    finally { setDeleting(false); setDeleteId(null); }
  };

  const weekTotal  = stats?.daily?.reduce((a, d) => a + d.count, 0) ?? 0;
  const todayCount = stats?.daily?.at(-1)?.count ?? 0;

  return (
    <div className={s.page}>

      {/* ── 页面标题 + 导出 ── */}
      <div className={s.pageHeader}>
        <div className={s.pageTitleGroup}>
          <div className={s.pageTitle}>Personal Archive</div>
          <div className={s.pageSub}>仅显示本账户上传的检测数据，支持管理与导出</div>
        </div>
        <div className={s.exportGroup}>
          <button className={s.reportBtn} onClick={() => setShowReport(true)}>
            <IconReport /> 生成巡检周报
          </button>
          <span className={s.exportLabel}>导出</span>
          <button className={s.exportBtn} onClick={() => exportCSV(filtered)}>
            <IconDownload /> CSV
          </button>
          <button className={s.exportBtn} onClick={() => exportGeoJSON(filtered)}>
            <IconDownload /> GeoJSON
          </button>
        </div>
      </div>

      {/* ── 统计卡片 ── */}
      <div className={s.statsGrid}>
        {[
          { label: 'Total',    value: loading ? '—' : (stats?.total ?? records.length), sub: '累计检出' },
          { label: 'Week',     value: loading ? '—' : weekTotal,   sub: '近七日' },
          { label: 'Today',    value: loading ? '—' : todayCount,  sub: '今日' },
          { label: 'Filtered', value: filtered.length,             sub: filter === '全部' ? '全部类型' : `类型：${filter}` },
        ].map(c => (
          <div key={c.label} className={s.statCard}>
            <div className={s.statCardLabel}>{c.label}</div>
            <div className={s.statCardNum}>{c.value}</div>
            <div className={s.statCardSub}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── 筛选栏 ── */}
      <div className={s.toolbar}>
        {LABELS.map(l => (
          <button
            key={l}
            className={`${s.filterBtn} ${filter === l ? s.filterActive : ''}`}
            onClick={() => { setFilter(l); setPage(0); }}
          >
            {l}
          </button>
        ))}
        <span className={s.filterCount}>{filtered.length} 条记录</span>
      </div>

      {/* ── 表格 ── */}
      {loading ? (
        <div className={s.loading}>加载中...</div>
      ) : paged.length === 0 ? (
        <div className={s.empty}>
          暂无检测数据
          <div className={s.emptyMsg}>请先在「图像检测」或「视频流分析」上传数据</div>
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>ID</th><th>病害类型</th><th>置信度</th>
                <th>经纬度</th><th>来源文件</th><th>检测时间</th><th></th>
              </tr>
            </thead>
            <tbody>
              {paged.map(r => (
                <tr key={r.id} className={s.row}>
                  <td className={s.idCell}>#{r.id}</td>
                  <td>
                    <span
                      className={s.labelTag}
                      style={{ color: r.color_hex || '#3E6AE1', borderColor: (r.color_hex || '#3E6AE1') + '60', background: (r.color_hex || '#3E6AE1') + '0d' }}
                    >
                      {r.label_cn || r.label || '—'}
                    </span>
                  </td>
                  <td><ConfBar value={r.confidence} /></td>
                  <td className={s.coordCell}>
                    {r.lat != null && r.lng != null
                      ? `${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}`
                      : '—'}
                  </td>
                  <td className={s.fileCell}>{r.filename || '—'}</td>
                  <td className={s.timeCell}>
                    {r.timestamp
                      ? new Date(r.timestamp).toLocaleString('zh-CN', {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit', hour12: false,
                        })
                      : '—'}
                  </td>
                  <td>
                    <button className={s.delBtn} onClick={() => setDeleteId(r.id)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 分页 ── */}
      {totalPages > 1 && (
        <div className={s.pagination}>
          <button className={s.pageBtn} disabled={page === 0} onClick={() => setPage(0)}>«</button>
          <button className={s.pageBtn} disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
          <span className={s.pageInfo}>{page + 1} / {totalPages}</span>
          <button className={s.pageBtn} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
          <button className={s.pageBtn} disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
        </div>
      )}

      {/* ── 周报 Modal ── */}
      {showReport && <WeeklyReportModal onClose={() => setShowReport(false)} />}

      {/* ── 删除确认 ── */}
      {deleteId && (
        <div className={s.overlay} onClick={() => setDeleteId(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>确认删除记录 #{deleteId}？</div>
            <div className={s.modalSub}>此操作不可撤销，该检测记录将从系统中永久移除。</div>
            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => setDeleteId(null)}>取消</button>
              <button className={s.modalConfirm} onClick={handleDelete} disabled={deleting}>
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
