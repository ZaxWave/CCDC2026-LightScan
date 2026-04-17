import { useEffect, useRef, useState, useMemo } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import s from './MapPanel.module.css';
import ReactECharts from 'echarts-for-react';
import ClusterLayer     from '../components/map/ClusterLayer';
import HeatmapControls  from '../components/map/HeatmapControls';
import TimelineModal    from '../components/map/TimelineModal';

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

export default function MapPanel() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const mapRef    = useRef(null);
  const mapObjRef = useRef(null);
  const [mapInstance,  setMapInstance]  = useState(null);
  const [records,      setRecords]      = useState([]);
  const [stats,        setStats]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [selectedType, setSelectedType] = useState(null);
  const [heatMode,     setHeatMode]     = useState(false);
  const [timelineId,   setTimelineId]   = useState(null);

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
      legend: { top: 'bottom', textStyle: { color: '#9ca3af' } },
      series: [{
        name: '病害类型', type: 'pie', radius: ['50%', '70%'], avoidLabelOverlap: false,
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

  return (
    <div className={s.container} style={{ position: 'relative', width: '100%', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>

      {/* ── 地图底层 ── */}
      <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#090a0f' }} />

      {/* ── 标记聚合层（散点模式）── */}
      <ClusterLayer
        mapInstance={mapInstance}
        records={records}
        selectedType={selectedType}
        visible={!heatMode}
        onShowTimeline={setTimelineId}
      />

      {/* ── 热力图层 + 参数控制面板 ── */}
      <HeatmapControls
        mapInstance={mapInstance}
        records={records}
        visible={heatMode}
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
                { label: '散点模式', val: false },
                { label: '热力图',  val: true  },
              ].map(({ label, val }) => (
                <button
                  key={label}
                  onClick={() => setHeatMode(val)}
                  style={{
                    flex: 1, height: '28px',
                    background: heatMode === val
                      ? (val ? 'rgba(239,68,68,0.15)' : 'rgba(62,106,225,0.15)')
                      : 'rgba(255,255,255,0.04)',
                    border: heatMode === val
                      ? `1px solid ${val ? 'rgba(239,68,68,0.5)' : '#3E6AE1'}`
                      : '1px solid rgba(255,255,255,0.1)',
                    color: heatMode === val
                      ? (val ? '#f87171' : '#93b4f7')
                      : 'rgba(255,255,255,0.35)',
                    fontSize: '11px', fontWeight: heatMode === val ? '600' : '400',
                    cursor: 'pointer', letterSpacing: '0.02em', transition: 'all 0.2s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 中间：饼图 */}
          <div style={{ padding: '16px 20px', flex: 1, borderBottom: '1px solid rgba(255,255,255,0.06)', minHeight: '220px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
                分布占比
              </span>
              {selectedType && (
                <span
                  onClick={() => setSelectedType(null)}
                  style={{ fontSize: '11px', color: '#93b4f7', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {selectedType} ×
                </span>
              )}
            </div>
            <ReactECharts
              option={pieOption}
              style={{ flex: 1, width: '100%' }}
              onEvents={{
                click: (params) => {
                  if (params.componentType === 'series') {
                    setSelectedType(prev => prev === params.name ? null : params.name);
                  }
                },
              }}
            />
          </div>

          {/* 底部：折线图 */}
          <div style={{ padding: '16px 20px', flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '8px', display: 'block' }}>
              近七日趋势
            </span>
            <ReactECharts option={lineOption} style={{ flex: 1, width: '100%' }} />
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
    </div>
  );
}
