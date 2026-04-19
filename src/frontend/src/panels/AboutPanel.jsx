import s from './AboutPanel.module.css';

// ── 数据定义 ────────────────────────────────────────────────

const TECH_STACK = [
  { group: 'AI Engine',       items: ['LS-Det v1  (road defect detection)', 'SAHI  (slicing aided hyper inference)', 'DeepSeek-V3  (report & advice generation)'] },
  { group: 'Frontend',        items: ['React 18 + Vite 5', 'AMap JS API 2.0  (GIS / heatmap)', 'ECharts 5  (data visualization)'] },
  { group: 'Backend',         items: ['FastAPI 0.111  (async REST)', 'PostgreSQL 15 + SQLAlchemy 2', 'Uvicorn  (ASGI server)'] },
  { group: 'LLM Integration', items: ['DeepSeek-V3  (report generation)', 'OpenAI-compatible  Chat Completions API'] },
  { group: 'Infrastructure',  items: ['Python 3.11 runtime', 'JWT Bearer authentication', 'Soft-delete + recycle bin storage'] },
];

const INNOVATIONS = [
  {
    tag: 'INV-01',
    title: '轻量化边缘检测',
    desc: '基于 LS-Det v1 深度可分离卷积架构，参数量较基线压缩约 40%，推理延迟 < 40 ms/帧，支持 SAHI 自适应切片以提升小目标召回。',
  },
  {
    tag: 'INV-02',
    title: '多模态态势感知',
    desc: '将检测结果与 GIS 坐标融合，通过 AMap 热力图直观呈现病害空间分布，支持散点 / 热力双模式实时切换。',
  },
  {
    tag: 'INV-03',
    title: '生成式报告体系',
    desc: '调用 DeepSeek-V3 大模型对近 7 日巡检数据进行语义分析，自动生成结构化巡检周报，支持一键 PDF 导出。',
  },
  {
    tag: 'INV-04',
    title: '视频流逐帧分析',
    desc: '支持 GPS 里程触发 / OCR 桩号识别 / 固定时间间隔三种采样策略，从巡检视频中自动提取关键病害帧。',
  },
  {
    tag: 'INV-05',
    title: '分级权限与数据隔离',
    desc: '区分个人数据与平台共享数据，实现软删除回收站机制，支持多角色（管理员 / 检测员）差异化访问控制。',
  },
];

const TEAM = [
  { role: 'Project Lead / Full-Stack',  name: 'ZaxWave',    note: 'Architecture · Backend · Frontend' },
  { role: 'AI Model Engineering',       name: 'Team AI',     note: 'LS-Det Training · Dataset Annotation' },
  { role: 'GIS & Visualization',        name: 'Team GIS',    note: 'AMap Integration · ECharts Dashboard' },
  { role: 'UI / UX Design',             name: 'Team Design', note: 'Industrial Minimal Design System' },
];

const DEFECT_CLASSES = [
  { code: 'D00', name: '纵向裂缝', color: '#3E6AE1' },
  { code: 'D10', name: '横向裂缝', color: '#7c3aed' },
  { code: 'D20', name: '网状裂缝', color: '#d97706' },
  { code: 'D40', name: '坑槽',     color: '#D93025' },
];

// ── 子组件 ───────────────────────────────────────────────────

function SectionHeader({ label, title }) {
  return (
    <div className={s.sectionHeader}>
      <span className={s.sectionLabel}>{label}</span>
      <div className={s.sectionTitle}>{title}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

export default function AboutPanel() {
  return (
    <div className={s.page}>

      {/* ══ HERO BLOCK ══════════════════════════════════════════ */}
      <div className={s.hero}>
        <div className={s.heroLeft}>
          <div className={s.logoLine}>
            <span className={s.logoText}>LIGHTSCAN</span>
            <span className={s.versionBadge}>v2.0.4</span>
          </div>
          <div className={s.tagline}>
            一站式道路病害轻量化智能巡检平台
          </div>
          <div className={s.heroBadges}>
            <span className={s.badge}>ENTERPRISE EDITION</span>
            <span className={s.badge}>第19届中国大学生计算机设计大赛</span>
            <span className={s.badge}>人工智能应用赛道</span>
          </div>
        </div>
        <div className={s.heroRight}>
          <div className={s.sysProfile}>
            <div className={s.sysRow}><span className={s.sysKey}>BUILD</span><span className={s.sysVal}>2026.04.16-stable</span></div>
            <div className={s.sysRow}><span className={s.sysKey}>MODEL</span><span className={s.sysVal}>LS-Det v1 · mAP@0.5 = 69.2%</span></div>
            <div className={s.sysRow}><span className={s.sysKey}>CLASSES</span><span className={s.sysVal}>D00 / D10 / D20 / D40</span></div>
            <div className={s.sysRow}><span className={s.sysKey}>LICENSE</span><span className={s.sysVal}>Academic / Competition Use Only</span></div>
            <div className={s.sysRow}><span className={s.sysKey}>RUNTIME</span><span className={s.sysVal}>Python 3.11 + FastAPI + React 18</span></div>
          </div>
        </div>
      </div>

      {/* ══ TECH STACK ══════════════════════════════════════════ */}
      <section className={s.section}>
        <SectionHeader label="SECTION 01" title="技术栈看板  Technology Stack" />
        <div className={s.stackGrid}>
          {TECH_STACK.map(g => (
            <div key={g.group} className={s.stackCard}>
              <div className={s.stackGroup}>{g.group}</div>
              {g.items.map(item => (
                <div key={item} className={s.stackItem}>
                  <span className={s.stackDot} />
                  {item}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ══ TWO COLUMNS: Defect Classes + Architecture ══════════ */}
      <section className={s.section}>
        <SectionHeader label="SECTION 02" title="检测目标与系统架构  Detection Targets & Architecture" />
        <div className={s.twoCol}>

          {/* 左：病害类别 */}
          <div className={s.colCard}>
            <div className={s.colTitle}>病害检测类别</div>
            <div className={s.defectList}>
              {DEFECT_CLASSES.map(d => (
                <div key={d.code} className={s.defectRow}>
                  <span className={s.defectCode} style={{ color: d.color, borderColor: d.color + '50' }}>{d.code}</span>
                  <span className={s.defectName}>{d.name}</span>
                  <span className={s.defectBar} style={{ background: d.color + '22', borderLeft: `3px solid ${d.color}` }} />
                </div>
              ))}
            </div>
            <div className={s.colFootnote}>
              数据集基于 RDD2022 国际道路病害数据集，
              结合国内路面场景增量微调。
            </div>
          </div>

          {/* 右：架构占位 */}
          <div className={s.colCard}>
            <div className={s.colTitle}>系统架构图</div>
            <div className={s.archPlaceholder}>
              <div className={s.archLayers}>
                <div className={s.archLayer} style={{ borderColor: '#3E6AE1' }}>
                  <span className={s.archLayerLabel}>Presentation Layer</span>
                  <span className={s.archLayerDetail}>React 18 · AMap · ECharts</span>
                </div>
                <div className={s.archArrow}>↓ REST / JSON</div>
                <div className={s.archLayer} style={{ borderColor: '#7c3aed' }}>
                  <span className={s.archLayerLabel}>Application Layer</span>
                  <span className={s.archLayerDetail}>FastAPI · JWT · DeepSeek LLM</span>
                </div>
                <div className={s.archArrow}>↓ SQLAlchemy ORM</div>
                <div className={s.archLayer} style={{ borderColor: '#1a8045' }}>
                  <span className={s.archLayerLabel}>Data Layer</span>
                  <span className={s.archLayerDetail}>PostgreSQL · File Storage</span>
                </div>
                <div className={s.archArrow}>↓ Ultralytics PT / SAHI</div>
                <div className={s.archLayer} style={{ borderColor: '#d97706' }}>
                  <span className={s.archLayerLabel}>AI Inference Layer</span>
                  <span className={s.archLayerDetail}>LS-Det v1 · SAHI · ReID Clustering</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ══ CORE INNOVATIONS ════════════════════════════════════ */}
      <section className={s.section}>
        <SectionHeader label="SECTION 03" title="核心创新点  Core Innovations" />
        <div className={s.innovGrid}>
          {INNOVATIONS.map(v => (
            <div key={v.tag} className={s.innovCard}>
              <div className={s.innovTag}>{v.tag}</div>
              <div className={s.innovTitle}>{v.title}</div>
              <div className={s.innovDesc}>{v.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ DEVELOPMENT TEAM ════════════════════════════════════ */}
      <section className={s.section}>
        <SectionHeader label="SECTION 04" title="开发团队  Development Team" />
        <div className={s.teamGrid}>
          {TEAM.map((m, i) => (
            <div key={i} className={s.teamCard}>
              <div className={s.teamAvatar}>{m.name.charAt(0).toUpperCase()}</div>
              <div className={s.teamInfo}>
                <div className={s.teamName}>{m.name}</div>
                <div className={s.teamRole}>{m.role}</div>
                <div className={s.teamNote}>{m.note}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ FOOTER ══════════════════════════════════════════════ */}
      <div className={s.footerBlock}>
        <div className={s.footerDisclaimer}>
          <span className={s.footerTag}>DISCLAIMER</span>
          本系统为第19届中国大学生计算机设计大赛参赛作品，仅供学术研究与竞赛评审使用。
          检测结果仅作为辅助参考，实际工程决策请结合专业人工复核，开发团队不承担因依赖本系统输出而产生的任何工程责任。
        </div>
        <div className={s.footerCopy}>
          © 2026 LightScan Team · CCDC2026 · All rights reserved.
          &nbsp;·&nbsp; Build <span className={s.mono}>2026.04.16</span>
          &nbsp;·&nbsp; Model checkpoint <span className={s.mono}>lsdet_v1_best.pt</span>
        </div>
      </div>

    </div>
  );
}
