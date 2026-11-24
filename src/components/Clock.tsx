// Thứ, ngày tháng năm và đồng hồ đang chạy (giờ Đức, Europe/Berlin)
import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'

const VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
const DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function Clock() {
  const { lang } = useLang()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return (
    <span className="clock">
      <b>{(lang === 'de' ? DE : VI)[wd]}</b>, {p.day}.{p.month}.{p.year}
      <span className="clock-time">🕒 {p.hour}:{p.minute}<span className="clock-sec">:{p.second}</span></span>
    </span>
  )
}
