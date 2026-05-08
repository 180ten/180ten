"use client";
import { useState, useEffect } from "react";

interface SplashScreenProps { visible: boolean; }

export default function SplashScreen({ visible }: SplashScreenProps) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 350);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted) return null;
  return (
    <div className={`splash-v3${visible ? "" : " hide"}`}>
      <div className="loader" />
    </div>
  );
}
