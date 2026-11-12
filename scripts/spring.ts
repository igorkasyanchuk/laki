// V14: a spring's step response as CSS linear() points, for styles.css' --spring and --spring-soft (run once, the
// values pasted there): node --experimental-strip-types scripts/spring.ts
// x(t) = 1 - e^(-ζωt)(cos ω_d t + ζω/ω_d sin ω_d t), ζ < 1 (critically damped: 1 - e^(-ωt)(1 + ωt)), sampled evenly
// over ms, rounded to 3 places; a point on the line between its neighbors is dropped, the others keep their time (%)
function spring(zeta: number, omega: number, ms: number, n = 40) {
  const x = (t: number) => {
    if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t)
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
  }
  const pts = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : +x(((i / n) * ms) / 1000).toFixed(3)))
  const keep = pts.map((p, i) => [p, i] as const).filter(([p, i]) => i === 0 || i === n || Math.abs(pts[i - 1] + pts[i + 1] - 2 * p) > 0.0005)
  return `linear(${keep.map(([p, i]) => (i === 0 || i === n ? p : `${p} ${+((i / n) * 100).toFixed(1)}%`)).join(', ')})`
}
console.log(`--spring: ${spring(0.55, 16, 600)}; /* ζ 0.55, ω 16: a visible overshoot, 600 ms */`)
console.log(`--spring-soft: ${spring(1, 22, 350)}; /* ζ 1 (critically damped), ω 22: no overshoot, 350 ms */`)
