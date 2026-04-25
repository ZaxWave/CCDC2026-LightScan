export function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.35)
    // second short beep
    const osc2 = ctx.createOscillator()
    osc2.connect(gain)
    osc2.type = 'sine'
    osc2.frequency.value = 1100
    gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.15)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc2.start(ctx.currentTime + 0.15)
    osc2.stop(ctx.currentTime + 0.45)
  } catch {}
}

export async function notifyDone(title, body) {
  playBeep()
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icon-192.svg' })
  }
}
