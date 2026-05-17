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
      // Sync range thumb position
      if (rangeRef.current && isFinite(audio.duration)) {
        rangeRef.current.value = String(audio.currentTime / audio.duration * 100);
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
    audio.currentTime = Number(e.target.value) / 100 * audio.duration;
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="3" width="4" height="18" rx="1"/>
            <rect x="15" y="3" width="4" height="18" rx="1"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
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
