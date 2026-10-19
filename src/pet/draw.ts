// Procedural Nudgling: one look per growth level 0..66 (one level per completed rep at target 66).
// Pure and deterministic. SMIL animation only (no CSS, fonts, scripts, external refs), like assets/*.svg.
// Every animation loops in 4s, so a 4s GIF loops seamlessly.
import type { Mood } from "../core/types.js";

export const MAX_LEVEL = 66;
const STAGE_AT = [0, 1, 7, 21, 42, 66]; // egg, cracked, hatchling, child, teen, adult

const C = {
  line: "#5B4036",
  body: "#FFFDF8",
  shell: "#FFF4E6",
  blush: "#FFAEB6",
  eye: "#3E2C26",
  leaf: "#B5E0A8",
  mint: "#D3ECD6",
  peach: "#FFD7C4",
  earIn: "#FFD3D8",
  petal: "#FFC2D1",
  gold: "#FFD97A",
};
const W = 3.2; // outline width
const EASE = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"';

/** A level that shows each stage well, used for the six sleepy GIFs. */
export const SLEEPY_LEVEL = [0, 3, 14, 30, 52, 66];

export function stageOf(level: number): number {
  let s = 0;
  STAGE_AT.forEach((at, i) => level >= at && (s = i));
  return s;
}

/** 0..1 progress through the current stage. */
function progress(level: number): number {
  const s = stageOf(level);
  if (s >= 5) return 1;
  return (level - STAGE_AT[s]) / (STAGE_AT[s + 1] - STAGE_AT[s]);
}

const n = (x: number) => +x.toFixed(2);

function bob(amp: number, inner: string): string {
  return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-amp};0 0" dur="2s" repeatCount="indefinite" ${EASE}/>${inner}</g>`;
}

function face(y: number, mood: Mood, size = 1): string {
  const ex = 13 * size;
  const blink = `<animate attributeName="ry" values="5;5;0.6;5;5" keyTimes="0;0.86;0.9;0.94;1" dur="4s" repeatCount="indefinite"/>`;
  const eyes =
    mood === "sleepy"
      ? [-ex, ex].map((x) => `<path d="M${n(x - 4.5)},${n(y)} q4.5,3.5 9,0" fill="none" stroke="${C.eye}" stroke-width="2.6" stroke-linecap="round"/>`).join("")
      : [-ex, ex]
          .map(
            (x) =>
              `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(4 * size)}" ry="5" fill="${C.eye}">${blink}</ellipse>` +
              `<circle cx="${n(x + 1.4)}" cy="${n(y - 2)}" r="${mood === "sparkle" ? 1.9 : 1.4}" fill="#FFFFFF"/>`,
          )
          .join("");
  const blush = [-1, 1]
    .map((d) => `<ellipse cx="${n(d * 23 * size)}" cy="${n(y + 9)}" rx="${n(9 * size)}" ry="5.5" fill="${C.blush}" opacity="0.8" filter="url(#soft)"/>`)
    .join("");
  const mouth = `<path d="M${n(-4.5)},${n(y + 7)} q2.25,3 4.5,0 q2.25,3 4.5,0" fill="none" stroke="${C.line}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return blush + eyes + mouth;
}

/** Sprout on the head: longer stem and more leaves as the level grows; a flower at adult. */
function sprout(level: number, x: number, y: number, mood: Mood = "normal"): string {
  const len = 12 + level * 0.32;
  const leaves = Math.min(6, 1 + Math.floor(level / 10));
  const leaf = (side: number, at: number, k: number) =>
    `<path transform="translate(0,${n(-at)}) scale(${n(side * k)},${n(k)})" d="M0,0 C6,-10 18,-11 21,-3 C14,3 5,3 0,0 Z" fill="${C.leaf}" stroke="${C.line}" stroke-width="${n(2.4 / k)}" stroke-linejoin="round"/>`;
  let parts = `<path d="M0,0 Q1.5,${n(-len / 2)} 0,${n(-len)}" fill="none" stroke="${C.line}" stroke-width="2.8" stroke-linecap="round"/>`;
  // two leaves at the tip, extra small ones down the stem
  parts += leaf(-1, len, 0.95) + leaf(1, len + 1, 1.05);
  for (let i = 1; i < leaves; i++) parts += leaf(i % 2 ? 1 : -1, len * (1 - i * 0.16), 0.62);
  if (level >= MAX_LEVEL) {
    const petals = [0, 72, 144, 216, 288]
      .map((a) => `<ellipse cx="0" cy="-6" rx="4.6" ry="6.4" fill="${C.petal}" stroke="${C.line}" stroke-width="1.8" transform="rotate(${a})"/>`)
      .join("");
    parts += `<g transform="translate(0,${n(-len - 9)})">${petals}<circle r="3.6" fill="${C.gold}" stroke="${C.line}" stroke-width="1.6"/></g>`;
  }
  const sway = mood === "sleepy" ? "26;32;26" : "-7;7;-7"; // a sleepy sprout droops to one side
  return `<g transform="translate(${n(x)},${n(y)})"><g><animateTransform attributeName="transform" type="rotate" values="${sway}" dur="4s" repeatCount="indefinite" ${EASE}/>${parts}</g></g>`;
}

/** Little stars that collect around the pet, one every 11 levels. */
function stars(level: number): string {
  const spots: [number, number][] = [[-70, -120], [70, -105], [-80, -60], [78, -40], [-58, -150], [60, -150]];
  return spots
    .slice(0, Math.floor(level / 11))
    .map(([x, y], i) => {
      const twinkle = `<animate attributeName="opacity" values="1;0.35;1" dur="2s" begin="${-i * 0.5}s" repeatCount="indefinite"/>`;
      return `<path transform="translate(${100 + x},${178 + y}) scale(0.9)" d="M0,-7 L2,-2 L7,0 L2,2 L0,7 L-2,2 L-7,0 L-2,-2 Z" fill="${C.gold}" stroke="${C.line}" stroke-width="1.4" stroke-linejoin="round">${twinkle}</path>`;
    })
    .join("");
}

/** Three Z's drifting up from the top right while sleepy (paths, no fonts). */
function zzz(): string {
  const marks = [0, 1, 2]
    .map((i) => {
      const k = 0.7 + i * 0.25;
      const drift = `<animateTransform attributeName="transform" type="translate" values="0 6;0 -6" dur="4s" begin="${-i * 1.33}s" repeatCount="indefinite"/>`;
      const fade = `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.7;1" dur="4s" begin="${-i * 1.33}s" repeatCount="indefinite"/>`;
      return `<g transform="translate(${142 + i * 13},${n(62 - i * 18)}) scale(${n(k)})"><g>${drift}${fade}<path d="M-5,-5 H5 L-5,5 H5" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;
    })
    .join("");
  return `<g aria-label="Sleeping">${marks}</g>`;
}

function eggShape(h: number, w: number): string {
  return `M0,${-h} C${n(w * 0.66)},${-h} ${w},${n(-h * 0.66)} ${w},${n(-h * 0.41)} C${w},${n(-h * 0.15)} ${n(w * 0.57)},0 0,0 C${n(-w * 0.57)},0 ${-w},${n(-h * 0.15)} ${-w},${n(-h * 0.41)} C${-w},${n(-h * 0.66)} ${n(-w * 0.66)},${-h} 0,${-h} Z`;
}

const spots = `<circle cx="26" cy="-30" r="7" fill="${C.mint}"/><circle cx="-28" cy="-26" r="4.5" fill="${C.peach}"/><circle cx="-6" cy="-14" r="3" fill="${C.mint}"/>`;

/** Rep 0 and the cracked stage: an egg that wobbles; the crack lengthens with every rep. */
function egg(level: number, mood: Mood): string {
  const h = 118;
  const w = 46;
  let inner = `<path d="${eggShape(h, w)}" fill="${C.shell}" stroke="${C.line}" stroke-width="${W}" stroke-linejoin="round"/>`;
  inner += `<ellipse cx="-18" cy="-88" rx="6" ry="10" fill="#FFFFFF" opacity="0.9" transform="rotate(-25 -18 -88)"/>` + spots;
  if (level >= 1) {
    const teeth = 2 + level; // 3..8 zig-zags across the top
    const span = Math.min(2 * w - 10, 14 * teeth);
    let d = `M${n(-span / 2)},-84`;
    for (let i = 1; i <= teeth; i++) d += ` L${n(-span / 2 + (span * i) / teeth)},${i % 2 ? -92 : -84}`;
    inner += `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    inner = sprout(level, 0, -h + 2, mood) + inner + face(-58, mood, 0.9);
  } else {
    inner += `<path d="M-14,-56 q4,3 8,0 M6,-56 q4,3 8,0" fill="none" stroke="${C.eye}" stroke-width="2.4" stroke-linecap="round"/>`;
    inner += `<ellipse cx="-22" cy="-46" rx="8" ry="5" fill="${C.blush}" opacity="0.7" filter="url(#soft)"/><ellipse cx="22" cy="-46" rx="8" ry="5" fill="${C.blush}" opacity="0.7" filter="url(#soft)"/>`;
  }
  const wobble = `<animateTransform attributeName="transform" type="rotate" values="0;0;-4;4;-3;0;0" keyTimes="0;0.5;0.6;0.7;0.8;0.9;1" dur="4s" repeatCount="indefinite"/>`;
  return `<g transform="translate(100,178)"><g>${wobble}${inner}</g></g>`;
}

/** Hatchling: the mochi rises out of the lower shell as reps add up. */
function hatchling(level: number, mood: Mood): string {
  const p = progress(level);
  const top = -100 - p * 14; // head rises
  const body = `<path d="M-40,-34 C-46,${n(top + 30)} -28,${n(top)} 0,${n(top)} C28,${n(top)} 46,${n(top + 30)} 40,-34 Z" fill="${C.body}" stroke="${C.line}" stroke-width="${W}" stroke-linejoin="round"/>`;
  const shine = `<ellipse cx="-20" cy="${n(top + 18)}" rx="6" ry="9" fill="#FFFFFF" opacity="0.9" transform="rotate(-25 -20 ${n(top + 18)})"/>`;
  const shell = `<path d="M-50,-56 L-38,-45 L-26,-57 L-13,-46 L0,-58 L13,-46 L26,-57 L38,-45 L50,-56 C54,-28 44,0 0,0 C-44,0 -54,-28 -50,-56 Z" fill="${C.shell}" stroke="${C.line}" stroke-width="${W}" stroke-linejoin="round"/>${spots}`;
  const paws = `<ellipse cx="-27" cy="-52" rx="8" ry="6" fill="${C.body}" stroke="${C.line}" stroke-width="2.8"/><ellipse cx="27" cy="-52" rx="8" ry="6" fill="${C.body}" stroke="${C.line}" stroke-width="2.8"/>`;
  const moving = bob(3, sprout(level, 0, top + 1, mood) + body + shine + face(top + 32, mood));
  return `<g transform="translate(100,178)">${moving}${shell}${bob(1.5, paws)}</g>`;
}

/** Child, teen, adult: a chubby mochi that grows, gets ears, and blooms. */
function mochi(level: number, mood: Mood): string {
  const stage = stageOf(level);
  const p = progress(level);
  const scale = 0.84 + (level - 21) * (0.22 / 45); // 0.84 at 21 -> 1.06 at 66
  const h = 92; // top of the head
  // a round daifuku: domed head, bulging cheeks, soft flat bottom
  const blob = `M-36,0 C-60,0 -64,-36 -55,-58 C-46,-82 -26,-92 0,-92 C26,-92 46,-82 55,-58 C64,-36 60,0 36,0 Z`;

  let ears = "";
  if (stage >= 4) {
    const len = stage >= 5 ? 50 : 16 + p * 28; // ears grow through the teen stage
    const ear = (side: number) =>
      `<g transform="translate(${side * 24},${-h + 10}) rotate(${side * (stage >= 5 ? 28 : 14)})">` +
      `<path d="M-9,0 C-11,${n(-len * 0.7)} -6,${n(-len)} 0,${n(-len)} C6,${n(-len)} 11,${n(-len * 0.7)} 9,0 Z" fill="${C.body}" stroke="${C.line}" stroke-width="${W}" stroke-linejoin="round"/>` +
      `<path d="M-4,-4 C-5,${n(-len * 0.6)} -2,${n(-len * 0.82)} 0,${n(-len * 0.82)} C2,${n(-len * 0.82)} 5,${n(-len * 0.6)} 4,-4 Z" fill="${C.earIn}"/></g>`;
    ears = ear(-1) + ear(1);
  }
  const belly = stage >= 4 ? `<ellipse cx="0" cy="-20" rx="27" ry="16" fill="${C.shell}"/>` : "";
  // little paws held together on the tummy
  const arms = `<ellipse cx="-13" cy="-19" rx="6.5" ry="5.2" fill="${C.body}" stroke="${C.line}" stroke-width="2.4" transform="rotate(-20 -13 -19)"/><ellipse cx="13" cy="-19" rx="6.5" ry="5.2" fill="${C.body}" stroke="${C.line}" stroke-width="2.4" transform="rotate(20 13 -19)"/>`;
  const feet = `<ellipse cx="-24" cy="-2" rx="12" ry="7" fill="${C.body}" stroke="${C.line}" stroke-width="2.8"/><ellipse cx="24" cy="-2" rx="12" ry="7" fill="${C.body}" stroke="${C.line}" stroke-width="2.8"/>`;
  // early child still wears its shell cap
  const cap =
    stage === 3 && p < 0.5
      ? `<path d="M-32,${-h + 16} L-21,${-h + 24} L-10,${-h + 15} L0,${-h + 24} L10,${-h + 15} L21,${-h + 24} L32,${-h + 16} C28,${-h - 10} -28,${-h - 10} -32,${-h + 16} Z" fill="${C.shell}" stroke="${C.line}" stroke-width="${W}" stroke-linejoin="round"/><circle cx="13" cy="${-h + 4}" r="3.5" fill="${C.mint}"/><circle cx="-12" cy="${-h + 8}" r="2.5" fill="${C.peach}"/>`
      : "";
  const body =
    ears +
    `<path d="${blob}" fill="${C.body}" stroke="${C.line}" stroke-width="${W}" stroke-linejoin="round"/>` +
    belly +
    `<ellipse cx="-30" cy="${-h + 24}" rx="7" ry="11" fill="#FFFFFF" opacity="0.9" transform="rotate(-35 -30 ${-h + 24})"/>` +
    face(-h + 44, mood, 1.1) +
    arms +
    cap;
  const head = sprout(level, 0, -h + 2, mood);
  const squish = `<animateTransform attributeName="transform" type="scale" values="1 1;1.03 0.97;1 1" dur="2s" repeatCount="indefinite" ${EASE}/>`;
  return `<g transform="translate(100,178) scale(${n(scale)})">${feet}<g>${squish}${bob(2, head + body)}</g></g>`;
}

export function drawPet(level: number, mood: Mood = "normal"): string {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
  const stage = stageOf(l);
  const pet = stage <= 1 ? egg(l, mood) : stage === 2 ? hatchling(l, mood) : mochi(l, mood);
  const shadow = `<ellipse cx="100" cy="180" rx="${n(42 + l * 0.15)}" ry="6" fill="${C.line}" opacity="0.12"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">` +
    `<!-- Nudgling level ${l}/${MAX_LEVEL}. SMIL only -->` +
    `<defs><filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>` +
    shadow +
    stars(l) +
    pet +
    (mood === "sleepy" ? zzz() : "") +
    `</svg>`
  );
}
