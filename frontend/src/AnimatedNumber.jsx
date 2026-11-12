import { useEffect, useRef, useState } from 'react'
import { tween } from './animations.js'

// counts up from the previous value (0 on first render) to `value`
export default function AnimatedNumber({ value, duration = 900, format = (n) => n.toFixed(0) }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const cancel = tween(duration, (t) => setShown(from + (value - from) * t));
    return () => { cancel(); fromRef.current = value; };
  }, [value, duration]);

  return <>{format(shown)}</>;
}
