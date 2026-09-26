// Page motion in the spirit of igloo.inc: momentum scrolling, decoding headings, and
// content that eases in as it enters view. Everything is skipped for reduced motion.
import { useEffect } from "react";

const REVEAL_SELECTOR = [
  ".landing-heading",
  ".landing-section",
  ".page-heading",
  ".section-heading",
  ".device-card",
  ".panel",
  ".placement-invite",
  ".notice",
].join(",");
const DECODE_SELECTOR = "h1, .landing-section h2";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollsItself(target: EventTarget | null) {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight)
      return true;
  }
  return false;
}

/** Wheel input glides to its target instead of jumping. Keyboard and scrollbar stay native. */
export function useSmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return;
    let target = window.scrollY;
    let current = window.scrollY;
    let frame = 0;
    const limit = () => document.documentElement.scrollHeight - window.innerHeight;
    function step() {
      current += (target - current) * 0.1;
      if (Math.abs(target - current) < 0.5) {
        current = target;
        frame = 0;
      } else {
        frame = requestAnimationFrame(step);
      }
      window.scrollTo({ top: current, behavior: "instant" });
    }
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || document.body.style.overflow === "hidden" || scrollsItself(event.target))
        return;
      event.preventDefault();
      if (!frame) target = current = window.scrollY;
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : 1;
      target = Math.max(0, Math.min(limit(), target + event.deltaY * lines));
      if (!frame) frame = requestAnimationFrame(step);
    }
    function sync() {
      if (!frame) target = current = window.scrollY;
    }
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("scroll", sync, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("scroll", sync);
    };
  }, []);
}

/** Scramble a plain-text heading, then settle it left to right. */
function decode(el: HTMLElement) {
  const node = el.childNodes.length === 1 ? el.firstChild : null;
  if (!(node instanceof Text)) return;
  const final = node.data;
  const duration = Math.min(900, 350 + final.length * 30);
  const start = performance.now();
  let written = final;
  el.setAttribute("aria-label", final);
  function pick(char: string) {
    const set = UPPER.includes(char) ? UPPER : LOWER.includes(char) ? LOWER : DIGITS;
    return /[A-Za-z0-9]/.test(char) ? set[Math.floor(Math.random() * set.length)] : char;
  }
  function frame(now: number) {
    // React replaced the text meanwhile; its version wins.
    if (!(node instanceof Text) || node.data !== written) return el.removeAttribute("aria-label");
    const progress = Math.min(1, (now - start) / duration);
    const settled = Math.floor(progress * final.length);
    written = [...final].map((char, i) => (i < settled ? char : pick(char))).join("");
    if (progress < 1) {
      node.data = written;
      requestAnimationFrame(frame);
    } else {
      node.data = written = final;
      el.removeAttribute("aria-label");
    }
  }
  requestAnimationFrame(frame);
}

/** Fade and lift content in as it scrolls into view, including cards that load later. */
export function useReveal(key: string) {
  useEffect(() => {
    if (reducedMotion()) return;
    const root = document.getElementById("root");
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let order = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.setProperty("--reveal-delay", `${Math.min(order++, 6) * 70}ms`);
          el.classList.add("revealed");
          observer.unobserve(el);
          if (el.matches(DECODE_SELECTOR)) decode(el);
          el.querySelectorAll<HTMLElement>(DECODE_SELECTOR).forEach(decode);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    const watched = new WeakSet<Element>();
    function scan() {
      root!.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el) => {
        if (watched.has(el) || el.classList.contains("revealed")) return;
        watched.add(el);
        el.classList.add("reveal");
        observer.observe(el);
      });
    }
    scan();
    const mutations = new MutationObserver(scan);
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [key]);
}
