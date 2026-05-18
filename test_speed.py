#!/usr/bin/env python3
"""
test_speed.py — Web performance tester with sub-resource tracking.

Measures page load timings (TTFB, DOMContentLoaded, load event, content
visible) and all sub-resources (scripts, stylesheets, fonts, images, XHR).
Handles the markdown-amplified password gate natively.

Requirements:
    pip install playwright
    playwright install chromium

Usage:
    python3 test_speed.py --url URL [--password PWD] [--pass N] [--delay S]
    python3 test_speed.py --sites CSV_FILE [--output REPORT.md]

CSV format (header row required; only 'url' is mandatory):
    url,pass,delay,password
    https://www.ehlers.tv/,3,10,
    https://www.ehlers.tv/secret.md,5,60,mysecret
"""

import argparse
import asyncio
import csv
import statistics
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

try:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
except ImportError:
    sys.exit(
        "playwright is required:\n"
        "  pip install playwright\n"
        "  playwright install chromium"
    )


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class Resource:
    url: str
    res_type: str       # initiatorType from PerformanceAPI: script, css, img, font, fetch …
    status: int         # HTTP status (0 if not captured)
    start_ms: float     # relative to navigation start
    end_ms: float
    duration_ms: float
    ttfb_ms: float      # responseStart - fetchStart for this resource (0 for cross-origin w/o TAO)
    transferred: int    # encoded bytes actually sent over the wire (0 = cached / cross-origin)
    decoded: int        # decodedBodySize


@dataclass
class PassResult:
    pass_num: int
    timestamp: str
    ttfb_ms: float          # navigation TTFB
    dom_loaded_ms: float    # DOMContentLoadedEventEnd
    load_ms: float          # loadEventEnd (from Performance API)
    content_ms: Optional[float]  # wall-clock: nav start → .markdown-body visible (incl. password)
    password_used: bool
    resources: List[Resource] = field(default_factory=list)
    nav_status: int = 200
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.nav_status < 400


@dataclass
class URLConfig:
    url: str
    passes: int = 1
    delay: float = 0.0
    password: Optional[str] = None


@dataclass
class URLResult:
    config: URLConfig
    results: List[PassResult] = field(default_factory=list)

    def good(self) -> List[PassResult]:
        return [r for r in self.results if r.ok]

    def stat(self, values: List[float]) -> Optional[dict]:
        if not values:
            return None
        d = {
            'min': min(values),
            'avg': statistics.mean(values),
            'max': max(values),
        }
        if len(values) >= 2:
            d['median'] = statistics.median(values)
            d['stdev'] = statistics.stdev(values)
        if len(values) >= 5:
            d['p95'] = sorted(values)[int(len(values) * 0.95 + 0.5) - 1]
        return d


# ── JavaScript injected to read Performance timing ────────────────────────────

_JS_PERF = """() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource').map(e => ({
        name:            e.name,
        initiatorType:   e.initiatorType,
        startTime:       Math.round(e.startTime       * 10) / 10,
        responseStart:   Math.round((e.responseStart || 0) * 10) / 10,
        responseEnd:     Math.round((e.responseEnd   || 0) * 10) / 10,
        duration:        Math.round(e.duration        * 10) / 10,
        transferSize:    e.transferSize    || 0,
        decodedBodySize: e.decodedBodySize || 0,
    }));
    return {
        ttfb:      Math.round((nav.responseStart             || 0) * 10) / 10,
        domLoaded: Math.round((nav.domContentLoadedEventEnd  || 0) * 10) / 10,
        load:      Math.round((nav.loadEventEnd              || 0) * 10) / 10,
        resources: res,
    };
}"""


# ── Browser measurement ───────────────────────────────────────────────────────

async def run_pass(browser, url: str, password: Optional[str], pass_num: int) -> PassResult:
    context = await browser.new_context(
        # Disable service workers so each pass is a cold fetch
        service_workers='block',
    )
    page = await context.new_page()

    status_map: dict[str, int] = {}

    async def on_response(response):
        try:
            status_map[response.url] = response.status
        except Exception:
            pass

    page.on('response', on_response)

    ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    error = None
    pw_used = False
    content_ms: Optional[float] = None
    nav_status = 200

    try:
        wall_start = time.monotonic()

        resp = await page.goto(url, wait_until='load', timeout=30_000)
        if resp:
            nav_status = resp.status

        if password:
            try:
                # Wait for the markdown-amplified password form
                await page.wait_for_selector('input[name="password"]', timeout=3_000)
                await page.fill('input[name="password"]', password)
                await page.click('button[type="submit"]')
                await page.wait_for_selector('.markdown-body', timeout=10_000)
                content_ms = (time.monotonic() - wall_start) * 1000
                pw_used = True
            except PWTimeout:
                pass  # no password form found; page may be public

        if content_ms is None:
            try:
                await page.wait_for_selector('.markdown-body', timeout=5_000)
                content_ms = (time.monotonic() - wall_start) * 1000
            except PWTimeout:
                pass

        perf = await page.evaluate(_JS_PERF)

        resources = [
            Resource(
                url=r['name'],
                res_type=r['initiatorType'] or 'other',
                status=status_map.get(r['name'], 0),
                start_ms=r['startTime'],
                end_ms=r['responseEnd'],
                duration_ms=r['duration'],
                ttfb_ms=max(0.0, r['responseStart'] - r['startTime']),
                transferred=r['transferSize'],
                decoded=r['decodedBodySize'],
            )
            for r in perf['resources']
        ]

        return PassResult(
            pass_num=pass_num,
            timestamp=ts,
            ttfb_ms=perf['ttfb'],
            dom_loaded_ms=perf['domLoaded'],
            load_ms=perf['load'],
            content_ms=content_ms,
            password_used=pw_used,
            resources=resources,
            nav_status=nav_status,
        )

    except Exception as exc:
        return PassResult(
            pass_num=pass_num, timestamp=ts,
            ttfb_ms=0, dom_loaded_ms=0, load_ms=0,
            content_ms=None, password_used=pw_used,
            nav_status=nav_status, error=str(exc),
        )

    finally:
        await context.close()


# ── CSV parsing ───────────────────────────────────────────────────────────────

def parse_csv(path: str) -> List[URLConfig]:
    configs = []
    with open(path, newline='', encoding='utf-8') as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
        except csv.Error:
            dialect = csv.excel  # fallback

        reader = csv.DictReader(f, dialect=dialect)
        for row in reader:
            r = {k.strip().lower(): (v or '').strip() for k, v in row.items() if k}
            url = r.get('url', '')
            if not url:
                continue
            passes_raw = r.get('pass', r.get('passes', '')) or '1'
            delay_raw  = r.get('delay', r.get('delay_s', '')) or '0'
            pwd        = r.get('password', r.get('pwd', '')) or None
            try:
                passes = max(1, int(passes_raw))
            except ValueError:
                passes = 1
            try:
                delay = max(0.0, float(delay_raw))
            except ValueError:
                delay = 0.0
            configs.append(URLConfig(url=url, passes=passes, delay=delay, password=pwd))
    return configs


# ── Formatting helpers ────────────────────────────────────────────────────────

def _ms(v: Optional[float], *, dash: str = '—') -> str:
    if v is None:
        return dash
    return f'{v:,.0f} ms'

def _kb(b: int, *, dash: str = '—') -> str:
    if b == 0:
        return dash
    if b < 1024:
        return f'{b} B'
    if b < 1024 * 1024:
        return f'{b / 1024:.1f} KB'
    return f'{b / 1024 / 1024:.2f} MB'

def _short_url(url: str, max_len: int = 72) -> str:
    if len(url) <= max_len:
        return url
    return '…' + url[-(max_len - 1):]

def _stat_row(label: str, s: Optional[dict]) -> str:
    if not s:
        return f'| {label} | — | — | — | — | — | — |'
    median = _ms(s.get('median'))
    stdev  = _ms(s.get('stdev'))
    p95    = _ms(s.get('p95'))
    return (
        f'| {label} | {_ms(s["min"])} | {_ms(s["avg"])} | {median} '
        f'| {_ms(s["max"])} | {stdev} | {p95} |'
    )


# ── Report generation ─────────────────────────────────────────────────────────

def generate_report(results: List[URLResult], generated_at: str) -> str:
    lines: List[str] = []

    lines += [
        '# Performance Report',
        '',
        f'**Generated:** {generated_at}',
        '',
        '> Timings are from the browser\'s Performance API (relative to navigation start).',
        '> Each pass uses a fresh browser context with no cached resources.',
        '> **Content Visible** is wall-clock time from navigation start until the page\'s',
        '> main content element (`.markdown-body`) is rendered — includes password entry',
        '> time for protected pages.',
        '',
    ]

    # ── Summary table ─────────────────────────────────────────────────────────
    lines += [
        '## Summary',
        '',
        '| URL | Passes (OK/Total) | Avg Load | Min Load | Max Load | Avg TTFB | Resources | Transfer |',
        '|-----|-------------------|----------|----------|----------|----------|-----------|----------|',
    ]
    for ur in results:
        good = ur.good()
        load_times = [r.load_ms for r in good]
        ttfb_vals  = [r.ttfb_ms for r in good]
        total_xfer = sum(r.transferred for r in good[0].resources) if good else 0
        res_count  = len(good[0].resources) if good else 0
        lines.append(
            f'| {ur.config.url} | {len(good)}/{len(ur.results)} '
            f'| {_ms(statistics.mean(load_times) if load_times else None)} '
            f'| {_ms(min(load_times) if load_times else None)} '
            f'| {_ms(max(load_times) if load_times else None)} '
            f'| {_ms(statistics.mean(ttfb_vals) if ttfb_vals else None)} '
            f'| {res_count} | {_kb(total_xfer)} |'
        )
    lines += ['']

    # ── Per-URL detail ────────────────────────────────────────────────────────
    lines += ['---', '', '## Detailed Results', '']

    for ur in results:
        cfg  = ur.config
        good = ur.good()

        attrs = [f'{cfg.passes} pass{"es" if cfg.passes != 1 else ""}']
        if cfg.delay:
            attrs.append(f'{cfg.delay:g}s delay between passes')
        if cfg.password:
            attrs.append('password-protected')

        lines += [
            f'### {cfg.url}',
            '',
            f'**Config:** {" · ".join(attrs)}',
            '',
        ]

        # Pass timing table
        lines += [
            '#### Pass Timings',
            '',
            '| # | Timestamp | TTFB | DOMLoaded | Load | Content Visible | Resources | Status |',
            '|---|-----------|------|-----------|------|-----------------|-----------|--------|',
        ]
        for r in ur.results:
            if r.error:
                status_str = f'❌ {r.error[:50]}'
            elif r.nav_status >= 400:
                status_str = f'⚠ HTTP {r.nav_status}'
            else:
                pw_flag = ' 🔑' if r.password_used else ''
                status_str = f'✓{pw_flag}'
            lines.append(
                f'| {r.pass_num} | {r.timestamp} | {_ms(r.ttfb_ms)} '
                f'| {_ms(r.dom_loaded_ms)} | {_ms(r.load_ms)} '
                f'| {_ms(r.content_ms)} | {len(r.resources)} | {status_str} |'
            )
        lines.append('')

        # Statistics table (only for multiple good passes)
        if len(good) >= 2:
            content_times = [r.content_ms for r in good if r.content_ms is not None]
            lines += [
                '#### Statistics',
                '',
                '| Metric | Min | Avg | Median | Max | StdDev | P95 |',
                '|--------|-----|-----|--------|-----|--------|-----|',
                _stat_row('Load event',       ur.stat([r.load_ms       for r in good])),
                _stat_row('DOMContentLoaded', ur.stat([r.dom_loaded_ms for r in good])),
                _stat_row('TTFB',             ur.stat([r.ttfb_ms       for r in good])),
            ]
            if content_times:
                lines.append(_stat_row('Content visible', ur.stat(content_times)))
            lines.append('')

        if not good:
            lines += ['> ⚠ All passes failed — no resource data available.', '']
            continue

        # Resource breakdown (from first good pass as representative sample)
        first = good[0]
        resources = sorted(first.resources, key=lambda r: r.start_ms)

        total_xfer    = sum(r.transferred for r in resources)
        total_decoded = sum(r.decoded for r in resources)

        # Group by type
        by_type: dict[str, List[Resource]] = {}
        for res in resources:
            by_type.setdefault(res.res_type, []).append(res)

        lines += [
            '#### Resources — Pass 1',
            '',
            f'**{len(resources)} resources** · '
            f'Transferred: **{_kb(total_xfer)}** · '
            f'Decoded: **{_kb(total_decoded)}**',
            '',
            '**By type:**',
            '',
            '| Type | Count | Transferred | Decoded | Avg Duration | Slowest |',
            '|------|-------|-------------|---------|--------------|---------|',
        ]
        for rtype, group in sorted(by_type.items()):
            xfer    = sum(r.transferred for r in group)
            decoded = sum(r.decoded for r in group)
            avg_dur = statistics.mean(r.duration_ms for r in group)
            slowest = max(r.duration_ms for r in group)
            lines.append(
                f'| `{rtype}` | {len(group)} | {_kb(xfer)} | {_kb(decoded)} '
                f'| {_ms(avg_dur)} | {_ms(slowest)} |'
            )
        lines.append('')

        # Waterfall: all resources sorted by start time
        lines += [
            '**Resource waterfall (sorted by start time):**',
            '',
            '| # | Resource | Type | Status | Size | Start | Duration | TTFB |',
            '|---|----------|------|--------|------|-------|----------|------|',
        ]
        for i, res in enumerate(resources, 1):
            short = _short_url(res.url)
            status_cell = str(res.status) if res.status else '—'
            lines.append(
                f'| {i} | `{short}` | `{res.res_type}` | {status_cell} '
                f'| {_kb(res.transferred)} | {_ms(res.start_ms)} '
                f'| {_ms(res.duration_ms)} | {_ms(res.ttfb_ms) if res.ttfb_ms else "—"} |'
            )
        lines.append('')

        # Highlight slow resources (> 500 ms)
        slow = [r for r in resources if r.duration_ms > 500]
        if slow:
            lines += [
                f'> ⚠ **{len(slow)} slow resource{"s" if len(slow) != 1 else ""} '
                f'(> 500 ms):** '
                + ', '.join(f'`{_short_url(r.url, 50)}`' for r in
                            sorted(slow, key=lambda r: r.duration_ms, reverse=True)[:5]),
                '',
            ]

        # Errors among resources
        errors = [r for r in resources if r.status >= 400]
        if errors:
            lines += [
                f'> ❌ **{len(errors)} resource error{"s" if len(errors) != 1 else ""}:** '
                + ', '.join(
                    f'HTTP {r.status} `{_short_url(r.url, 50)}`'
                    for r in errors[:5]
                ),
                '',
            ]

    lines += [
        '---',
        '',
        '*Generated by [test_speed.py](test_speed.py)*',
        '',
    ]
    return '\n'.join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

async def main_async(configs: List[URLConfig], output: str) -> None:
    all_results: List[URLResult] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        for cfg in configs:
            prefix = (
                f'\n→ {cfg.url}  '
                f'({cfg.passes} pass{"es" if cfg.passes != 1 else ""}'
                + (f', {cfg.delay:g}s delay' if cfg.delay else '')
                + (' 🔑' if cfg.password else '')
                + ')'
            )
            print(prefix)

            ur = URLResult(config=cfg)

            for i in range(1, cfg.passes + 1):
                if i > 1 and cfg.delay > 0:
                    print(f'  ⏳ waiting {cfg.delay:g}s…', end='\r', flush=True)
                    await asyncio.sleep(cfg.delay)

                print(f'  pass {i}/{cfg.passes} … ', end='', flush=True)
                result = await run_pass(browser, cfg.url, cfg.password, i)
                ur.results.append(result)

                if result.error:
                    print(f'ERROR: {result.error}')
                else:
                    extras = ''
                    if result.content_ms and result.password_used:
                        extras = f' (content visible in {_ms(result.content_ms)} incl. unlock)'
                    elif result.content_ms:
                        extras = f' (content visible in {_ms(result.content_ms)})'
                    print(
                        f'load={_ms(result.load_ms)}, TTFB={_ms(result.ttfb_ms)}, '
                        f'{len(result.resources)} resources{extras}'
                    )

            all_results.append(ur)

        await browser.close()

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    report = generate_report(all_results, now)
    Path(output).write_text(report, encoding='utf-8')
    print(f'\n✓ Report written to: {output}')


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Web performance tester with sub-resource tracking.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            'CSV format (header row, only url required):\n'
            '  url,pass,delay,password\n'
            '  https://example.com,3,10,\n'
            '  https://protected.com,5,60,mysecret'
        ),
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--url',   metavar='URL',  help='Single URL to test')
    mode.add_argument('--sites', metavar='CSV',  help='CSV file with URLs and options')
    parser.add_argument('--password', metavar='PWD', help='Password for protected pages')
    parser.add_argument('--pass',  dest='passes', type=int, default=1, metavar='N',
                        help='Number of passes per URL (default: 1)')
    parser.add_argument('--delay', type=float, default=0.0, metavar='S',
                        help='Seconds between passes (default: 0)')
    parser.add_argument('--output', metavar='FILE',
                        help='Output .md file (default: perf_report_TIMESTAMP.md)')

    args = parser.parse_args()

    if args.output:
        output = args.output
    else:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        output = f'perf_report_{ts}.md'

    if args.url:
        configs = [URLConfig(
            url=args.url,
            passes=args.passes,
            delay=args.delay,
            password=args.password,
        )]
    else:
        try:
            configs = parse_csv(args.sites)
        except FileNotFoundError:
            sys.exit(f'CSV file not found: {args.sites}')
        except Exception as exc:
            sys.exit(f'Error reading CSV: {exc}')

        if not configs:
            sys.exit('No URLs found in CSV file.')

    asyncio.run(main_async(configs, output))


if __name__ == '__main__':
    main()
