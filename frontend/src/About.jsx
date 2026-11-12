// Intro, use cases and FAQ at the bottom of the panel. Plain text so search engines have
// something to index besides the map.

const USE_CASES = [
  "Compare a Waymo fare with Uber or Lyft before you ride.",
  "Check whether your home, hotel or office is inside the Waymo service area.",
  "Plan a trip around peak pricing.",
  "See how far an address is from the service area and where the nearest pickup would be.",
  "Visiting SF, LA, San Diego, Phoenix or Dallas? See where Waymo operates.",
];

const FAQ = [
  {
    q: "How much does a Waymo ride cost?",
    a: "Fares depend on distance, drive time and time of day. This calculator estimates a range from a base fare, per-mile and per-minute rates, a booking fee and a time-of-day adjustment.",
  },
  {
    q: "Is this the official Waymo price?",
    a: "No. Waymo doesn't publish its pricing formula, so these are approximations calibrated to reported fares. The Waymo app shows the real price before you book.",
  },
  {
    q: "Where does Waymo operate?",
    a: "The map shows Waymo service areas in the San Francisco Bay Area, Los Angeles, San Diego, Phoenix and Dallas.",
  },
  {
    q: "Is Waymo more expensive at certain times?",
    a: "Yes. Reported fares are highest in the late afternoon, around 4 to 6 pm, and lowest early in the morning.",
  },
  {
    q: "What if my address is outside the service area?",
    a: "The map draws a dashed line to the nearest edge of the service area and shows the distance in miles.",
  },
  {
    q: "Can I report what I paid?",
    a: "Yes. After you get an estimate, enter the fare you actually paid. Reports are used to check and improve the estimates.",
  },
];

export default function About() {
  return (
    <section className="about" aria-labelledby="about-title">
      <h2 className="section-title" id="about-title">About</h2>
      <p>
        Waymo Fare Calculator is a free, unofficial tool for estimating what a Waymo robotaxi
        ride will cost before you book. Enter a pickup and dropoff to get a fare range based on
        distance, drive time and time of day, or search any address to see whether it&apos;s
        inside a Waymo service area. If it isn&apos;t, the map shows how far it is to the
        nearest edge.
      </p>

      <h3 className="about-subtitle">What you can use it for</h3>
      <ul className="about-uses">
        {USE_CASES.map((u) => <li key={u}>{u}</li>)}
      </ul>

      <h2 className="section-title about-faq-title">FAQ</h2>
      <div className="faq">
        {FAQ.map(({ q, a }) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
