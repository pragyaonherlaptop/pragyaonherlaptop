#!/usr/bin/env node
// Builds assets/galaxy.svg (repos as planets) and assets/stack.svg (skills as constellations),
// then refreshes the marked sections of README.md.
//
//   node scripts/generate.mjs          real data (needs GH_USER and GH_TOKEN)
//   node scripts/generate.mjs --mock   fake data, for trying it on your computer

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const USER = process.env.GH_USER || 'your-username';
const TOKEN = process.env.GH_TOKEN || '';
const MOCK = process.argv.includes('--mock');
const INCLUDE_PRIVATE = process.env.INCLUDE_PRIVATE === '1'; // private repo names become public if you turn this on
const MAX_PLANETS = 8;
const W = 854;
const H = 440;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
// Two looks: one for GitHub's dark theme, one for its light theme.
// `T` is whichever look is being drawn right now (see the bottom of the file).
const THEMES = {
  dark: {
    bg: '#0d1117',
    border: '#30363d',
    text: '#e6edf3',
    muted: '#9da7b3',
    star: '#ffffff',
    glow: 0.28,
    shade: [0, 0.1, 0.6, 0.92],
    rim: 0.2,
    orbit: (c) => lighten(c, 0.7),
    ring: (c, t) => lighten(c, t),
  },
  light: {
    bg: '#ffffff',
    border: '#d0d7de',
    text: '#1f2328',
    muted: '#656d76',
    star: '#8c959f',
    glow: 0.18,
    shade: [0, 0.06, 0.4, 0.68],
    rim: 0,
    orbit: (c) => darken(c, 0.1),
    ring: (c, t) => darken(c, Math.max(0, 0.3 - t * 0.5)),
  },
};
let T = THEMES.dark;

/* ---------- small helpers ---------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (const c of str) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
function hex2rgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex(rgb) {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const A = hex2rgb(a);
  const B = hex2rgb(b);
  return rgb2hex(A.map((v, i) => v + (B[i] - v) * t));
}
const lighten = (c, t) => mix(c, '#ffffff', t);
const darken = (c, t) => mix(c, '#000000', t);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function luminance(hex) {
  const [r, g, b] = hex2rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
const FALLBACK_COLORS = ['#e0a05a', '#5cc7e6', '#b392f0', '#7ee787', '#f08aa8', '#e8c33c', '#79b8ff'];

/* ---------- data ---------- */

async function fetchData() {
  if (MOCK) {
    return {
      total: 223,
      repos: [
        { name: 'Orchestrix', commits: 96, language: 'TypeScript', color: '#3178c6' },
        { name: 'WealthWise', commits: 64, language: 'Python', color: '#3572A5' },
        { name: 'pocket', commits: 31, language: 'JavaScript', color: '#f1e05a' },
        { name: 'schrodingers-gambit', commits: 22, language: 'Rust', color: '#dea584' },
        { name: 'BreezeNow', commits: 14, language: 'HTML', color: '#e34c26' },
        { name: 'SkillSync', commits: 9, language: 'Go', color: '#00ADD8' },
        { name: 'Liminal', commits: 6, language: 'Shell', color: '#89e051' },
        { name: '4ren', commits: 3, language: 'CSS', color: '#563d7c' },
      ],
    };
  }
  if (!TOKEN) throw new Error('GH_TOKEN is missing');
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(to.getFullYear() - 1);
  const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){
      contributionsCollection(from:$from,to:$to){
        contributionCalendar{ totalContributions }
        commitContributionsByRepository(maxRepositories:100){
          repository{ name isPrivate primaryLanguage{ name color } }
          contributions{ totalCount }
        }
      }
    }
  }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'galaxy-readme' },
    body: JSON.stringify({ query, variables: { login: USER, from: from.toISOString(), to: to.toISOString() } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error('GitHub API error: ' + JSON.stringify(json.errors || res.status));
  const c = json.data.user.contributionsCollection;
  const repos = c.commitContributionsByRepository
    .filter((r) => (INCLUDE_PRIVATE || !r.repository.isPrivate) && r.repository.name !== USER)
    .map((r) => ({
      name: r.repository.name,
      commits: r.contributions.totalCount,
      language: r.repository.primaryLanguage?.name || null,
      color: r.repository.primaryLanguage?.color || null,
    }));
  return { total: c.contributionCalendar.totalContributions, repos };
}

/* ---------- planets ---------- */

function prepare(repos) {
  const top = [...repos].sort((a, b) => b.commits - a.commits).slice(0, MAX_PLANETS);
  const max = Math.max(1, ...top.map((r) => r.commits));
  return top.map((r, i) => {
    const h = hash(r.name);
    let color = r.color || FALLBACK_COLORS[h % FALLBACK_COLORS.length];
    if (luminance(color) < 0.3) color = lighten(color, 0.3);
    const types = ['gas', 'ice', 'rocky', 'earth'];
    const radius = 18 + 46 * Math.sqrt(r.commits / max);
    return {
      ...r,
      color,
      r: radius,
      type: i === 0 ? 'gas' : types[h % types.length],
      ring: i === 0 || (h % 5 === 0 && radius > 26),
      moon: h % 3 === 0,
    };
  });
}

function hit(a, b) {
  const cc = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r;
  const cr = (c, r) => {
    const nx = clamp(c.x, r.x0, r.x1);
    const ny = clamp(c.y, r.y0, r.y1);
    return Math.hypot(c.x - nx, c.y - ny) < c.r;
  };
  const rr = (p, q) => p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0;
  return cc(a.c, b.c) || cr(a.c, b.rc) || cr(b.c, a.rc) || rr(a.rc, b.rc);
}

function layout(items) {
  const rnd = rng(42);
  const placed = [];
  for (const it of items) {
    let scale = 1;
    let ok = false;
    while (!ok && scale > 0.45) {
      const r = it.r * scale;
      const fp = it.ring ? r * 2.15 : r * 1.5 + 12;
      const lw = Math.max(it.name.length * 8, 80) / 2;
      const edge = Math.max(fp, lw) + 10; // keeps both the planet and its label inside the picture
      for (let a = 0; a < 2000 && !ok; a++) {
        const x = edge + rnd() * (W - 2 * edge);
        const y = fp + 10 + rnd() * Math.max(1, H - 2 * fp - 56);
        const shape = { c: { x, y, r: fp }, rc: { x0: x - lw, x1: x + lw, y0: y + r + 2, y1: y + r + 38 } };
        if (placed.every((p) => !hit(shape, p.shape))) {
          placed.push({ ...it, x, y, r, shape });
          ok = true;
        }
      }
      scale *= 0.92;
    }
    if (!ok) console.warn('could not place', it.name);
  }
  return placed;
}

function planetSVG(p, i) {
  const id = `p${i}`;
  const { x, y, r, color, type } = p;
  const rnd = rng(hash(p.name));
  const seed = (hash(p.name) % 90) + 1;
  const light = lighten(color, 0.5);
  const dark = darken(color, 0.5);
  let defs = '';
  let body = '';

  const bandFilter = (freq, oct, slope, intercept) => `
<filter id="${id}f" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" result="n"/>
<feColorMatrix in="n" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="g"/>
<feComponentTransfer in="g" result="g2"><feFuncR type="linear" slope="${slope}" intercept="${intercept}"/><feFuncG type="linear" slope="${slope}" intercept="${intercept}"/><feFuncB type="linear" slope="${slope}" intercept="${intercept}"/></feComponentTransfer>
<feBlend in="g2" in2="SourceGraphic" mode="multiply" result="b"/>
<feComposite in="b" in2="SourceGraphic" operator="in"/>
</filter>`;

  if (type === 'gas' || type === 'ice') {
    const base = type === 'ice' ? lighten(color, 0.25) : color;
    const stops = Array.from({ length: 8 }, (_, k) => {
      const c = k % 2 ? mix(base, dark, 0.2 + rnd() * 0.35) : mix(base, lighten(base, 0.6), 0.1 + rnd() * 0.5);
      return `<stop offset="${(k / 7).toFixed(2)}" stop-color="${c}"/>`;
    }).join('');
    defs += `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>` + bandFilter('0.004 0.07', 4, 1.8, 0.05);
    body = `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}g)" filter="url(#${id}f)"/>`;
    if (type === 'gas' && r > 30) {
      body += `<ellipse cx="${x + r * 0.28}" cy="${y + r * 0.3}" rx="${r * 0.2}" ry="${r * 0.11}" fill="${darken(color, 0.45)}" opacity="0.55" filter="url(#blurS)"/>`;
    }
  } else if (type === 'rocky') {
    defs +=
      `<radialGradient id="${id}g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${light}"/><stop offset="0.6" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></radialGradient>` +
      bandFilter('0.05', 5, 2.2, -0.2);
    body = `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}g)" filter="url(#${id}f)"/>`;
  } else {
    const ocean = mix(color, '#2b6fd6', 0.55);
    defs += `<radialGradient id="${id}g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${lighten(ocean, 0.25)}"/><stop offset="1" stop-color="${darken(ocean, 0.35)}"/></radialGradient>
<filter id="${id}l" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="4" seed="${seed}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.58  0 0 0 0 0.32  14 0 0 0 -7.2" result="land"/><feComposite in="land" in2="SourceGraphic" operator="in"/></filter>
<filter id="${id}c" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="5" seed="${seed + 5}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  5 0 0 0 -2.1" result="c"/><feComposite in="c" in2="SourceGraphic" operator="in"/></filter>`;
    body =
      `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}g)"/>` +
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#3f8f52" filter="url(#${id}l)"/>` +
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="0.8" filter="url(#${id}c)"/>`;
  }

  // lighting, glow and atmosphere
  const lit =
    `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#shade)"/>` + `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#rim)"/>`;
  const glow = `<circle cx="${x}" cy="${y}" r="${r * 1.08}" fill="${color}" opacity="${T.glow}" filter="url(#blur)"/>`;

  // rings: back half behind the planet, front half over it
  let ringBack = '';
  let ringFront = '';
  if (p.ring) {
    const tilt = Math.round(rnd() * 30 - 15);
    defs += `<clipPath id="${id}b"><rect x="${x - r * 3}" y="${y - r * 3}" width="${r * 6}" height="${r * 3}"/></clipPath><clipPath id="${id}t"><rect x="${x - r * 3}" y="${y}" width="${r * 6}" height="${r * 3}"/></clipPath>`;
    const bands = [
      [1.5, 0.07, T.ring(color, 0.35), 0.5],
      [1.72, 0.13, T.ring(color, 0.6), 0.75],
      [2.0, 0.05, T.ring(color, 0), 0.55],
    ];
    const ring = (clip, k) =>
      `<g transform="rotate(${tilt} ${x} ${y})" fill="none"><g clip-path="url(#${id}${clip})">` +
      bands
        .map(([m, sw, c, o]) => `<ellipse cx="${x}" cy="${y}" rx="${(r * m).toFixed(1)}" ry="${(r * m * 0.2).toFixed(1)}" stroke="${c}" stroke-width="${(r * sw).toFixed(1)}" opacity="${(o * k).toFixed(2)}"/>`)
        .join('') +
      '</g></g>';
    ringBack = ring('b', 0.75);
    ringFront = ring('t', 1);
  }

  // commits as little stars orbiting the planet, plus an optional moon
  const n = Math.min(p.commits, 14);
  let orbit = '';
  for (let k = 0; k < n; k++) {
    const ang = rnd() * Math.PI * 2;
    const d = (p.ring ? r * 2.2 : r * 1.3) + rnd() * r * 0.4 + 6;
    const sr = (0.9 + rnd() * 1.1).toFixed(1);
    orbit += `<circle cx="${(x + Math.cos(ang) * d).toFixed(1)}" cy="${(y + Math.sin(ang) * d).toFixed(1)}" r="${sr}" fill="${T.orbit(color)}"/>`;
  }
  const spin = (dur, extra) =>
    `<g>${extra}<animateTransform attributeName="transform" type="rotate" from="0 ${x} ${y}" to="360 ${x} ${y}" dur="${dur}s" repeatCount="indefinite"/></g>`;
  let moon = '';
  if (p.moon) {
    const md = (p.ring ? r * 2.3 : r * 1.55) + 6;
    moon = spin(
      (28 + rnd() * 20).toFixed(0),
      `<circle cx="${(x + md).toFixed(1)}" cy="${y}" r="${(r * 0.13).toFixed(1)}" fill="#d9d2ee"/><circle cx="${(x + md).toFixed(1)}" cy="${y}" r="${(r * 0.13).toFixed(1)}" fill="url(#shade)"/>`
    );
  }

  const labelY = y + r + 18;
  const label =
    `<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${T.text}">${esc(p.name)}</text>` +
    `<text x="${x.toFixed(1)}" y="${(labelY + 15).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${T.muted}">${p.commits} commits${p.language ? ' · ' + esc(p.language) : ''}</text>`;

  return `<defs>${defs}</defs>${glow}${ringBack}${body}${lit}${ringFront}${spin(90 + (i % 3) * 25, orbit)}${moon}${label}`;
}

function galaxySVG(planets, total, date) {
  const rnd = rng(7);
  let stars = '';
  const n = clamp(Math.round(50 + total / 2), 60, 220);
  for (let i = 0; i < n; i++) {
    const x = (rnd() * W).toFixed(1);
    const y = (rnd() * H).toFixed(1);
    const r = (0.5 + rnd() * 1.1).toFixed(1);
    if (rnd() < 0.22) {
      stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="${T.star}"><animate attributeName="opacity" values="1;0.2;1" dur="${(2 + rnd() * 4).toFixed(1)}s" begin="${(rnd() * 4).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
    } else {
      stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="${T.star}" opacity="${(0.35 + rnd() * 0.65).toFixed(2)}"/>`;
    }
  }
  const common = `<defs>
<filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="blurS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
<radialGradient id="shade" cx="30%" cy="28%" r="82%"><stop offset="0" stop-color="#000" stop-opacity="${T.shade[0]}"/><stop offset="0.45" stop-color="#000" stop-opacity="${T.shade[1]}"/><stop offset="0.75" stop-color="#000" stop-opacity="${T.shade[2]}"/><stop offset="1" stop-color="#000" stop-opacity="${T.shade[3]}"/></radialGradient>
<radialGradient id="rim" cx="50%" cy="50%" r="50%"><stop offset="0.82" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="${T.rim}"/></radialGradient>
</defs>`;
  const empty = planets.length
    ? ''
    : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${T.muted}">no commits yet this year, the galaxy is waiting</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Repositories drawn as planets, sized by commit count">
<rect width="${W}" height="${H}" rx="10" fill="${T.bg}" stroke="${T.border}"/>
${common}
${stars}
${empty}
${planets.map(planetSVG).join('\n')}
<text x="${W - 14}" y="${H - 12}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${T.muted}">updated ${date}</text>
</svg>
`;
}

/* ---------- tech stack constellations ---------- */

function stackSVG(config, date) {
  const SH = 330;
  const groups = config.groups;
  const colW = W / groups.length;
  const rnd = rng(99);
  let bg = '';
  for (let i = 0; i < 40; i++) bg += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * SH).toFixed(0)}" r="${(0.5 + rnd()).toFixed(1)}" fill="#fff" opacity="${(0.3 + rnd() * 0.6).toFixed(2)}"/>`;
  let out = '';
  groups.forEach((g, gi) => {
    const cx = colW * gi + colW / 2;
    const cy = 150;
    const k = Math.min(g.skills.length, 8);
    const pts = g.skills.slice(0, k).map((name, i) => {
      const a = (i / k) * Math.PI * 2 + (rnd() - 0.5) * 0.5 - Math.PI / 2;
      const rx = colW * (0.2 + rnd() * 0.06);
      const ry = 75 + rnd() * 25;
      let x = cx + Math.cos(a) * rx;
      const tw = name.length * 7.6 + 20; // room the label needs beside its star
      // keep each label inside its own column so neighbours never collide
      if (x < cx - 4) x = Math.max(x, colW * gi + tw + 6);
      else x = Math.min(x, colW * (gi + 1) - tw - 6);
      return { name, x, y: cy + Math.sin(a) * ry };
    });
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const chord = pts.length > 3 ? `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)}` : '';
    out += `<path d="${path} ${chord}" stroke="${g.color}" stroke-width="1" opacity="0.5" fill="none"/>`;
    pts.forEach((p, i) => {
      const left = p.x < cx - 4;
      const big = i % 2 ? 5 : 6;
      out += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${big + 4}" fill="${g.color}" opacity="0.15"/>`;
      out += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${big}" fill="${lighten(g.color, 0.7)}"><animate attributeName="opacity" values="1;0.45;1" dur="${(2.5 + rnd() * 3).toFixed(1)}s" begin="${(rnd() * 3).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
      out += `<text x="${(p.x + (left ? -12 : 12)).toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="${left ? 'end' : 'start'}" font-family="${FONT}" font-size="12" fill="${T.text}">${esc(p.name)}</text>`;
    });
    out += `<text x="${cx.toFixed(1)}" y="${SH - 28}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${g.color}">${esc(g.name)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SH}" viewBox="0 0 ${W} ${SH}" role="img" aria-label="Skills drawn as constellations">
<rect width="${W}" height="${SH}" rx="10" fill="${T.bg}" stroke="${T.border}"/>
${bg}
${out}
</svg>
`;
}

/* ---------- README refresh ---------- */

function replaceBetween(text, tag, content, inline = false) {
  const re = new RegExp(`(<!-- ${tag}:START -->)[\\s\\S]*?(<!-- ${tag}:END -->)`);
  const gap = inline ? '' : '\n';
  return text.replace(re, (m, a, b) => `${a}${gap}${content}${gap}${b}`);
}

function updateReadme(planets, date) {
  const file = path.join(ROOT, 'README.md');
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  const list = planets.length
    ? planets
        .map((p) => `<a href="https://github.com/${USER}/${p.name}"><b>${esc(p.name)}</b></a> · ${p.commits} commits${p.language ? ' · ' + esc(p.language) : ''}`)
        .join('<br>\n')
    : 'no planets yet';
  text = replaceBetween(text, 'PLANETS', `<sub>\n${list}\n</sub>`);
  text = replaceBetween(text, 'UPDATED', date, true);
  const stamp = date.replace(/-/g, '');
  text = text.replace(/assets\/(galaxy-light|galaxy|stack)\.svg(\?v=\d+)?/g, (m, n) => `assets/${n}.svg?v=${stamp}`);
  fs.writeFileSync(file, text);
}

/* ---------- run ---------- */

const { repos, total } = await fetchData();
const planets = layout(prepare(repos));
const date = new Date().toISOString().slice(0, 10);
fs.mkdirSync(ASSETS, { recursive: true });
T = THEMES.dark;
fs.writeFileSync(path.join(ASSETS, 'galaxy.svg'), galaxySVG(planets, total, date));
T = THEMES.light;
fs.writeFileSync(path.join(ASSETS, 'galaxy-light.svg'), galaxySVG(planets, total, date));
T = THEMES.dark;

const skillsFile = path.join(ROOT, 'config', 'skills.json');
if (fs.existsSync(skillsFile)) {
  fs.writeFileSync(path.join(ASSETS, 'stack.svg'), stackSVG(JSON.parse(fs.readFileSync(skillsFile, 'utf8')), date));
}
updateReadme(planets, date);
console.log(`done: ${planets.length} planets, ${total} contributions`);
