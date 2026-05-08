"use client";
import { useTabVisibility } from "@/hooks/useTabVisibility";

/** Mounts the visibility handler at app root (returns nothing). */
export default function TabVisibilityHandler() {
  useTabVisibility();
  return null;
}
