import s from './Hero.module.css'
export default function Hero({ onImageClick, onVideoClick }) {
  return (
    <section className={s.hero}>
      <div className={s.tag}>道路病害智能巡检系统</div>
      <h1 className={s.title}>轻巡智维 LightScan</h1>
      <p className={s.sub}>基于轻量化 YOLO 模型，一键识别路面裂缝、坑槽、修补等病害类型</p>
      <div className={s.actions}>
        <button className={s.btnPrimary} onClick={onImageClick}>上传图像检测</button>
        <button className={s.btnSecondary} onClick={onVideoClick}>上传视频检测</button>
      </div>
    </section>
  )
}
