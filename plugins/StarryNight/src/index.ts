import { ReactiveStore, Tracer, type LunaUnload } from "@luna/core";
import { observe, StyleTag } from "@luna/lib";

import css from "file://starrynight.css?minify";

export const { trace } = Tracer("[StarryNight]");
export const unloads = new Set<LunaUnload>();

type Palette = {
	star: string;
	starGlow: string;
	shootingStar: string;
	shootingStarGlow: string;
	skyTop: string;
	skyBottom: string;
};

export const PALETTES = {
	Base: { star: "#FFFFFF", starGlow: "#FFFFFF", shootingStar: "#FFFFFF", shootingStarGlow: "#FFFFFF", skyTop: "#000000", skyBottom: "#142b44" },
	"Cotton-candy": { star: "#FFFFFF", starGlow: "#FFFFFF", shootingStar: "#FFFFFF", shootingStarGlow: "#FFFFFF", skyTop: "#ff71b2", skyBottom: "#509be1" },
	Forest: { star: "#FFFFFF", starGlow: "#FFFFFF", shootingStar: "#FFFFFF", shootingStarGlow: "#FFFFFF", skyTop: "#000000", skyBottom: "#14442b" },
	Galaxy: { star: "#FFFFFF", starGlow: "#FFFFFF", shootingStar: "#FFFFFF", shootingStarGlow: "#FFFFFF", skyTop: "#00076f", skyBottom: "#b133c9" },
	Orange: { star: "#ffe234", starGlow: "#fff3ad", shootingStar: "#fff099", shootingStarGlow: "#fffcea", skyTop: "#000000", skyBottom: "#e69138" },
	Sky: { star: "#FFFFFF", starGlow: "#FFFFFF", shootingStar: "#FFFFFF", shootingStarGlow: "#FFFFFF", skyTop: "#1e48a9", skyBottom: "#62cff4" },
	Sunrise: { star: "#FFFFFF", starGlow: "#FFFFFF", shootingStar: "#FFFFFF", shootingStarGlow: "#FFFFFF", skyTop: "#FFAE41", skyBottom: "#F83D41" },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

const SN_VARS = [
	"--sn-star",
	"--sn-star-glow",
	"--sn-shooting-star",
	"--sn-shooting-star-glow",
	"--sn-rgb-shooting-star-glow",
	"--sn-sky-top",
	"--sn-sky-bottom",
];

export const storage = await ReactiveStore.getPluginStorage("StarryNight", {
	enabled: true,
	palette: "Base" as PaletteName,
	nowPlayingSky: true,
});

const style = new StyleTag("StarryNight", unloads, css);
const NOW_PLAYING_SELECTOR = '[data-test="new-now-playing"]';
const nowPlayingStyle = new StyleTag(
	"StarryNight-nowPlaying",
	unloads,
	`${NOW_PLAYING_SELECTOR} > [class*="_background_"] { display: none !important; }
	 [class*="_nowPlayingContainer"] { background: transparent !important; }
	 ${NOW_PLAYING_SELECTOR} > header,
	 ${NOW_PLAYING_SELECTOR} > [class*="_content_"] { position: relative; z-index: 1; }`,
);

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

const hexToRgb = (hex: string) => {
	let h = hex.replace("#", "");
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const n = Number.parseInt(h, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const applyPalette = (name: PaletteName) => {
	const p = PALETTES[name] ?? PALETTES.Base;
	const s = document.documentElement.style;
	s.setProperty("--sn-star", p.star);
	s.setProperty("--sn-star-glow", p.starGlow);
	s.setProperty("--sn-shooting-star", p.shootingStar);
	s.setProperty("--sn-shooting-star-glow", p.shootingStarGlow);
	s.setProperty("--sn-rgb-shooting-star-glow", hexToRgb(p.shootingStarGlow).join(", "));
	s.setProperty("--sn-sky-top", p.skyTop);
	s.setProperty("--sn-sky-bottom", p.skyBottom);
};

let sky: HTMLDivElement | null = null;

const placeShootingStar = (s: HTMLElement) => {
	if (Math.random() < 0.75) {
		s.style.top = "-4px";
		s.style.right = `${rand(0, 90)}%`;
	} else {
		s.style.top = `${rand(0, 50)}%`;
		s.style.right = "-4px";
	}
};

const addShootingStar = (host: HTMLElement) => {
	const s = document.createElement("span");
	s.className = "sn-shootingstar";
	placeShootingStar(s);
	const glow = "rgba(var(--sn-rgb-shooting-star-glow), 0.1)";
	s.style.boxShadow = `0 0 0 4px ${glow}, 0 0 0 8px ${glow}, 0 0 20px ${glow}`;
	s.style.animationDuration = `${Math.floor(Math.random() * 3) + 3}s`;
	s.style.animationDelay = `${Math.floor(Math.random() * 7)}s`;
	s.addEventListener("animationend", () => {
		placeShootingStar(s);
		s.style.animation = "none";
		void s.offsetWidth;
		s.style.animation = "";
		s.style.setProperty("animation-duration", `${Math.floor(Math.random() * 4) + 3}s`, "important");
	});
	host.appendChild(s);
};

const fillSky = (el: HTMLElement, w: number, h: number) => {
	const count = Math.round((w * h) / 4000);
	for (let i = 0; i < count; i++) {
		const size = Math.random() < 0.5 ? 1 : 2;
		const star = document.createElement("div");
		star.className = "sn-star";
		star.style.left = `${rand(0, 99)}%`;
		star.style.top = `${rand(0, 99)}%`;
		star.style.opacity = `${rand(0.5, 1)}`;
		star.style.width = `${size}px`;
		star.style.height = `${size}px`;
		if (Math.random() < 0.2) {
			star.classList.add("sn-star-twinkle", `sn-star-twinkle-${Math.floor(Math.random() * 4) + 1}`);
		}
		el.appendChild(star);
	}
	for (let i = 0; i < 4; i++) addShootingStar(el);
};

const removeSkies = () => {
	for (const el of document.querySelectorAll(".sn-sky")) el.remove();
	sky = null;
};

const buildBodySky = () => {
	if (!document.body) return;
	sky = document.createElement("div");
	sky.className = "sn-sky";
	document.body.appendChild(sky);
	fillSky(sky, window.innerWidth, window.innerHeight);
};

const mountPanelSky = (panel: HTMLElement) => {
	if (!storage.enabled || !storage.nowPlayingSky) return;
	if (panel.querySelector(":scope > .sn-sky")) return;
	const el = document.createElement("div");
	el.className = "sn-sky sn-sky-panel";
	panel.appendChild(el);
	const rect = panel.getBoundingClientRect();
	fillSky(el, rect.width || window.innerWidth, rect.height || window.innerHeight);
};

let stopPanelObserve: LunaUnload | undefined;

export const render = () => {
	applyPalette(storage.palette);
	stopPanelObserve?.();
	stopPanelObserve = undefined;
	removeSkies();

	if (!storage.enabled) {
		style.remove();
		nowPlayingStyle.remove();
		return;
	}

	style.add();
	buildBodySky();

	if (storage.nowPlayingSky) {
		nowPlayingStyle.add();
		const panel = document.querySelector<HTMLElement>(NOW_PLAYING_SELECTOR);
		if (panel) mountPanelSky(panel);
		stopPanelObserve = observe<HTMLElement>(unloads, NOW_PLAYING_SELECTOR, mountPanelSky);
	} else {
		nowPlayingStyle.remove();
	}
};

unloads.add(removeSkies);
unloads.add(() => {
	for (const v of SN_VARS) document.documentElement.style.removeProperty(v);
});

render();

export { Settings } from "./Settings";
