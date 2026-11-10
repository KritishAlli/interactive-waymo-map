import { useState, useRef } from 'react'

// Departure picker: a date chip that opens a month calendar and a time chip that opens
// an analog clock. Value in/out is a local "YYYY-MM-DDTHH:mm" string (same as <input type="datetime-local">).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n) => String(n).padStart(2, '0');

function parseValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  const now = new Date();
  if (!m) return { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(), h: now.getHours(), mi: now.getMinutes() };
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] };
}
const build = ({ y, mo, d, h, mi }) => `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}`;

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

function Calendar({ value, onPick }) {
  const sel = parseValue(value);
  const [view, setView] = useState({ y: sel.y, mo: sel.mo });
  const today = new Date();
  const todayKey = today.getFullYear() * 10000 + today.getMonth() * 100 + today.getDate();

  const firstDow = new Date(view.y, view.mo, 1).getDay();
  const daysInMonth = new Date(view.y, view.mo + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const shift = (delta) => {
    const dt = new Date(view.y, view.mo + delta, 1);
    setView({ y: dt.getFullYear(), mo: dt.getMonth() });
  };

  return (
    <div className="dtp-calendar">
      <div className="dtp-cal-head">
        <button type="button" className="dtp-nav" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <div className="dtp-cal-title">{MONTHS[view.mo]} {view.y}</div>
        <button type="button" className="dtp-nav" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="dtp-cal-grid">
        {WEEKDAYS.map((w, i) => <div key={i} className="dtp-weekday">{w}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const key = view.y * 10000 + view.mo * 100 + day;
          const isSel = view.y === sel.y && view.mo === sel.mo && day === sel.d;
          return (
            <button
              type="button"
              key={day}
              disabled={key < todayKey}
              className={`dtp-day${isSel ? ' selected' : ''}${key === todayKey ? ' today' : ''}`}
              onClick={() => onPick({ y: view.y, mo: view.mo, d: day })}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SIZE = 200;
const C = SIZE / 2;
const R_NUM = 70;   // numerals
const R_TICK_OUT = 95;

function polar(deg, r) {
  const rad = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) };
}

// 60 hairline ticks around the rim; every 5th is longer/darker
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0;
  const from = polar(i * 6, R_TICK_OUT - (major ? 7 : 3.5));
  const to = polar(i * 6, R_TICK_OUT);
  return { i, major, from, to };
});

function Clock({ value, onChange }) {
  const { h, mi } = parseValue(value);
  const [mode, setMode] = useState('hour'); // 'hour' | 'minute'
  const faceRef = useRef();
  const dragging = useRef(false);

  const pm = h >= 12;
  const h12 = h % 12 || 12;

  const setHour12 = (n) => onChange({ h: (n % 12) + (pm ? 12 : 0) });
  const setMinute = (n) => onChange({ mi: n });
  const setMeridiem = (toPm) => onChange({ h: (h % 12) + (toPm ? 12 : 0) });

  // pointer position -> angle (0 = 12 o'clock, clockwise) -> hour or minute
  const applyPointer = (e) => {
    const rect = faceRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    if (mode === 'hour') setHour12(Math.round(deg / 30) % 12 || 12);
    else setMinute(Math.round(deg / 6) % 60);
  };
  const onDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyPointer(e);
  };
  const onMove = (e) => { if (dragging.current) applyPointer(e); };
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (mode === 'hour') setMode('minute'); // hour chosen -> go straight to minutes
  };

  const handDeg = mode === 'hour' ? (h12 % 12) * 30 : mi * 6;
  const tip = polar(handDeg, R_NUM);
  const labels = mode === 'hour'
    ? Array.from({ length: 12 }, (_, i) => ({ text: String(i + 1), deg: (i + 1) * 30, n: i + 1 }))
    : Array.from({ length: 12 }, (_, i) => ({ text: pad(i * 5), deg: i * 30, n: i * 5 }));
  const offLabel = mode === 'minute' && mi % 5 !== 0;

  return (
    <div className="dtp-clock">
      <div className="dtp-clock-head">
        <div className="dtp-readout">
          <button type="button" className={`dtp-digit${mode === 'hour' ? ' active' : ''}`} onClick={() => setMode('hour')}>{h12}</button>
          <span className="dtp-colon">:</span>
          <button type="button" className={`dtp-digit${mode === 'minute' ? ' active' : ''}`} onClick={() => setMode('minute')}>{pad(mi)}</button>
        </div>
        <div className="dtp-segmented" role="group" aria-label="AM or PM">
          <button type="button" className={!pm ? 'active' : ''} onClick={() => setMeridiem(false)}>AM</button>
          <button type="button" className={pm ? 'active' : ''} onClick={() => setMeridiem(true)}>PM</button>
        </div>
      </div>

      <svg
        ref={faceRef}
        className="dtp-face"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={`Clock face, choose ${mode}`}
      >
        <circle cx={C} cy={C} r={C - 1} className="dtp-face-bg" />
        {TICKS.map(({ i, major, from, to }) => (
          <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={major ? 'dtp-tick major' : 'dtp-tick'} />
        ))}
        <line x1={C} y1={C} x2={tip.x} y2={tip.y} className="dtp-hand" />
        <circle cx={tip.x} cy={tip.y} r="15" className="dtp-knob" />
        {offLabel && <circle cx={tip.x} cy={tip.y} r="2.5" fill="#ffffff" />}
        <circle cx={C} cy={C} r="4.5" className="dtp-hub" />
        <circle cx={C} cy={C} r="1.6" className="dtp-hub-center" />
        <g key={mode} className="dtp-nums">
          {labels.map(({ text, deg, n }) => {
            const p = polar(deg, R_NUM);
            const active = n === (mode === 'hour' ? h12 : mi);
            return (
              <text key={text} x={p.x} y={p.y} className={`dtp-num${active ? ' active' : ''}`} textAnchor="middle" dominantBaseline="central">
                {text}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default function DateTimePicker({ value, onChange }) {
  const [open, setOpen] = useState(null); // null | 'date' | 'time'
  const { y, mo, d, h, mi } = parseValue(value);

  const update = (patch) => onChange(build({ y, mo, d, h, mi, ...patch }));
  const dateText = new Date(y, mo, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeText = `${h % 12 || 12}:${pad(mi)} ${h >= 12 ? 'PM' : 'AM'}`;
  const toggle = (which) => setOpen((cur) => (cur === which ? null : which));

  const setNow = () => {
    const n = new Date();
    onChange(build({ y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes() }));
    setOpen(null);
  };

  return (
    <div className="dtp" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }}>
      <div className="dtp-label">Departure</div>
      <div className="dtp-chips">
        <button type="button" className={`dtp-chip${open === 'date' ? ' open' : ''}`} onClick={() => toggle('date')} aria-expanded={open === 'date'}>
          <CalendarIcon /><span>{dateText}</span>
        </button>
        <button type="button" className={`dtp-chip${open === 'time' ? ' open' : ''}`} onClick={() => toggle('time')} aria-expanded={open === 'time'}>
          <ClockIcon /><span>{timeText}</span>
        </button>
        <button type="button" className="dtp-now" onClick={setNow}>Now</button>
      </div>

      {open === 'date' && (
        <div className="dtp-popover">
          <Calendar value={value} onPick={(p) => { update(p); setOpen(null); }} />
        </div>
      )}
      {open === 'time' && (
        <div className="dtp-popover">
          <Clock value={value} onChange={update} />
          <button type="button" className="dtp-done" onClick={() => setOpen(null)}>Done</button>
        </div>
      )}
    </div>
  );
}
