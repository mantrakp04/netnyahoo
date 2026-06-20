import { useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";

/**
 * Central home for every motion animation in the renderer. Components import
 * these hooks/constants instead of hand-rolling `initial`/`animate` objects or
 * CSS `@keyframes`, so timing and easing stay consistent and reduced-motion is
 * honored in a single place.
 */

/** Dia's signature ease — mirrors the cubic-bezier used across the old CSS. */
export const diaEase = [0.22, 1, 0.36, 1] as const;

/** Slide-over ease for generated tabs: quick start, soft deceleration. */
export const newTabSlideEase = [0.16, 1, 0.3, 1] as const;

export const newTabSlideDuration = 0.18;

export const newTabSidebarSpring: Transition = {
  type: "spring",
  stiffness: 250,
  damping: 30,
  mass: 1,
};

/** Shared-layout id for the sliding active highlight in the sidebar tab list. */
export const SIDEBAR_ACTIVE_LAYOUT_ID = "sidebar-active-item";
const sidebarTabHeight = 28;

/** Enter/exit motion for each item in the sidebar tab list. */
export function useTabMotion() {
  const reduceMotion = useReducedMotion();
  return reduceMotion
    ? {
        initial: { height: sidebarTabHeight, opacity: 0 },
        animate: { height: sidebarTabHeight, opacity: 1, y: 0 },
        exit: { height: 0, opacity: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { height: 0, opacity: 0, y: -10 },
        animate: { height: sidebarTabHeight, opacity: 1, y: 0 },
        exit: { height: 0, opacity: 0, y: -6 },
        transition: {
          layout: newTabSidebarSpring,
          height: { duration: newTabSlideDuration, ease: newTabSlideEase },
          opacity: { duration: 0.18, ease: diaEase },
          y: { duration: newTabSlideDuration, ease: newTabSlideEase },
        },
      };
}

export function useSidebarLayoutTransition(): Transition {
  const reduceMotion = useReducedMotion();
  return reduceMotion ? { duration: 0 } : newTabSidebarSpring;
}

/**
 * Spring that slides the active highlight between sidebar items. Paired with a
 * `layoutId={SIDEBAR_ACTIVE_LAYOUT_ID}` element rendered under the active item:
 * Motion animates the shared element from the old item's box to the new one.
 */
export function useActiveIndicatorTransition(): Transition {
  const reduceMotion = useReducedMotion();
  return reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 500, damping: 42, mass: 0.9 };
}

/** New-tab page fade-in (replaces the `new-tab-page-in` keyframes). */
export function useNewTabPageMotion(slideOver = false) {
  const reduceMotion = useReducedMotion();
  if (slideOver) {
    return reduceMotion
      ? {
          initial: { x: 0 },
          animate: { x: 0 },
          transition: { duration: 0 },
        }
      : {
          initial: { x: "-100%" },
          animate: { x: 0 },
          transition: { duration: newTabSlideDuration, ease: newTabSlideEase },
        };
  }

  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: reduceMotion
      ? { duration: 0 }
      : { duration: 0.14, ease: diaEase },
  };
}

/** New-tab command-card settle (replaces the `new-tab-card-settle` keyframes). */
export function useNewTabCardMotion(enabled = true) {
  const reduceMotion = useReducedMotion();
  if (!enabled) {
    return {
      initial: false,
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { duration: 0 },
    };
  }

  return reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0 },
      }
    : {
        // 0.18rem ≈ 2.88px — kept from the original keyframes.
        initial: { opacity: 0, y: 2.88, scale: 0.999 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.18, ease: diaEase },
      };
}
