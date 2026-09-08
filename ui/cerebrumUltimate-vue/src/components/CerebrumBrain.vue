<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  sections: { type: Array, required: true },
  language: { type: String, default: "it" },
});
const emit = defineEmits(["navigate"]);
const italian = computed(() => props.language.toLowerCase().startsWith("it"));
const words = (it, en) => italian.value ? it : en;
const svgId = `cerebrum-brain-${getCurrentInstance().uid}`;
const hovered = ref("");
const focused = ref("");
const active = computed(() => hovered.value || focused.value);
const paused = ref(false);
const hidden = ref(false);
const reducedMotion = ref(false);
const motionStopped = computed(() => paused.value || hidden.value || reducedMotion.value);
let motionPreference;

const updateVisibility = () => { hidden.value = document.hidden; };
const updateMotionPreference = () => { reducedMotion.value = Boolean(motionPreference?.matches); };
onMounted(() => {
  updateVisibility();
  document.addEventListener("visibilitychange", updateVisibility);
  motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  updateMotionPreference();
  motionPreference.addEventListener("change", updateMotionPreference);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", updateVisibility);
  motionPreference?.removeEventListener("change", updateMotionPreference);
});

const positions = {
  conversation: { x: 320, y: 166 },
  learning: { x: 250, y: 314 },
  memory: { x: 340, y: 456 },
  goals: { x: 580, y: 166 },
  research: { x: 650, y: 314 },
  operations: { x: 560, y: 456 },
  automations: { x: 450, y: 314 },
};
const fallbackPositions = Object.values(positions);
const neurons = computed(() => props.sections.map((section, index) => ({
  ...section,
  ...(positions[section.id] || fallbackPositions[index % fallbackPositions.length]),
  number: String(index + 1).padStart(2, "0"),
  color: section.color || "#82e2ed",
})));
const connections = computed(() => neurons.value.flatMap((from, index) => neurons.value.slice(index + 1).map((to, offset) => {
  const bend = (index + offset) % 2 ? 26 : -26;
  return {
    id: `${from.id}-${to.id}`,
    from: from.id,
    to: to.id,
    color: from.color,
    path: `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 + bend} ${(from.y + to.y) / 2 - bend} ${to.x} ${to.y}`,
  };
})));

// Fixed decorative geometry: this map is navigation, not a stream of AI activity.
const leftPoints = [
  [346, 98], [389, 91], [415, 133], [278, 124], [225, 166], [367, 194],
  [400, 224], [303, 221], [195, 237], [228, 267], [341, 276], [422, 288],
  [184, 323], [299, 338], [372, 345], [408, 376], [217, 391], [271, 422],
  [310, 390], [369, 413], [260, 477], [302, 516], [381, 504], [409, 458],
];
const finePoints = [...leftPoints, ...leftPoints.map(([x, y]) => [900 - x, y])];
const fineLinks = finePoints.flatMap((point, index) => finePoints.slice(index + 1).flatMap((other, offset) => {
  const distance = Math.hypot(point[0] - other[0], point[1] - other[1]);
  return distance < 115 && distance > 35 && (index + offset) % 3 !== 0
    ? [{ id: `${index}-${index + offset + 1}`, x1: point[0], y1: point[1], x2: other[0], y2: other[1] }]
    : [];
}));
const hemisphere = "M 441 106 C 422 66 383 52 350 77 C 316 58 270 78 258 110 C 219 108 185 142 188 182 C 153 200 142 249 165 280 C 141 310 151 353 175 376 C 160 414 181 448 216 459 C 216 495 242 522 276 520 C 295 554 328 558 354 543 C 380 571 408 552 424 530 C 443 508 437 476 441 451 L 441 138 Q 448 119 441 106 Z";
const folds = [
  "M 351 79 C 327 96 333 113 315 123 C 291 138 283 119 262 133 C 242 149 251 171 229 182 C 210 191 191 181 180 206",
  "M 422 104 C 397 114 376 104 369 127 C 359 153 388 163 377 186 C 365 211 332 190 319 213 C 307 234 327 252 310 266",
  "M 420 153 C 406 161 405 182 414 198 C 429 225 406 241 391 249 C 375 258 377 280 391 291 C 413 309 401 327 383 330",
  "M 285 157 C 269 175 282 195 265 210 C 246 227 219 208 207 231 C 197 251 225 267 208 285 C 190 304 172 284 161 305",
  "M 352 234 C 361 259 342 273 349 296 C 358 321 331 328 307 318 C 279 308 281 280 260 277 C 242 274 231 293 237 309",
  "M 186 345 C 206 325 222 352 241 339 C 258 327 272 341 277 359 C 283 381 265 399 249 391 C 230 382 218 404 227 423",
  "M 419 350 C 411 371 386 371 378 391 C 369 414 391 430 411 417 C 428 406 443 423 438 441",
  "M 316 352 C 301 369 319 387 338 390 C 359 394 350 422 330 425 C 306 428 300 454 314 473 C 325 489 316 512 304 521",
  "M 252 454 C 270 434 287 449 279 467 C 272 485 294 496 288 518",
  "M 382 455 C 365 442 350 464 365 480 C 381 497 362 517 353 532",
  "M 410 465 C 424 486 403 501 399 520",
];

const neuronStyle = (neuron, index) => ({
  left: `${neuron.x / 9}%`,
  top: `${neuron.y / 6.4}%`,
  "--neuron-color": neuron.color,
  "--neuron-delay": `${index * -0.8}s`,
});
</script>

<template>
  <section
    class="cerebrum-brain"
    :class="{ 'motion-stopped': motionStopped, 'has-active-neuron': active }"
    data-cerebrum-localized
    :aria-label="words('Esplora Cerebrum', 'Explore Cerebrum')"
  >
    <div class="brain-hero">
      <header class="brain-intro">
        <span class="brain-eyebrow">CEREBRUM</span>
        <h2>{{ words('Dentro Cerebrum', 'Inside Cerebrum') }}</h2>
        <p>{{ words('Esplora ciò che apprende, ricorda e fa per la tua casa.', 'Explore what it learns, remembers and does for your home.') }}</p>
      </header>

      <div class="brain-map" :aria-label="words('Mappa delle sezioni di Cerebrum', 'Map of Cerebrum sections')">
        <div class="brain-map-float">
          <svg class="brain-art" viewBox="0 0 900 640" fill="none" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient :id="`${svgId}-surface`" x1="220" y1="80" x2="620" y2="570" gradientUnits="userSpaceOnUse">
                <stop stop-color="#233c65" stop-opacity=".77" />
                <stop offset=".48" stop-color="#172f50" stop-opacity=".66" />
                <stop offset="1" stop-color="#192b4b" stop-opacity=".85" />
              </linearGradient>
              <linearGradient :id="`${svgId}-outline`" x1="215" y1="100" x2="720" y2="540" gradientUnits="userSpaceOnUse">
                <stop stop-color="#a0c9fa" stop-opacity=".8" />
                <stop offset=".5" stop-color="#76ccc9" stop-opacity=".32" />
                <stop offset="1" stop-color="#a79ee8" stop-opacity=".76" />
              </linearGradient>
              <radialGradient :id="`${svgId}-halo`">
                <stop stop-color="#3b80b7" stop-opacity=".22" />
                <stop offset="1" stop-color="#3b80b7" stop-opacity="0" />
              </radialGradient>
              <filter :id="`${svgId}-glow`" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" />
              </filter>
              <clipPath :id="`${svgId}-clip`">
                <path :d="hemisphere" />
                <path :d="hemisphere" transform="translate(900 0) scale(-1 1)" />
              </clipPath>
            </defs>

            <ellipse cx="450" cy="305" rx="402" ry="308" :fill="`url(#${svgId}-halo)`" />
            <g class="brain-orbits" stroke="#76b9d9">
              <ellipse cx="450" cy="319" rx="363" ry="244" transform="rotate(-13 450 319)" />
              <ellipse cx="450" cy="319" rx="351" ry="278" transform="rotate(14 450 319)" />
              <path d="M 96 319 H 115 M 785 319 H 804 M 450 20 V 36 M 450 596 V 612" />
            </g>

            <g :fill="`url(#${svgId}-surface)`" :stroke="`url(#${svgId}-outline)`" stroke-width="1.8">
              <path :d="hemisphere" />
              <path :d="hemisphere" transform="translate(900 0) scale(-1 1)" />
              <path d="M 424 530 C 432 548 435 556 435 572 Q 450 582 465 572 C 465 556 468 548 476 530" opacity=".7" />
            </g>

            <g class="brain-folds">
              <g v-for="side in [0, 1]" :key="side" :transform="side ? 'translate(900 0) scale(-1 1)' : undefined">
                <path v-for="(fold, index) in folds" :key="index" :d="fold" />
              </g>
              <path d="M 450 120 C 447 176 454 215 450 269 C 446 325 454 380 450 429 L 450 504" class="brain-fissure" />
            </g>

            <g :clip-path="`url(#${svgId}-clip)`">
              <g class="brain-fine-links">
                <line v-for="link in fineLinks" :key="link.id" :x1="link.x1" :y1="link.y1" :x2="link.x2" :y2="link.y2" />
              </g>
              <g class="brain-fine-points">
                <circle v-for="(point, index) in finePoints" :key="index" :cx="point[0]" :cy="point[1]" :r="index % 4 === 0 ? 2.6 : 1.7" />
              </g>
            </g>

            <g class="brain-connections">
              <g
                v-for="(connection, index) in connections"
                :key="connection.id"
                :class="{ 'connection-active': active === connection.from || active === connection.to }"
                :style="{ '--connection-color': connection.color, '--pulse-delay': `${index * -1.3}s`, '--pulse-duration': `${7 + index % 4}s` }"
              >
                <path class="brain-connection" :d="connection.path" />
                <path class="brain-pulse-halo" :d="connection.path" pathLength="100" :filter="`url(#${svgId}-glow)`" />
                <path class="brain-pulse" :d="connection.path" pathLength="100" />
              </g>
            </g>
          </svg>

          <button
            v-for="(neuron, index) in neurons"
            :key="neuron.id"
            type="button"
            class="brain-neuron"
            :class="{ 'neuron-active': active === neuron.id }"
            :style="neuronStyle(neuron, index)"
            :aria-label="`${neuron.label}. ${neuron.description}`"
            @mouseenter="hovered = neuron.id"
            @mouseleave="hovered = ''"
            @focus="focused = neuron.id"
            @blur="focused = ''"
            @click="emit('navigate', neuron.id)"
          >
            <span class="brain-neuron-core" aria-hidden="true">
              <span class="brain-neuron-ring" />
              <span class="brain-neuron-number">{{ neuron.number }}</span>
            </span>
            <span class="brain-neuron-label">{{ neuron.label }}</span>
          </button>
        </div>
      </div>

      <div class="brain-map-footer">
        <p><span aria-hidden="true">↗</span> {{ words('Scegli un neurone per esplorare', 'Choose a neuron to explore') }}</p>
        <button
          type="button"
          class="brain-motion-control"
          :aria-pressed="paused"
          :disabled="reducedMotion"
          :aria-label="reducedMotion ? words('Movimento ridotto: animazione disattivata', 'Reduced motion: animation disabled') : paused ? words('Riprendi l’animazione', 'Resume animation') : words('Pausa animazione', 'Pause animation')"
          @click="paused = !paused"
        >
          <svg v-if="!motionStopped" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.5" height="10" rx="1" /><rect x="9.5" y="3" width="2.5" height="10" rx="1" /></svg>
          <svg v-else viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5a.5.5 0 0 1 .76-.43l7 4.5a.5.5 0 0 1 0 .86l-7 4.5A.5.5 0 0 1 5 12.5z" /></svg>
          {{ reducedMotion ? words('Movimento ridotto', 'Reduced motion') : paused ? words('Riprendi', 'Resume') : words('Pausa', 'Pause') }}
        </button>
      </div>
    </div>

    <nav class="brain-section-index" :aria-label="words('Sezioni di Cerebrum', 'Cerebrum sections')">
      <button
        v-for="neuron in neurons"
        :key="neuron.id"
        type="button"
        class="brain-section-card"
        :class="{ 'section-active': active === neuron.id }"
        :style="{ '--neuron-color': neuron.color }"
        @mouseenter="hovered = neuron.id"
        @mouseleave="hovered = ''"
        @focus="focused = neuron.id"
        @blur="focused = ''"
        @click="emit('navigate', neuron.id)"
      >
        <span class="brain-section-number" aria-hidden="true">{{ neuron.number }}</span>
        <span class="brain-section-copy">
          <span class="brain-section-title">{{ neuron.label }}</span>
          <span class="brain-section-description">{{ neuron.description }}</span>
        </span>
        <span class="brain-section-arrow" aria-hidden="true">↗</span>
      </button>
    </nav>
  </section>
</template>

<style scoped>
.cerebrum-brain {
  --brain-text: #edf4ff;
  --brain-muted: #b0c0d8;
  width: 100%;
  color: var(--brain-text);
  background: #0b1527;
  border: 1px solid #26374f;
  border-radius: 22px;
  overflow: hidden;
  isolation: isolate;
}
.cerebrum-brain *, .cerebrum-brain *::before, .cerebrum-brain *::after { box-sizing: border-box; }
.brain-hero {
  position: relative;
  padding: 35px 28px 17px;
  background: radial-gradient(ellipse at 50% 53%, #182b49 0%, #0e1a2e 48%, #0b1527 77%);
}
.brain-intro { position: relative; z-index: 1; text-align: center; }
.brain-eyebrow { color: #91b7d7; font-size: 10px; font-weight: 700; letter-spacing: .28em; }
.brain-intro h2 { margin: 10px 0 11px; color: #f0f5ff; font-size: clamp(27px, 4vw, 40px); font-weight: 550; letter-spacing: -.045em; line-height: 1.15; }
.brain-intro p { max-width: 510px; margin: 0 auto; color: var(--brain-muted); font-size: 14px; line-height: 1.65; }
.brain-map { position: relative; width: 100%; max-width: 840px; aspect-ratio: 900 / 640; margin: -2px auto -10px; }
.brain-map-float { position: absolute; inset: 0; animation: brain-float 11s ease-in-out infinite; }
.brain-art { display: block; width: 100%; height: 100%; overflow: visible; }
.brain-orbits { opacity: .11; stroke-width: 1; }
.brain-folds { stroke: #82a5c9; stroke-opacity: .4; stroke-width: 2.2; stroke-linecap: round; }
.brain-fissure { stroke: #a5c4df; stroke-opacity: .25; stroke-width: 1.2; }
.brain-fine-links { stroke: #80bad5; stroke-opacity: .2; stroke-width: .8; }
.brain-fine-points { fill: #b4e2ed; opacity: .62; }
.brain-connection { stroke: var(--connection-color); stroke-opacity: .32; stroke-width: 1; transition: stroke-opacity .2s, stroke-width .2s; }
.brain-pulse, .brain-pulse-halo { stroke: var(--connection-color); stroke-linecap: round; stroke-dasharray: 1.2 98.8; animation: brain-signal var(--pulse-duration) linear infinite; animation-delay: var(--pulse-delay); }
.brain-pulse { stroke-width: 2; opacity: .72; }
.brain-pulse-halo { stroke-width: 6; opacity: .4; }
.connection-active .brain-connection { stroke-opacity: .85; stroke-width: 1.8; }
.connection-active .brain-pulse { opacity: 1; }
.brain-neuron {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 152px;
  min-height: 44px;
  padding: 0;
  transform: translate(-50%, -25px);
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: #eff6ff;
  cursor: pointer;
  font: inherit;
  -webkit-tap-highlight-color: transparent;
}
.brain-neuron-core {
  position: relative;
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border: 1px solid var(--neuron-color);
  border-radius: 50%;
  background: radial-gradient(circle at 45% 40%, #34475b, #0f1d32 73%);
  box-shadow: 0 0 20px -8px var(--neuron-color), inset 0 0 15px -8px var(--neuron-color);
  transition: box-shadow .2s, background .2s;
}
.brain-neuron-core::before, .brain-neuron-core::after { content: ""; position: absolute; border-radius: 50%; pointer-events: none; }
.brain-neuron-core::before { inset: -9px; border: 1px solid var(--neuron-color); opacity: .18; }
.brain-neuron-core::after { inset: -18px; border: 1px dotted var(--neuron-color); opacity: .28; }
.brain-neuron-ring { position: absolute; inset: -5px; border: 1px solid var(--neuron-color); border-radius: 50%; animation: brain-ripple 4.8s ease-out infinite; animation-delay: var(--neuron-delay); pointer-events: none; }
.brain-neuron-number { color: #f7fbff; font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: .04em; text-shadow: 0 0 12px var(--neuron-color); }
.brain-neuron-label { position: relative; margin-top: 9px; padding: 5px 9px; color: #e7f1ff; border: 1px solid #354861; border-radius: 7px; background: #102037; font-size: 12px; font-weight: 550; line-height: 1.25; text-align: center; box-shadow: 0 3px 12px #07102166; transition: border-color .2s, background .2s; }
.neuron-active .brain-neuron-core { background: #2a4057; box-shadow: 0 0 33px -7px var(--neuron-color), inset 0 0 16px -7px var(--neuron-color); }
.neuron-active .brain-neuron-label { border-color: var(--neuron-color); background: #1c314b; }
.brain-map-footer { display: flex; align-items: center; justify-content: center; gap: 22px; position: relative; }
.brain-map-footer p { margin: 0; color: var(--brain-muted); font-size: 12px; line-height: 1.5; }
.brain-map-footer p > span { margin-right: 5px; color: #8dccd4; }
.brain-motion-control { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 7px 9px; color: #bacbe2; background: #152238; border: 1px solid #31425a; border-radius: 7px; font: inherit; font-size: 11px; cursor: pointer; }
.brain-motion-control svg { width: 13px; height: 13px; }
.brain-motion-control:disabled { color: #9eafc8; cursor: default; }
.brain-motion-control:not(:disabled):hover { background: #21334d; color: #f1f7ff; }
.brain-section-index { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; padding: 1px; border-top: 1px solid #25354c; background: #25354c; }
.brain-section-card { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 22px 20px; border: 0; color: inherit; background: #101c2e; cursor: pointer; text-align: left; font: inherit; transition: background .2s; }
.brain-section-number { flex: 0 0 28px; padding-top: 2px; color: var(--neuron-color); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; letter-spacing: .04em; }
.brain-section-copy { display: flex; flex-direction: column; min-width: 0; gap: 7px; }
.brain-section-title { color: #edf4ff; font-size: 13px; font-weight: 600; line-height: 1.45; }
.brain-section-description { color: #b0bfd3; font-size: 12px; line-height: 1.6; }
.brain-section-arrow { margin-left: auto; color: #a0b4ce; font-size: 16px; line-height: 20px; transition: color .2s, transform .2s; }
.section-active { background: #192c43; }
.section-active .brain-section-arrow { color: var(--neuron-color); transform: translate(2px, -2px); }
.brain-neuron:focus-visible, .brain-motion-control:focus-visible, .brain-section-card:focus-visible { outline: 2px solid #f2f7ff; outline-offset: 4px; }
.brain-section-card:focus-visible { position: relative; z-index: 1; outline-offset: -5px; }
.motion-stopped *, .motion-stopped *::before, .motion-stopped *::after { animation-play-state: paused !important; }
@keyframes brain-float { 0%, 100% { transform: translateY(2px); } 50% { transform: translateY(-5px); } }
@keyframes brain-signal { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }
@keyframes brain-ripple { 0% { transform: scale(.86); opacity: .3; } 80%, 100% { transform: scale(1.5); opacity: 0; } }
@media (min-width: 1200px) { .brain-section-card { padding: 24px 25px; } }
@media (max-width: 760px) {
  .brain-hero { padding: 28px 14px 17px; }
  .brain-section-index { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .brain-section-card { gap: 8px; padding: 18px 15px; }
  .brain-section-number { flex-basis: 23px; }
  .brain-neuron { width: 128px; }
  .brain-neuron-label { font-size: 11px; }
}
@media (max-width: 540px) {
  .cerebrum-brain { border-radius: 16px; }
  .brain-intro p { max-width: 285px; font-size: 12px; }
  .brain-map { width: calc(100% + 20px); margin: 13px -10px 9px; }
  .brain-neuron { width: 48px; height: 48px; min-height: 48px; justify-content: center; transform: translate(-50%, -24px); }
  .brain-neuron-core { width: 36px; height: 36px; }
  .brain-neuron-core::before { inset: -5px; }
  .brain-neuron-core::after { inset: -10px; }
  .brain-neuron-number { font-size: 10px; }
  .brain-neuron-label { display: none; }
  .brain-map-footer { flex-wrap: wrap; gap: 6px 13px; }
  .brain-map-footer p { font-size: 11px; }
  .brain-section-card { gap: 7px; padding: 17px 12px; }
  .brain-section-number { flex-basis: 18px; font-size: 10px; }
  .brain-section-title { font-size: 12px; }
  .brain-section-description { font-size: 11px; }
  .brain-section-arrow { display: none; }
}
@media (max-width: 340px) { .brain-section-index { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) {
  .cerebrum-brain *, .cerebrum-brain *::before, .cerebrum-brain *::after { animation: none !important; transition: none !important; }
  .brain-neuron-ring { opacity: .16; }
  .brain-pulse, .brain-pulse-halo { opacity: 0; }
}
</style>
