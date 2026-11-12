import { useState } from 'react'
import DateTimePicker from './DateTimePicker.jsx'

const API_URL = import.meta.env.VITE_APP_API_URL || "";
const FUTURE_SLACK_MS = 5 * 60 * 1000; // a ride can't have happened later than a few minutes from now

// "What did you pay?" form at the bottom of the fare receipt. Sends the real fare plus the
// trip it belongs to to the backend, which stores it next to the model's estimate so the
// pricing rates can be tuned against real fares. The receipt unmounts whenever the trip or
// time changes, so this resets on its own.
export default function FareReport({ estimate, departAt }) {
  const [paid, setPaid] = useState("");
  const [status, setStatus] = useState("idle"); // "idle" | "sending" | "sent" | "error" | "limited"
  const [whenMode, setWhenMode] = useState("trip"); // "trip" = the departure above | "custom"
  const [customAt, setCustomAt] = useState(departAt);

  const rideAt = whenMode === "trip" ? departAt : customAt;
  const isFuture = new Date(rideAt).getTime() > Date.now() + FUTURE_SLACK_MS;
  const amount = Number(paid);
  const validAmount = paid.trim() !== "" && Number.isFinite(amount) && amount >= 1 && amount <= 500;
  const canSubmit = validAmount && !isFuture && status !== "sending";

  const clearError = () => { if (status === "error" || status === "limited") setStatus("idle"); };

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    try {
      const res = await fetch(`${API_URL}/api/fare-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: estimate.ends.pickup.point,
          dropoff: estimate.ends.dropoff.point,
          distanceMiles: estimate.distanceMiles,
          durationMinutes: estimate.durationMinutes,
          departAt: rideAt,
          paid: amount,
        }),
      });
      if (res.status === 429) { setStatus("limited"); return; }
      if (!res.ok) throw new Error("Request failed");
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="fare-report fare-report-sent" role="status">
        Thanks! Your fare helps make these estimates more accurate.
      </div>
    );
  }

  let hint = "Anonymous; only used to improve estimates.";
  if (status === "error") hint = "Couldn't send that. Please try again.";
  else if (status === "limited") hint = "You've sent a lot of fares recently. Please try again later.";
  else if (isFuture) hint = whenMode === "trip"
    ? "The trip time above is in the future. Pick when you actually rode."
    : "That time is in the future. Pick when you actually rode.";

  return (
    <form className="fare-report" onSubmit={submit}>
      <label className="fare-report-label" htmlFor="fare-report-paid">
        Took this ride? What did you pay?
      </label>

      <div className="mode-toggle fare-when-toggle" role="radiogroup" aria-label="When you rode" data-mode={whenMode}>
        <button
          type="button"
          role="radio"
          aria-checked={whenMode === "trip"}
          className={`mode-tab ${whenMode === "trip" ? "active" : ""}`}
          onClick={() => { setWhenMode("trip"); clearError(); }}
        >
          Trip time
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={whenMode === "custom"}
          className={`mode-tab ${whenMode === "custom" ? "active" : ""}`}
          onClick={() => { setWhenMode("custom"); clearError(); }}
        >
          Another time
        </button>
      </div>

      {whenMode === "custom" && (
        <DateTimePicker label="Ride time" value={customAt} onChange={(v) => { setCustomAt(v); clearError(); }} />
      )}

      <div className="fare-report-row">
        <div className="fare-report-input">
          <span aria-hidden="true">$</span>
          <input
            id="fare-report-paid"
            type="number"
            inputMode="decimal"
            min="1"
            max="500"
            step="0.01"
            placeholder="0.00"
            value={paid}
            onChange={(e) => { setPaid(e.target.value); clearError(); }}
          />
        </div>
        <button type="submit" className="button fare-report-button" disabled={!canSubmit}>
          {status === "sending" ? "Sending…" : "Submit"}
        </button>
      </div>
      <p
        className={`fare-report-hint${status === "error" || status === "limited" || isFuture ? " error" : ""}`}
        role={status === "error" || status === "limited" ? "alert" : undefined}
      >
        {hint}
      </p>
    </form>
  );
}
