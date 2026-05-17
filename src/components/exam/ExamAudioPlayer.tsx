"use client";
import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  src: string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

const SPEEDS = [0.75, 1, 1.25, 1.5];

function fmt(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ExamAudioPlayer({ src, audioRef }: Props) {
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed]       = useState(1);
  const rangeRef = useRef<HTMLInputElement>(null);

  // Sync state from audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay     = () => setPlaying(true);
    const onPause    = () => setPlaying(false);
    const onEnded    = () => setPlaying(false);
    const onTime     = () => {
      setCurrent(audio.currentTime);
      // Sync range thumb position AND --pct CSS var (drives the
      // orange→red gradient fill in the track) without triggering a
      // React re-render on every timeupdate tick.
      if (rangeRef.current && isFinite(audio.duration) && audio.duration > 0) {
        const pct = (audio.currentTime / audio.duration) * 100;
        rangeRef.current.value = String(pct);
        rangeRef.current.style.setProperty("--pct", `${pct}%`);
      }
    };
    const onMeta     = () => setDuration(audio.duration);
    audio.addEventListener("play",          onPlay);
    audio.addEventListener("pause",         onPause);
    audio.addEventListener("ended",         onEnded);
    audio.addEventListener("timeupdate",    onTime);
    audio.addEventListener("loadedmetadata",onMeta);
    // Seed duration if already loaded
    if (audio.readyState >= 1) setDuration(audio.duration);
    return () => {
      audio.removeEventListener("play",          onPlay);
      audio.removeEventListener("pause",         onPause);
      audio.removeEventListener("ended",         onEnded);
      audio.removeEventListener("timeupdate",    onTime);
      audio.removeEventListener("loadedmetadata",onMeta);
    };
  }, [audioRef]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }, [audioRef]);

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !isFinite(audio.duration)) return;
    const pct = Number(e.target.value);
    audio.currentTime = pct / 100 * audio.duration;
    e.target.style.setProperty("--pct", `${pct}%`);
  };

  const onSpeed = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.target.value);
    setSpeed(v);
    if (audioRef.current) audioRef.current.playbackRate = v;
  };

  return (
    <div className="exam-audio-player">
      {/* Hidden audio element — ref forwarded from parent so existing
          consumers (ListenAudioAndScript seek, per-q ▶ buttons) keep
          driving the same DOM node. controlsList + disablePiP are
          defensive in case anything re-enables native controls. */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        controlsList="nodownload nofullscreen noremoteplayback"
        style={{ display: "none" }}
      />

      <button
        type="button"
        className="eap-play-btn"
        onClick={togglePlay}
        aria-label={playing ? "Tạm dừng" : "Phát"}
      >
        {playing ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5"/>
            <rect x="14" y="4" width="4" height="16" rx="1.5"/>
          </svg>
        ) : (
          // Triangle nudged 1px right so it visually centers
          // (the bounding box has more whitespace on the left edge).
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
            <polygon points="6,4 20,12 6,20"/>
          </svg>
        )}
      </button>

      <span className="eap-time">{fmt(current)}</span>

      <input
        ref={rangeRef}
        type="range"
        className="eap-seek"
        min={0}
        max={100}
        step={0.1}
        defaultValue={0}
        onChange={onSeek}
        aria-label="Seek"
      />

      <span className="eap-time eap-dur">{fmt(duration)}</span>

      <select
        className="eap-speed"
        value={speed}
        onChange={onSpeed}
        aria-label="Tốc độ phát"
      >
        {SPEEDS.map(s => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
}
