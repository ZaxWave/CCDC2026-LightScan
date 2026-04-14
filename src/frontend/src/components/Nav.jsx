import s from './Nav.module.css'
export default function Nav() {
  return (
    <nav className={s.nav}>
      <a className={s.brand} href="#">LIGHTSCAN</a>
      <div className={s.links}><a href="#">检测</a><a href="#">关于</a></div>
    </nav>
  )
}
