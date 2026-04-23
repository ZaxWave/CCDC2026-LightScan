import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { pollVideoStatus } from '../api/client'

const TaskCtx = createContext(null)
const STORAGE_KEY = 'ls_video_tasks'
const POLL_MS = 3000
const MAX_KEEP = 30

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

export function TaskProvider({ children }) {
  const [tasks, setTasks] = useState(load)
  const tasksRef = useRef(tasks)
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_KEEP)))
  }, [tasks])

  const update = useCallback((id, patch) =>
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)), [])

  const addTask = useCallback((id, filename, mode) =>
    setTasks(prev => [{
      id, filename, mode,
      status: 'queued', frames_done: 0,
      submittedAt: Date.now(), completedAt: null, error: null,
    }, ...prev]), [])

  const clearDone = useCallback(() =>
    setTasks(prev => prev.filter(t => t.status !== 'done' && t.status !== 'failed')), [])

  // Poll all active tasks
  useEffect(() => {
    const active = tasks.filter(t => t.status === 'queued' || t.status === 'processing')
    if (!active.length) return

    const timer = setInterval(async () => {
      for (const task of active) {
        try {
          const data = await pollVideoStatus(task.id)
          if (data.status === 'done') {
            update(task.id, { status: 'done', completedAt: Date.now() })
          } else if (data.status === 'failed') {
            update(task.id, { status: 'failed', error: data.error, completedAt: Date.now() })
          } else {
            update(task.id, { status: data.status, frames_done: data.frames_done || 0 })
          }
        } catch (e) {
          if (e.message?.includes('404') || e.message?.includes('不存在')) {
            update(task.id, { status: 'failed', error: '服务已重启，任务已失效' })
          }
        }
      }
    }, POLL_MS)

    return () => clearInterval(timer)
  }, [tasks, update])

  return <TaskCtx.Provider value={{ tasks, addTask, clearDone }}>{children}</TaskCtx.Provider>
}

export function useTaskCenter() {
  const ctx = useContext(TaskCtx)
  if (!ctx) throw new Error('useTaskCenter must be inside TaskProvider')
  return ctx
}
