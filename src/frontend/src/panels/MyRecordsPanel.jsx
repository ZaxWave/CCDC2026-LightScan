import { useState, useEffect, useRef, useMemo } from 'react';
import { getMyGisRecords, deleteRecord, getMyStats, getDeletedRecords, restoreRecord, batchDeleteRecords, updateRecordStatus, permanentDeleteRecord, batchPermanentDeleteRecords } from '../api/client';
import WeeklyReportModal from '../components/WeeklyReportModal';
import RepairCompareModal from '../components/RepairCompareModal';
import s from './MyRecordsPanel.module.css';

const STATUS_CONFIG = {
  pending:    { label: '待修',   color: '#D93025', bg: 'rgba(217,48,37,0.08)',   border: 'rgba(217,48,37,0.3)'  },
  processing: { label: '维修中', color: '#d97706', bg: 'rgba(217,119,6,0.08)',   border: 'rgba(217,119,6,0.35)' },
  repaired:   { label: '已修',   color: '#1a8045', bg: 'rgba(26,128,69,0.08)',   border: 'rgba(26,128,69,0.3)'  },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', fontWeight: 500,
      padding: '2px 8px', borderRadius: '2px',
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

const LABEL_OPTS = ['全部', '坑槽', '纵向裂缝', '龟裂', '横向裂缝'];
const STATUS_OPTS = [{ v: '',           l: '全部状态' }, { v: 'pending', l: '待修' }, { v: 'processing', l: '维修中' }, { v: 'repaired', l: '已修' }];
const SOURCE_OPTS = [{ v: '', l: '全部来源' }, { v: 'dashcam', l: '行车记录仪' }, { v: 'mobile', l: '手机' }, { v: 'camera', l: '监控' }, { v: 'drone', l: '无人机' }, { v: 'manual', l: '手动' }];

function bboxArea(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const [x1, y1, x2, y2] = bbox.map(Number);
  return Math.abs((x2 - x1) * (y2 - y1));
}

function getRecordTime(record) {
  const t = record.captured_at || record.timestamp;
  if (!t) return null;
  return new Date(t);
}

function formatRecordTime(record) {
  const time = getRecordTime(record);
  if (!time || Number.isNaN(time.getTime())) return '—';
  return time.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

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
  const [fStatus,  setFStatus]  = useState('');
  const [fSource,  setFSource]  = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo,   setFDateTo]   = useState('');
  const [fConfMin,  setFConfMin]  = useState('');   // 最低置信度 0-100
  const [fAreaMin,  setFAreaMin]  = useState('');   // 最小 bbox 面积（像素²）
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [page,     setPage]     = useState(0);
  const [showReport, setShowReport] = useState(false);

  // 批量选择
  const [selected, setSelected] = useState(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // 状态更新
  const [statusModal,    setStatusModal]    = useState(null); // record being updated
  const [statusValue,    setStatusValue]    = useState('pending');
  const [workerValue,    setWorkerValue]    = useState('');
  const [repairFile,     setRepairFile]     = useState(null);
  const [repairPreview,  setRepairPreview]  = useState(null);
  const repairInputRef = useRef(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // 修复对比
  const [compareRecord, setCompareRecord] = useState(null);

  // 回收站
  const [showTrash, setShowTrash]   = useState(false);
  const [trashRecs, setTrashRecs]   = useState([]);
  const [trashLoad, setTrashLoad]   = useState(false);
  const [restoring, setRestoring]   = useState(null);
  const [trashSelected, setTrashSelected] = useState(new Set());
  const [permanentDeleteId, setPermanentDeleteId] = useState(null);
  const [permanentDeleting, setPermanentDeleting] = useState(false);
  const [showBatchPermanentConfirm, setShowBatchPermanentConfirm] = useState(false);
  const [batchPermanentDeleting, setBatchPermanentDeleting] = useState(false);

  // 修复照片预览 URL 管理
  useEffect(() => {
    if (!repairFile) { setRepairPreview(null); return; }
    const url = URL.createObjectURL(repairFile);
    setRepairPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [repairFile]);

  const PAGE_SIZE = 12;

  const loadActive = () =>
    Promise.all([
      getMyGisRecords().then(setRecords),
      getMyStats().then(setStats),
    ]).finally(() => setLoading(false));

  useEffect(() => { loadActive(); }, []);

  const openStatusModal = (record) => {
    setStatusModal(record);
    setStatusValue(record.status || 'pending');
    setWorkerValue(record.worker_name || '');
    setRepairFile(null);
  };

  const handleStatusUpdate = async () => {
    if (!statusModal) return;
    if (statusValue === 'repaired' && !repairFile) {
      alert('修复完成时需上传修补后的路面照片');
      return;
    }
    setStatusUpdating(true);
    try {
      const updated = await updateRecordStatus(
        statusModal.id,
        statusValue,
        workerValue.trim() || null,
        repairFile || null,
      );
      setRecords(prev => prev.map(r => r.id === updated.id ? updated : r));
      setStatusModal(null);
      setRepairFile(null);
    } catch (e) { alert(e.message); }
    finally { setStatusUpdating(false); }
  };

  const openTrash = () => {
    setShowTrash(true);
    setTrashLoad(true);
    setTrashSelected(new Set());
    getDeletedRecords().then(setTrashRecs).finally(() => setTrashLoad(false));
  };

  const handleRestore = async (id) => {
    setRestoring(id);
    try {
      await restoreRecord(id);
      setTrashRecs(prev => prev.filter(r => r.id !== id));
      setTrashSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
      // refresh active list
      getMyGisRecords().then(setRecords);
      getMyStats().then(setStats);
    } catch (e) { alert(e.message); }
    finally { setRestoring(null); }
  };

  const handlePermanentDelete = async () => {
    if (!permanentDeleteId) return;
    setPermanentDeleting(true);
    try {
      await permanentDeleteRecord(permanentDeleteId);
      setTrashRecs(prev => prev.filter(r => r.id !== permanentDeleteId));
      setTrashSelected(prev => { const s = new Set(prev); s.delete(permanentDeleteId); return s; });
    } catch (e) { alert(e.message); }
    finally { setPermanentDeleting(false); setPermanentDeleteId(null); }
  };

  const handleBatchPermanentDelete = async () => {
    if (trashSelected.size === 0) return;
    setBatchPermanentDeleting(true);
    try {
      await batchPermanentDeleteRecords([...trashSelected]);
      setTrashRecs(prev => prev.filter(r => !trashSelected.has(r.id)));
      setTrashSelected(new Set());
    } catch (e) { alert(e.message); }
    finally { setBatchPermanentDeleting(false); setShowBatchPermanentConfirm(false); }
  };

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filter !== '全部') {
        const labelCn = (r.label_cn || '').toString();
        const labelEn = (r.label || '').toString();
        if (!labelCn.includes(filter) && !labelEn.includes(filter)) {
          return false;
        }
      }
      if (fStatus && (r.status || 'pending') !== fStatus) return false;
      if (fSource && (r.source_type || '') !== fSource) return false;

      const time = getRecordTime(r);
      if (fDateFrom) {
        const from = new Date(`${fDateFrom}T00:00:00`);
        if (!time || time < from) return false;
      }
      if (fDateTo) {
        const to = new Date(`${fDateTo}T23:59:59`);
        if (!time || time > to) return false;
      }
      if (fConfMin !== '') {
        const minConf = Number(fConfMin);
        if (Number.isNaN(minConf) || minConf < 0) return false;
        if (r.confidence == null || r.confidence * 100 < minConf) return false;
      }
      if (fAreaMin !== '') {
        const minArea = Number(fAreaMin);
        if (Number.isNaN(minArea) || minArea < 0) return false;
        const area = bboxArea(r.bbox);
        if (area == null || area < minArea) return false;
      }
      return true;
    });
  }, [records, filter, fStatus, fSource, fDateFrom, fDateTo, fConfMin, fAreaMin]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [filter, fStatus, fSource, fDateFrom, fDateTo, fConfMin, fAreaMin]);

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
        {LABEL_OPTS.map(l => (
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

      <div className={s.subToolbar}>
        <div className={s.filterRow}>
          <label className={s.filterItem}>
            状态
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
              {STATUS_OPTS.map(opt => <option key={opt.v} value={opt.v}>{opt.l}</option>)}
            </select>
          </label>
          <label className={s.filterItem}>
            来源
            <select value={fSource} onChange={e => setFSource(e.target.value)}>
              {SOURCE_OPTS.map(opt => <option key={opt.v} value={opt.v}>{opt.l}</option>)}
            </select>
          </label>
          <label className={s.filterItem}>
            日期从
            <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)} />
          </label>
          <label className={s.filterItem}>
            到
            <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)} />
          </label>
          <label className={s.filterItem}>
            最低置信度
            <input
              type="number"
              min="0"
              max="100"
              placeholder="%"
              value={fConfMin}
              onChange={e => setFConfMin(e.target.value)}
            />
          </label>
          <label className={s.filterItem}>
            最小面积
            <input
              type="number"
              min="0"
              placeholder="像素²"
              value={fAreaMin}
              onChange={e => setFAreaMin(e.target.value)}
            />
          </label>
        </div>
        <div className={s.filterHint}>按时间筛选使用拍摄时间（若有 EXIF）或上传时间回退值。</div>
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
                <th>经纬度</th><th>来源文件</th><th>检测时间</th>
                <th>处理状态</th><th></th>
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
                    {formatRecordTime(r)}
                    {r.captured_at && r.timestamp && r.captured_at !== r.timestamp ? (
                      <div className={s.timeTip}>拍摄时间优先，上传时间备份</div>
                    ) : null}
                  </td>
                  <td><StatusBadge status={r.status || 'pending'} /></td>
                  <td className={s.actionCell}>
                    {r.status === 'repaired' && r.repaired_image_b64 && (
                      <button className={s.compareBtn} onClick={() => setCompareRecord(r)}>对比</button>
                    )}
                    <button className={s.updateBtn} onClick={() => openStatusModal(r)}>更新</button>
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

      {/* ── 状态更新 Modal ── */}
      {statusModal && (
        <div className={s.overlay} onClick={() => { setStatusModal(null); setRepairFile(null); }}>
          <div className={s.modal} style={{ borderTopColor: STATUS_CONFIG[statusValue]?.color || '#3E6AE1' }} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>更新工单状态</div>
            <div className={s.modalSub}>记录 #{statusModal.id}「{statusModal.label_cn || statusModal.label || '—'}」</div>
            <div className={s.statusRadioGroup}>
              {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                <label
                  key={val}
                  className={`${s.statusRadioLabel} ${statusValue === val ? s.statusRadioActive : ''}`}
                  style={statusValue === val ? { borderColor: cfg.color, color: cfg.color, background: cfg.bg } : {}}
                >
                  <input
                    type="radio" name="status" value={val}
                    checked={statusValue === val}
                    onChange={() => setStatusValue(val)}
                    style={{ display: 'none' }}
                  />
                  {cfg.label}
                </label>
              ))}
            </div>
            <input
              className={`${s.workerInput} ${statusValue === 'repaired' ? s.workerInputCompact : ''}`}
              placeholder="负责人姓名（可选）"
              value={workerValue}
              onChange={e => setWorkerValue(e.target.value)}
            />
            {statusValue === 'repaired' && (
              <div className={s.repairSection}>
                <div className={s.repairLabel}>
                  修补后照片
                  <span className={s.repairRequired}>必填</span>
                </div>
                <input
                  ref={repairInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => setRepairFile(e.target.files[0] || null)}
                  style={{ display: 'none' }}
                />
                {repairFile ? (
                  <div className={s.repairPreview}>
                    {repairPreview && (
                      <img src={repairPreview} className={s.repairThumb} alt="修补后照片预览" />
                    )}
                    <div className={s.repairFileInfo}>
                      <span className={s.repairFileName}>{repairFile.name}</span>
                      <span className={s.repairFileSize}>{(repairFile.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button
                      type="button"
                      className={s.repairResetBtn}
                      onClick={() => { setRepairFile(null); if (repairInputRef.current) repairInputRef.current.value = ''; }}
                    >
                      重新选择
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={s.repairZone}
                    onClick={() => repairInputRef.current?.click()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <div>
                      <div className={s.repairZoneMain}>点击上传修补照片</div>
                      <div className={s.repairZoneSub}>JPG · PNG · WEBP</div>
                    </div>
                  </button>
                )}
              </div>
            )}
            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => { setStatusModal(null); setRepairFile(null); }}>取消</button>
              <button
                className={s.modalConfirm}
                style={{ background: STATUS_CONFIG[statusValue]?.color || '#3E6AE1' }}
                onClick={handleStatusUpdate}
                disabled={statusUpdating}
              >
                {statusUpdating ? '更新中...' : '确认更新'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 修复对比 Modal ── */}
      {compareRecord && <RepairCompareModal record={compareRecord} onClose={() => setCompareRecord(null)} />}

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
              {trashSelected.size > 0 && (
                <span className={s.batchBar} style={{ marginRight: '10px' }}>
                  已选 {trashSelected.size} 条
                  <button
                    className={s.batchDelBtn}
                    style={{ background: '#ef4444', borderColor: '#ef4444' }}
                    onClick={() => setShowBatchPermanentConfirm(true)}
                  >
                    彻底删除
                  </button>
                  <button className={s.batchClrBtn} onClick={() => setTrashSelected(new Set())}>
                    取消选择
                  </button>
                </span>
              )}
              <button className={s.modalCancel} style={{ flex: 'none', padding: '0 18px' }} onClick={() => setShowTrash(false)}>关闭</button>
            </div>
            {trashLoad ? (
              <div className={s.loading}>加载中...</div>
            ) : trashRecs.length === 0 ? (
              <div className={s.empty} style={{ padding: '40px 0' }}>回收站为空</div>
            ) : (
              <div className={`${s.tableWrap} ${s.trashTableInner}`} style={{ border: 'none', borderTop: '1px solid var(--border)' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          checked={trashRecs.length > 0 && trashRecs.every(r => trashSelected.has(r.id))}
                          onChange={() => {
                            if (trashRecs.every(r => trashSelected.has(r.id))) {
                              setTrashSelected(new Set());
                            } else {
                              setTrashSelected(new Set(trashRecs.map(r => r.id)));
                            }
                          }}
                          className={s.chk}
                        />
                      </th>
                      <th>ID</th><th>病害类型</th><th>删除时间</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trashRecs.map(r => (
                      <tr key={r.id} className={`${s.row} ${trashSelected.has(r.id) ? s.rowSelected : ''}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={trashSelected.has(r.id)}
                            onChange={() => {
                              const newSelected = new Set(trashSelected);
                              if (newSelected.has(r.id)) newSelected.delete(r.id);
                              else newSelected.add(r.id);
                              setTrashSelected(newSelected);
                            }}
                            className={s.chk}
                          />
                        </td>
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
                        <td className={s.actionCell}>
                          <button
                            className={s.restoreBtn}
                            onClick={() => handleRestore(r.id)}
                            disabled={restoring === r.id}
                          >
                            {restoring === r.id ? '恢复中...' : '恢复'}
                          </button>
                          <button
                            className={s.permanentDelBtn}
                            onClick={() => setPermanentDeleteId(r.id)}
                          >
                            彻底删除
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

      {/* ── 彻底删除确认弹窗 ── */}
      {permanentDeleteId && (
        <div className={s.overlay} onClick={() => setPermanentDeleteId(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>彻底删除？</div>
            <div className={s.modalSub} style={{ color: '#ef4444' }}>
              此操作不可恢复，记录 #{permanentDeleteId} 将被永久删除！
            </div>
            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => setPermanentDeleteId(null)}>取消</button>
              <button
                className={s.modalConfirm}
                style={{ background: '#ef4444' }}
                onClick={handlePermanentDelete}
                disabled={permanentDeleting}
              >
                {permanentDeleting ? '删除中...' : '确认彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 批量彻底删除确认弹窗 ── */}
      {showBatchPermanentConfirm && (
        <div className={s.overlay} onClick={() => setShowBatchPermanentConfirm(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>批量彻底删除？</div>
            <div className={s.modalSub} style={{ color: '#ef4444' }}>
              已选 {trashSelected.size} 条记录将被永久删除，此操作不可恢复！
            </div>
            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => setShowBatchPermanentConfirm(false)}>取消</button>
              <button
                className={s.modalConfirm}
                style={{ background: '#ef4444' }}
                onClick={handleBatchPermanentDelete}
                disabled={batchPermanentDeleting}
              >
                {batchPermanentDeleting ? '删除中...' : `确认彻底删除 ${trashSelected.size} 条`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
