import { useTaskCenter } from '../context/TaskContext'
import s from './TaskCenterDrawer.module.css'

const MODE_LABEL = { gps: 'GPS', ocr: 'OCR', timed: '估算' }

const STATUS = {
  queued:     { text: '排队中',  cls: 'queued'     },
  processing: { text: '处理中',  cls: 'processing' },
  done:       { text: '已完成',  cls: 'done'       },
  failed:     { text: '失败',    cls: 'failed'     },
}

function fmtElapsed(from) {
  const total = Math.floor((Date.now() - from) / 1000)
  const m = Math.floor(total / 60)
  return m > 0 ? `${m}分${total % 60}秒` : `${total}秒`
}

function TaskRow({ task, onViewRecords, onClose }) {
  const st = STATUS[task.status] || STATUS.queued
  const isActive = task.status === 'queued' || task.status === 'processing'

  return (
    <div className={s.item}>
      <div className={s.itemTop}>
        <span className={s.fname} title={task.filename}>{task.filename}</span>
        <span className={s.modeBadge}>{MODE_LABEL[task.mode] || task.mode}</span>
      </div>
      <div className={s.itemBot}>
        <span className={`${s.dot} ${s[st.cls]}`} />
        <span className={`${s.stText} ${s[st.cls]}`}>{st.text}</span>
        {task.status === 'processing' && task.frames_done > 0 &&
          <span className={s.sub}>· 已完成 {task.frames_done} 帧</span>}
        {isActive &&
          <span className={s.sub}>· 用时 {fmtElapsed(task.submittedAt)}</span>}
        {task.status === 'failed' && task.error &&
          <span className={s.errMsg} title={task.error}>· {task.error.slice(0, 45)}</span>}
        {task.status === 'done' && (
          <button className={s.viewBtn} onClick={() => { onViewRecords(); onClose() }}>
            查看记录
          </button>
        )}
      </div>
    </div>
  )
}

export default function TaskCenterDrawer({ open, onClose, onViewRecords }) {
  const { tasks, clearDone } = useTaskCenter()
  const hasDone = tasks.some(t => t.status === 'done' || t.status === 'failed')

  if (!open) return null

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <div className={s.drawer}>
        <div className={s.header}>
          <span className={s.title}>任务中心</span>
          <div className={s.hRight}>
            {hasDone && (
              <button className={s.clearBtn} onClick={clearDone}>清除已完成</button>
            )}
            <button className={s.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        {tasks.length === 0
          ? <div className={s.empty}>暂无视频处理任务</div>
          : (
            <div className={s.list}>
              {tasks.map(t => (
                <TaskRow key={t.id} task={t} onViewRecords={onViewRecords} onClose={onClose} />
              ))}
            </div>
          )
        }
      </div>
    </>
  )
}
