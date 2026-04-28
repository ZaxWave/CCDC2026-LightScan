import { useEffect, useRef, useState, useMemo } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import s from './MapPanel.module.css';
import ReactECharts from 'echarts-for-react';
import ClusterLayer     from '../components/map/ClusterLayer';
import HeatmapControls  from '../components/map/HeatmapControls';
import TimelineModal    from '../components/map/TimelineModal';
import FusionModal     from '../components/map/FusionModal';
import HealthLayer, { computeGrid } from '../components/map/HealthLayer';
import { dispatchOrder } from '../api/client';

const AMAP_KEY           = import.meta.env.VITE_AMAP_KEY;
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE;

window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };

// 注入脉冲动画（只注入一次）
if (!document.getElementById('ls-map-style')) {
  const el = document.createElement('style');
  el.id = 'ls-map-style';
  el.textContent = `
    @keyframes ls-pulse {
      0%   { transform: scale(1);   box-shadow: 0 0 0 0   rgba(255,255,255,0.6); }
      50%  { transform: scale(1.35);box-shadow: 0 0 0 8px rgba(255,255,255,0); }
      100% { transform: scale(1);   box-shadow: 0 0 0 0   rgba(255,255,255,0); }
    }
  `;
  document.head.appendChild(el);
}

export default function MapPanel({ onBackToDetect }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const mapRef    = useRef(null);
  const mapObjRef = useRef(null);
  const [mapInstance,  setMapInstance]  = useState(null);
  const [amapLib,      setAmapLib]      = useState(null);
  const [records,      setRecords]      = useState([]);
  const [stats,        setStats]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [selectedType, setSelectedType] = useState(null);
  const [heatMode,     setHeatMode]     = useState(false);
  const [healthMode,   setHealthMode]   = useState(false);
  const [timelineId,   setTimelineId]   = useState(null);
  const [fusionId,     setFusionId]     = useState(null);
  const [sliderVal,    setSliderVal]    = useState(100);
  const [refreshKey,   setRefreshKey]   = useState(0);

  // ── 初始化地图 ──────────────────────────────────────────────────────────
  useEffect(() => {
    AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.HeatMap'],
    }).then((AMap) => {
      const map = new AMap.Map(mapRef.current, {
        viewMode: '3D',
        zoom: 14,
        center: [114.405, 30.482],
        mapStyle: 'amap://styles/darkblue',
      });
      mapObjRef.current = map;
      setMapInstance(map);
      setAmapLib(AMap);
    }).catch(e => console.error('高德地图加载失败:', e));

    return () => {
      if (mapObjRef.current) {
        mapObjRef.current.destroy();
        mapObjRef.current = null;
        setMapInstance(null);
      }
    };
  }, []);

  // ── 获取病害记录 ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/v1/gis/records?limit=500')
      .then(res => res.json())
      .then(data => { setRecords(data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshKey]);

  // ── 注册地图标记派发回调 ────────────────────────────────────────────────
  useEffect(() => {
    window.__lsDispatchOrder = async (id) => {
      const btn = document.getElementById(`ls-dispatch-btn-${id}`)
      if (btn) { btn.disabled = true; btn.textContent = '派发中…'; btn.style.opacity = '0.6'; }
      try {
        await dispatchOrder(id)
        if (btn) {
          btn.textContent = '✓ 派发成功'
          btn.style.color = '#22c55e'
          btn.style.background = 'rgba(34,197,94,0.12)'
          btn.style.borderColor = 'rgba(34,197,94,0.4)'
          btn.style.opacity = '1'
        }
        setRefreshKey(k => k + 1)
      } catch (e) {
        if (btn) {
          btn.textContent = e.message?.includes('401') ? '请先登录' : '派发失败'
          btn.style.color = '#ef4444'
          btn.disabled = false
          btn.style.opacity = '1'
        }
      }
    }
    return () => { delete window.__lsDispatchOrder }
  }, []);

  // ── 获取近 7 日统计 ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/v1/gis/stats')
      .then(res => res.json())
      .then(setStats)
      .catch(e => console.error('获取统计数据失败:', e));
  }, []);

  // ── [图表 1] 病害类型占比环形图 ─────────────────────────────────────────
  const pieOption = useMemo(() => {
    const counts = {};
    records.forEach(r => {
      const name = r.label_cn || '未知类型';
      counts[name] = (counts[name] || 0) + 1;
    });
    const data = Object.keys(counts).map(key => ({
      name: key,
      value: counts[key],
      itemStyle: {
        color: key.includes('坑槽') ? '#ef4444'
             : key.includes('裂缝') ? '#f59e0b'
             : '#3b82f6',
      },
    }));
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(10, 15, 30, 0.9)',
        borderColor: '#3b82f6',
        textStyle: { color: '#fff' },
      },
      legend: {
        bottom: 0,
        left: 'center',
        itemWidth: 8, itemHeight: 8, itemGap: 10,
        textStyle: { color: '#9ca3af', fontSize: 11 },
      },
      series: [{
        name: '病害类型', type: 'pie',
        radius: ['44%', '62%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 8, borderColor: 'rgba(10, 15, 30, 0.85)', borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold', color: '#fff' } },
        labelLine: { show: false },
        data: data.length > 0 ? data : [{ name: '暂无数据', value: 0 }],
      }],
    };
  }, [records]);

  // ── [图表 2] 近七日检出趋势 ─────────────────────────────────────────────
  const lineOption = useMemo(() => {
    const daily = stats?.daily ?? [];
    const xData = daily.length > 0
      ? daily.map(d => {
          const date = new Date(d.date + 'T00:00:00');
          const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
          return d.date === new Date().toISOString().slice(0, 10)
            ? '今日'
            : days[date.getDay()];
        })
      : ['周一', '周二', '周三', '周四', '周五', '周六', '今日'];
    const yData = daily.length > 0 ? daily.map(d => d.count) : [0, 0, 0, 0, 0, 0, 0];
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(8,11,20,0.95)',
        borderColor: 'rgba(62,106,225,0.4)',
        textStyle: { color: '#fff', fontSize: 12 },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category', boundaryGap: false, data: xData,
        axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value', minInterval: 1,
        axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' } },
      },
      series: [{
        name: '检出数量', type: 'line', smooth: 0.4, data: yData,
        lineStyle: { color: '#3E6AE1', width: 2 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            { offset: 0, color: 'rgba(62,106,225,0.35)' },
            { offset: 1, color: 'rgba(62,106,225,0)' },
          ]},
        },
        symbol: 'circle', symbolSize: 6,
        itemStyle: { color: '#3E6AE1', borderColor: '#fff', borderWidth: 1.5 },
      }],
    };
  }, [stats]);

  const totalCount = loading ? '-' : (stats?.total ?? records.length);

  const { minTs, maxTs } = useMemo(() => {
    const ts = records.filter(r => r.timestamp).map(r => new Date(r.timestamp).getTime());
    if (ts.length === 0) return { minTs: 0, maxTs: Date.now() };
    return { minTs: Math.min(...ts), maxTs: Math.max(...ts) };
  }, [records]);

  const cutoffTs = minTs + (maxTs - minTs) * (sliderVal / 100);

  const filteredRecords = useMemo(() => {
    if (sliderVal >= 100) return records;
    return records.filter(r => !r.timestamp || new Date(r.timestamp).getTime() <= cutoffTs);
  }, [records, sliderVal, cutoffTs]);

  const cutoffLabel = sliderVal >= 100
    ? '全部数据'
    : new Date(cutoffTs).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

  // ── 路段健康评分网格 ─────────────────────────────────────────────────────
  const healthGrid = useMemo(() =>
    healthMode ? computeGrid(filteredRecords) : []
  , [filteredRecords, healthMode]);

  // ── 键盘快捷键 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const map = mapObjRef.current;
      switch (e.key) {
        case 'ArrowUp':    e.preventDefault(); map?.panBy(0,  120); break;
        case 'ArrowDown':  e.preventDefault(); map?.panBy(0, -120); break;
        case 'ArrowLeft':  e.preventDefault(); map?.panBy( 120, 0); break;
        case 'ArrowRight': e.preventDefault(); map?.panBy(-120, 0); break;
        case '+': case '=': map?.zoomIn();  break;
        case '-':           map?.zoomOut(); break;
        case 'h': case 'H':
          setHealthMode(false);
          setHeatMode(v => !v);
          break;
        case 'g': case 'G':
          setHeatMode(false);
          setHealthMode(v => !v);
          break;
        case 'r': case 'R':
          setRefreshKey(k => k + 1);
          break;
        case 'Escape':
          if (fusionId   != null) { setFusionId(null);   break; }
          if (timelineId != null) setTimelineId(null);
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timelineId]);

  return (
    <div className={s.container} style={{ position: 'relative', width: '100%', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>

      {/* ── 快捷返回检测按钮 ── */}
      {onBackToDetect && (
        <button
          onClick={onBackToDetect}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            padding: '10px 16px',
            background: '#3E6AE1',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: '500',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(62,106,225,0.3)',
            transition: 'all 0.2s'
          }}
        >
          回到检测
        </button>
      )}

      {/* ── 地图底层 ── */}
      <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#090a0f' }} />

      {/* ── 标记聚合层（散点模式）── */}
      <ClusterLayer
        mapInstance={mapInstance}
        records={filteredRecords}
        selectedType={selectedType}
        visible={!heatMode && !healthMode}
        onShowTimeline={setTimelineId}
        onShowFusion={setFusionId}
      />

      {/* ── 热力图层 + 参数控制面板 ── */}
      <HeatmapControls
        mapInstance={mapInstance}
        records={filteredRecords}
        visible={heatMode}
      />

      {/* ── 路段健康评分图层 ── */}
      <HealthLayer
        mapInstance={mapInstance}
        amap={amapLib}
        records={filteredRecords}
        visible={healthMode}
      />

      {/* ── 左侧可收起仪表盘 ── */}
      <div style={{
        position: 'absolute', top: '20px', bottom: '20px',
        left: isSidebarOpen ? '20px' : '-316px', width: '316px',
        background: 'rgba(8, 11, 20, 0.92)', backdropFilter: 'blur(16px)',
        borderTop: '2px solid #3E6AE1',
        border: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', flexDirection: 'column', zIndex: 999,
        transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '4px 0 32px rgba(0,0,0,0.4)',
      }}>
        {/* 收起 tab */}
        <div
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          style={{
            position: 'absolute', right: '-28px', top: '24px',
            width: '28px', height: '52px',
            background: 'rgba(8, 11, 20, 0.92)', backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#3E6AE1', fontSize: '11px',
          }}
        >
          {isSidebarOpen ? '◀' : '▶'}
        </div>

        <div style={{
          opacity: isSidebarOpen ? 1 : 0, transition: 'opacity 0.18s',
          display: 'flex', flexDirection: 'column', height: '100%',
          pointerEvents: isSidebarOpen ? 'auto' : 'none', overflow: 'hidden',
        }}>
          {/* 顶部：标题 + 统计 + 视图切换 */}
          <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span style={{ width: '3px', height: '16px', background: '#3E6AE1', flexShrink: 0 }} />
              <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>
                Situational Awareness
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px', letterSpacing: '0.04em' }}>累计检出病害</span>
              <strong style={{ fontSize: '36px', fontWeight: '700', color: '#fff', lineHeight: '1', letterSpacing: '-0.02em' }}>{totalCount}</strong>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { label: '散点', key: 'scatter', accent: '#3E6AE1', active: !heatMode && !healthMode,
                  onClick: () => { setHeatMode(false); setHealthMode(false); } },
                { label: '热力图', key: 'heat', accent: '#ef4444', active: heatMode,
                  onClick: () => { setHeatMode(true); setHealthMode(false); } },
                { label: '健康图', key: 'health', accent: '#22c55e', active: healthMode,
                  onClick: () => { setHeatMode(false); setHealthMode(true); } },
              ].map(m => (
                <button key={m.key} onClick={m.onClick} style={{
                  flex: 1, height: '28px',
                  background: m.active ? `${m.accent}22` : 'rgba(255,255,255,0.04)',
                  border: m.active ? `1px solid ${m.accent}88` : '1px solid rgba(255,255,255,0.1)',
                  color: m.active ? m.accent : 'rgba(255,255,255,0.35)',
                  fontSize: '11px', fontWeight: m.active ? '600' : '400',
                  cursor: 'pointer', letterSpacing: '0.02em', transition: 'all 0.2s',
                }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 中间：饼图 / 健康排行（互斥） */}
          <div style={{ flex: 1, borderBottom: healthMode ? 'none' : '1px solid rgba(255,255,255,0.06)', minHeight: '220px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!healthMode ? (
              /* 饼图 */
              <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
                    分布占比
                  </span>
                  {selectedType && (
                    <span onClick={() => setSelectedType(null)} style={{ fontSize: '11px', color: '#93b4f7', cursor: 'pointer' }}>
                      {selectedType} ×
                    </span>
                  )}
                </div>
                <ReactECharts
                  option={pieOption}
                  style={{ flex: 1, width: '100%' }}
                  onEvents={{ click: (p) => { if (p.componentType === 'series') setSelectedType(prev => prev === p.name ? null : p.name) } }}
                />
              </div>
            ) : (
              /* 健康排行榜 */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px 10px', flexShrink: 0 }}>
                  <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
                    路段健康排行
                  </span>
                </div>
                {/* legend */}
                <div style={{ padding: '0 20px 10px', display: 'flex', gap: 10, flexShrink: 0 }}>
                  {[['#22c55e','≥80'], ['#eab308','60–79'], ['#f97316','40–59'], ['#ef4444','<40']].map(([c, l]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{l}</span>
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
                  {healthGrid.length === 0 ? (
                    <div style={{ padding: '20px 0', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>暂无含坐标的记录</div>
                  ) : healthGrid.map((cell, i) => (
                    <div
                      key={cell.key}
                      onClick={() => mapInstance?.setCenter([cell.gLng, cell.gLat])}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 8px', marginBottom: 3, borderRadius: 3,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer', transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    >
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', width: 16, flexShrink: 0, textAlign: 'right' }}>#{i+1}</span>
                      <div style={{
                        width: 36, height: 24, borderRadius: 3, flexShrink: 0,
                        background: cell.color + '22', border: `1px solid ${cell.color}55`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: cell.color, fontVariantNumeric: 'tabular-nums' }}>{cell.score}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
                          {cell.gLat.toFixed(3)}°N, {cell.gLng.toFixed(3)}°E
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{cell.count} 处病害</div>
                      </div>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>→</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部：折线图（健康图模式下隐藏，排行榜独占全高） */}
          {!healthMode && (
            <div style={{ padding: '16px 20px', flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '8px', display: 'block' }}>
                近七日趋势
              </span>
              <ReactECharts option={lineOption} style={{ flex: 1, width: '100%' }} />
            </div>
          )}

          {/* 时间轴滑块 */}
          <div style={{
            flexShrink: 0,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            padding: '12px 20px 14px',
            transition: 'border-color 0.2s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
                历史回溯
              </span>
              <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: sliderVal < 100 ? '#93b4f7' : 'rgba(255,255,255,0.22)', transition: 'color 0.2s' }}>
                {sliderVal < 100 ? `截至 ${cutoffLabel}` : '实时 · 全部数据'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {minTs ? new Date(minTs).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '--'}
              </span>
              <input
                type="range" min={0} max={100} value={sliderVal}
                onChange={e => setSliderVal(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#3E6AE1', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap' }}>今日</span>
            </div>
            {sliderVal < 100 && (
              <div style={{ marginTop: 6, fontSize: 9, color: 'rgba(62,106,225,0.65)', textAlign: 'center', letterSpacing: '0.04em' }}>
                该时段共检出 <b style={{ color: '#93b4f7' }}>{filteredRecords.length}</b> 处病害
              </div>
            )}
          </div>

          {/* 快捷键提示 */}
          <div style={{ padding: '8px 20px', borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
              {[['←↑→↓','平移'], ['H','热力图'], ['G','健康图'], ['R','刷新'], ['+/-','缩放'], ['Esc','关闭']].map(([k, v]) => (
                <span key={k} style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <kbd style={{ padding: '1px 4px', background: 'rgba(255,255,255,0.07)', borderRadius: 2, fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{k}</kbd>
                  {v}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 演变时间轴弹窗 ── */}
      {timelineId != null && (
        <TimelineModal
          recordId={timelineId}
          onClose={() => setTimelineId(null)}
        />
      )}

      {/* ── 多源融合全景弹窗 ── */}
      {fusionId != null && (
        <FusionModal
          recordId={fusionId}
          onClose={() => setFusionId(null)}
        />
      )}
    </div>
  );
}
