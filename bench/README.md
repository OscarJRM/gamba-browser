# Benchmark

Measures one thing: **driver latency** with the same Playwright code. It does not measure task quality, reasoning, or reliability.

## Run

```bash
node bench/run.js
```

The script serves `fixture.html` on `127.0.0.1:8123`, warms up once per tool, then runs `BENCH_RUNS` (default 5) alternating runs. `gamba-exec` is measured from this repo; `browse` is measured only if it is on `PATH`.

## What the fixture covers

| Task | Signal |
| --- | --- |
| `ping` | process startup + connection |
| `nav-local` | navigation + lifecycle event |
| `extract-100` | evaluate a 100-node DOM query |
| `form-3-fields` | three fills, one click, one condition wait |
| `screenshot` | PNG capture |

## Results from the original run

macOS arm64, Node 22, Chrome 2026 build, alternating order, medians of 5:

| Task | CDP driver | extension relay |
| --- | ---: | ---: |
| ping | 1221 ms | 99 ms |
| nav-local | 1216 ms | 149 ms |
| extract-100 | 1209 ms | 154 ms |
| form-3-fields | 1218 ms | 902 ms |
| screenshot | 1224 ms | 255 ms |

Separate click scaling (1/3/5/10 clicks) put the marginal cost at **~36 ms** per click on CDP and **~240-280 ms** per click over the relay. Typing 197 characters cost **0.4 s vs 15.3 s** with `keyboard.type`, and **0.08 s vs 0.66 s** with `insertText`.

## Caveats

- The CDP driver reuses the open tab; the relay driver created a new tab per run.
- Different browser builds and profiles (Chrome vs Brave).
- Local fixture only; network variance is excluded on purpose.
- The relay numbers are one version of one tool, not a claim about every extension-based driver.
- No failure scenarios are measured. A reliability benchmark is still pending.
