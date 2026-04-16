import { useState, useEffect, useMemo } from 'react';
import { getMyGisRecords, deleteRecord, getMyStats, getDeletedRecords, restoreRecord, batchDeleteRecords } from '../api/client';
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
  const [records,  setRecords]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('全部');
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [page,     setPage]     = useState(0);
  const [showReport, setShowReport] = useState(false);

  // 批量选择
  const [selected, setSelected] = useState(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // 回收站
  const [showTrash, setShowTrash]   = useState(false);
  const [trashRecs, setTrashRecs]   = useState([]);
  const [trashLoad, setTrashLoad]   = useState(false);
  const [restoring, setRestoring]   = useState(null);

  const PAGE_SIZE = 12;

  const loadActive = () =>
    Promise.all([
      getMyGisRecords().then(setRecords),
      getMyStats().then(setStats),
    ]).finally(() => setLoading(false));

  useEffect(() => { loadActive(); }, []);

  const openTrash = () => {
    setShowTrash(true);
    setTrashLoad(true);
    getDeletedRecords().then(setTrashRecs).finally(() => setTrashLoad(false));
  };

  const handleRestore = async (id) => {
    setRestoring(id);
    try {
      await restoreRecord(id);
      setTrashRecs(prev => prev.filter(r => r.id !== id));
      // refresh active list
      getMyGisRecords().then(setRecords);
      getMyStats().then(setStats);
    } catch (e) { alert(e.message); }
    finally { setRestoring(null); }
  };

  const filtered = useMemo(() => {
    if (filter === '全部') return records;
    return records.filter(r => (r.label_cn || '').includes(filter));
  }, [records, filter]);

  const paged      = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // 单条删除
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteRecord(deleteId);
      setRecords(prev => prev.filter(r => r.id !== deleteId));
      setSelected(prev => { const s = new Set(prev); s.delete(deleteId); return s; });
    } catch (e) { alert(e.message); }
    finally { setDeleting(false); setDeleteId(null); }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    try {
      await batchDeleteRecords([...selected]);
      setRecords(prev => prev.filter(r => !selected.has(r.id)));
      setSelected(new Set());
    } catch (e) { alert(e.message); }
    finally { setBatchDeleting(false); setShowBatchConfirm(false); }
  };

  // 全选/取消
  const allPageIds  = paged.map(r => r.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const toggleAll   = () => {
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); allPageIds.forEach(id => s.delete(id)); return s; });
    } else {
      setSelected(prev => { const s = new Set(prev); allPageIds.forEach(id => s.add(id)); return s; });
    }
  };
  const toggleOne = (id) => setSelected(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

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
          <button className={s.trashBtn} onClick={openTrash}>
            回收站
          </button>
          <button className={s.reportBtn} onClick={() => setShowReport(true)}>
            <IconReport /> 生成巡检周报
          </button>
          <span className={s.exportLabel}>导出</span>
          <button className={s.exportBtn} onClick={() => exportCSV(selected.size > 0 ? filtered.filter(r => selected.has(r.id)) : filtered)}>
            <IconDownload /> CSV
          </button>
          <button className={s.exportBtn} onClick={() => exportGeoJSON(selected.size > 0 ? filtered.filter(r => selected.has(r.id)) : filtered)}>
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
            onClick={() => { setFilter(l); setPage(0); setSelected(new Set()); }}
          >
            {l}
          </button>
        ))}
        <span className={s.filterCount}>{filtered.length} 条记录</span>
        {selected.size > 0 && (
          <span className={s.batchBar}>
            已选 {selected.size} 条
            <button className={s.batchDelBtn} onClick={() => setShowBatchConfirm(true)}>批量删除</button>
            <button className={s.batchClrBtn} onClick={() => setSelected(new Set())}>取消选择</button>
          </span>
        )}
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
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className={s.chk} />
                </th>
                <th>ID</th><th>病害类型</th><th>置信度</th>
                <th>经纬度</th><th>来源文件</th><th>检测时间</th><th></th>
              </tr>
            </thead>
            <tbody>
              {paged.map(r => (
                <tr key={r.id} className={`${s.row} ${selected.has(r.id) ? s.rowSelected : ''}`}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className={s.chk} />
                  </td>
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

      {/* ── 单条删除确认 ── */}
      {deleteId && (
        <div className={s.overlay} onClick={() => setDeleteId(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>移入回收站？</div>
            <div className={s.modalSub}>记录 #{deleteId} 将移入回收站，7 天内可随时恢复。</div>
            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => setDeleteId(null)}>取消</button>
              <button className={s.modalConfirm} onClick={handleDelete} disabled={deleting}>
                {deleting ? '处理中...' : '确认移除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 批量删除确认 ── */}
      {showBatchConfirm && (
        <div className={s.overlay} onClick={() => setShowBatchConfirm(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>批量移入回收站？</div>
            <div className={s.modalSub}>已选 {selected.size} 条记录将移入回收站，7 天内可恢复。</div>
            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => setShowBatchConfirm(false)}>取消</button>
              <button className={s.modalConfirm} onClick={handleBatchDelete} disabled={batchDeleting}>
                {batchDeleting ? '处理中...' : `确认删除 ${selected.size} 条`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 回收站面板 ── */}
      {showTrash && (
        <div className={s.overlay} onClick={() => setShowTrash(false)}>
          <div className={s.trashModal} onClick={e => e.stopPropagation()}>
            <div className={s.trashHeader}>
              <div>
                <div className={s.trashTitle}>回收站</div>
                <div className={s.trashSub}>软删除记录将在 7 天后自动清除</div>
              </div>
              <button className={s.modalCancel} style={{ width: 60 }} onClick={() => setShowTrash(false)}>关闭</button>
            </div>
            {trashLoad ? (
              <div className={s.loading}>加载中...</div>
            ) : trashRecs.length === 0 ? (
              <div className={s.empty} style={{ padding: '40px 0' }}>回收站为空</div>
            ) : (
              <div className={s.tableWrap} style={{ border: 'none', borderTop: '1px solid #ebebeb' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>ID</th><th>病害类型</th><th>删除时间</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trashRecs.map(r => (
                      <tr key={r.id} className={s.row}>
                        <td className={s.idCell}>#{r.id}</td>
                        <td>
                          <span className={s.labelTag}
                            style={{ color: r.color_hex || '#3E6AE1', borderColor: (r.color_hex || '#3E6AE1') + '60', background: (r.color_hex || '#3E6AE1') + '0d' }}>
                            {r.label_cn || r.label || '—'}
                          </span>
                        </td>
                        <td className={s.timeCell}>
                          {r.deleted_at ? new Date(r.deleted_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
                        </td>
                        <td>
                          <button
                            className={s.restoreBtn}
                            onClick={() => handleRestore(r.id)}
                            disabled={restoring === r.id}
                          >
                            {restoring === r.id ? '恢复中...' : '恢复'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
