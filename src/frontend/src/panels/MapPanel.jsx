import { useEffect, useRef, useState, useMemo } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import s from './MapPanel.module.css';
import ReactECharts from 'echarts-for-react';

const AMAP_KEY           = import.meta.env.VITE_AMAP_KEY           || 'f275bdf35f914d36658f2ab2c7c0feb4';
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE || '5925c6e1bb0cc5d88d379ff29ad85a94';

window._AMapSecurityConfig = {
  securityJsCode: AMAP_SECURITY_CODE,
};

export default function MapPanel() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const mapRef = useRef(null);          // 地图容器 DOM ref
  const mapObjRef = useRef(null);       // 存地图实例供 cleanup 读取（ref 无闭包问题）
  const [mapInstance, setMapInstance] = useState(null);  // 驱动打点 effect 的 state
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // 初始化地图
  // cleanup 使用 mapObjRef（ref 不受闭包旧值影响），确保 StrictMode 双执行时
  // 第一个 map 实例被正确销毁，第二次不会在同一容器上叠加创建。
  useEffect(() => {
    AMapLoader.load({
      key: AMAP_KEY,
      version: "2.0",
      plugins: ['AMap.Scale', 'AMap.ToolBar'],
    }).then((AMap) => {
      const map = new AMap.Map(mapRef.current, {
        viewMode: '3D',
        zoom: 14,
        center: [114.405, 30.482],
        mapStyle: 'amap://styles/darkblue',
      });
      mapObjRef.current = map;
      setMapInstance(map);
    }).catch(e => console.error("高德地图加载失败:", e));

    return () => {
      if (mapObjRef.current) {
        mapObjRef.current.destroy();
        mapObjRef.current = null;
        setMapInstance(null);
      }
    };
  }, []);

  // 获取病害记录
  useEffect(() => {
    fetch('/api/v1/gis/records?limit=500')
      .then(res => res.json())
      .then(data => {
        setRecords(data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("获取病害记录失败:", err);
        setLoading(false);
      });
  }, []);

  // 获取近 7 日真实统计数据
  useEffect(() => {
    fetch('/api/v1/gis/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error("获取统计数据失败:", err));
  }, []);

  // 动态打点（依赖 mapInstance + records，两者任意后到都能触发）
  useEffect(() => {
    if (!mapInstance) return;

    mapInstance.clearMap();
    if (records.length === 0) return;

    records.forEach(item => {
      const lng = parseFloat(item?.lng);
      const lat = parseFloat(item?.lat);
      if (!isNaN(lng) && !isNaN(lat) && lng !== 0 && lat !== 0) {
        try {
          const marker = new window.AMap.Marker({
            position: [lng, lat],
            title: item.label_cn || '病害',
            content: `
              <div style="
                background: ${item.color_hex || '#ff4444'};
                width: 14px; height: 14px;
                border-radius: 50%; border: 2px solid #fff;
                box-shadow: 0 0 15px ${item.color_hex || '#ff4444'};
                cursor: pointer;
              "></div>
            `
          });
          mapInstance.add(marker);
        } catch (_) {}
      }
    });
  }, [mapInstance, records]);

  // [图表 1] 病害类型占比环形图
  const pieOption = useMemo(() => {
    const counts = {};
    records.forEach(r => {
      const name = r.label_cn || '未知类型';
      counts[name] = (counts[name] || 0) + 1;
    });
    const data = Object.keys(counts).map(key => ({
      name: key,
      value: counts[key],
      itemStyle: { color: key.includes('坑槽') ? '#ef4444' : (key.includes('裂缝') ? '#f59e0b' : '#3b82f6') }
    }));
    return {
      tooltip: { trigger: 'item', backgroundColor: 'rgba(10, 15, 30, 0.9)', borderColor: '#3b82f6', textStyle: { color: '#fff' } },
      legend: { top: 'bottom', textStyle: { color: '#9ca3af' } },
      series: [{
        name: '病害类型', type: 'pie', radius: ['50%', '70%'], avoidLabelOverlap: false,
        itemStyle: { borderRadius: 8, borderColor: 'rgba(10, 15, 30, 0.85)', borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold', color: '#fff' } },
        labelLine: { show: false },
        data: data.length > 0 ? data : [{ name: '暂无数据', value: 0 }]
      }]
    };
  }, [records]);

  // [图表 2] 近七日检出趋势折线图（真实数据）
  const lineOption = useMemo(() => {
    const daily = stats?.daily ?? [];
    const xData = daily.length > 0
      ? daily.map(d => {
          const date = new Date(d.date + 'T00:00:00');
          const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
          const isToday = d.date === new Date().toISOString().slice(0, 10);
          return isToday ? '今日' : days[date.getDay()];
        })
      : ['周一', '周二', '周三', '周四', '周五', '周六', '今日'];
    const yData = daily.length > 0 ? daily.map(d => d.count) : [0, 0, 0, 0, 0, 0, 0];
    return {
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(10, 15, 30, 0.9)', borderColor: '#3b82f6', textStyle: { color: '#fff' } },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category', boundaryGap: false, data: xData,
        axisLabel: { color: '#9ca3af' }, axisLine: { lineStyle: { color: '#374151' } }
      },
      yAxis: {
        type: 'value', minInterval: 1,
        axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: '#1f2937', type: 'dashed' } }
      },
      series: [{
        name: '检出数量', type: 'line', smooth: true, data: yData,
        lineStyle: { color: '#3b82f6', width: 3 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            { offset: 0, color: 'rgba(59, 130, 246, 0.5)' },
            { offset: 1, color: 'rgba(59, 130, 246, 0)' }
          ]}
        },
        symbol: 'circle', symbolSize: 8, itemStyle: { color: '#60a5fa', borderColor: '#fff', borderWidth: 2 }
      }]
    };
  }, [stats]);

  const totalCount = loading ? '-' : (stats?.total ?? records.length);

  return (
    <div className={s.container} style={{ position: 'relative', width: '100%', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* 地图底层 */}
      <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#090a0f' }}></div>

      {/* 可收起的数据仪表盘 */}
      <div style={{
        position: 'absolute', top: '20px', bottom: '20px',
        left: isSidebarOpen ? '20px' : '-340px', width: '320px',
        background: 'rgba(10, 15, 30, 0.85)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
        display: 'flex', flexDirection: 'column', zIndex: 999,
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{
          position: 'absolute', right: '-35px', top: '20px',
          width: '35px', height: '60px',
          background: 'rgba(10, 15, 30, 0.85)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.1)', borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#60a5fa', fontSize: '12px',
          boxShadow: '4px 0 10px rgba(0,0,0,0.3)'
        }}>
          {isSidebarOpen ? '◀' : '▶'}
        </div>

        <div style={{
          opacity: isSidebarOpen ? 1 : 0, transition: 'opacity 0.2s',
          display: 'flex', flexDirection: 'column', height: '100%',
          pointerEvents: isSidebarOpen ? 'auto' : 'none'
        }}>
          <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '18px', background: '#3b82f6', borderRadius: '4px' }}></span>
              态势感知面板
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>累计检出病害</span>
              <strong style={{ fontSize: '32px', color: '#fff', lineHeight: '1' }}>{totalCount}</strong>
            </div>
          </div>

          <div style={{ padding: '20px', flex: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', minHeight: '240px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#d1d5db', fontWeight: 'normal' }}>分布占比</h4>
            <ReactECharts option={pieOption} style={{ height: '100%', width: '100%' }} />
          </div>

          <div style={{ padding: '20px', flex: 1, minHeight: '240px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#d1d5db', fontWeight: 'normal' }}>近七日检出趋势</h4>
            <ReactECharts option={lineOption} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
