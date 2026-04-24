import { useRef, useState, forwardRef, useImperativeHandle } from 'react'
import s from './UploadArea.module.css'

const UploadArea = forwardRef(function UploadArea({ accept, multiple, onFiles, title, hint }, ref) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => inputRef.current?.click()
  }))

  function handleDrop(e) {
    e.preventDefault(); setOver(false)
    const files = [...e.dataTransfer.files]
    if (files.length) onFiles(files)
  }
  function handleChange(e) {
    const files = [...e.target.files]
    if (files.length) onFiles(files)
    e.target.value = ''
  }
  return (
    <div className={`${s.area} ${over ? s.over : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}>
      <svg className={s.icon} viewBox="0 0 44 44" fill="none">
        <path d="M22 28V16M22 16L17 21M22 16L27 21" stroke="#393C41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 32H32M8 24C8 17.373 13.373 12 20 12H24C30.627 12 36 17.373 36 24" stroke="#393C41" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <h3>{title || '拖拽文件到此处'}</h3>
      <p>{hint || '点击或拖拽上传'}</p>
      <button className={s.btn} onClick={e => { e.stopPropagation(); inputRef.current.click() }}>选择文件</button>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }} onChange={handleChange} />
    </div>
  )
})

export default UploadArea
