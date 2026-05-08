"use client";
// ── useAnki.ts ───────────────────────────────────────────────
// Schema thực tế (khớp index.html):
//   anki_decks  : id, name, user_id, is_admin, folder_id, cards (JSONB[])
//   anki_folders: id, name, user_id, is_admin
//   anki_card_progress: user_id, deck_id, card_index (int), interval_level, next_review (ISO string)
//   progress key: deck_id + '_' + card_index
// ─────────────────────────────────────────────────────────────
import { useState, useCallback, useEffect, useRef } from 'react';
import { sb } from '@/lib/supabase';
import { SRS_INTERVALS, CARD_SETTINGS_KEY } from '@/lib/constants';
import type { Profile } from './useAuth';

export interface AnkiFolder { id: string; name: string; is_admin: boolean; user_id?: string; }

/** Card object stored as JSON inside anki_decks.cards column */
export interface AnkiCard {
  word: string;
  reading?: string;
  han_viet?: string;
  word_type?: string;
  meaning?: string;
  meaning_jp?: string;
  examples?: unknown[];
  vocab_id?: string | null;
  /** "grammar" → render layout ngữ pháp ở mặt sau; mặc định = "vocab" */
  kind?: "vocab" | "grammar";
  /** index injected at runtime when building study queue */
  _idx?: number;
  [key: string]: unknown;
}

export interface AnkiDeck {
  id: string;
  name: string;
  is_admin: boolean;
  folder_id?: string | null;
  user_id?: string | null;
  /** Cards stored as JSONB array in the deck row itself */
  cards: AnkiCard[];
}

export interface SrsEntry {
  interval_level: number;
  /** ISO date string */
  next_review: string;
}

export interface StudyItem { card: AnkiCard; idx: number; prog: SrsEntry | null; }

export interface CardSettings {
  frontMode: 'word' | 'meaning';
  showExamples: boolean;
  batchSize: number;
}

const DEFAULT_SETTINGS: CardSettings = { frontMode: 'word', showExamples: true, batchSize: 10 };

const STUDY_SESSION_KEY = 'jlptbro-anki-study-session';
const LOAD_RETRY_DELAY_MS = 450;

function loadCardSettings(): CardSettings {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(CARD_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function isPremiumForAnki(profile: Profile | null): boolean {
  // Anki mở cho mọi tài khoản đã đăng nhập (bao gồm tài khoản free).
  return !!profile;
}

export function useAnki(profile: Profile | null) {
  const profileId = profile?.id ?? null;
  const [folders,     setFolders]     = useState<AnkiFolder[]>([]);
  const [decks,       setDecks]       = useState<AnkiDeck[]>([]);
  const [progress,    setProgress]    = useState<Record<string, SrsEntry>>({});
  const [folderOpen,  setFolderOpen]  = useState<Record<string, boolean>>({});
  const [loaded,      setLoaded]      = useState(false);
  const [studyDeck,   setStudyDeck]   = useState<AnkiDeck | null>(null);
  const [studyQueue,  setStudyQueue]  = useState<StudyItem[]>([]);
  const [studyPos,    setStudyPos]    = useState(0);
  const [flipped,     setFlipped]     = useState(false);
  const [settings,    setSettings]    = useState<CardSettings>({ ...DEFAULT_SETTINGS });
  const [totalDone,     setTotalDone]     = useState(0);
  const [totalTarget,   setTotalTarget]   = useState(0);
  const [totalLearning, setTotalLearning] = useState(0);
  const loadSeqRef = useRef(0);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    try { localStorage.removeItem(STUDY_SESSION_KEY); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setSettings(loadCardSettings());
  }, []);

  const loadAnki = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const isCurrent = () => seq === loadSeqRef.current;
    setLoaded(false);

    // Filter:
    //   • logged-in user → admin decks (public templates) + their own decks
    //   • guest          → admin decks only (so the list isn't blank for guests)
    const filter = profileId
      ? `is_admin.eq.true,user_id.eq.${profileId}`
      : `is_admin.eq.true`;

    try {
      let fData: unknown[] | null = null;
      let dData: unknown[] | null = null;
      let fErr: { message: string } | null = null;
      let dErr: { message: string } | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const [foldersRes, decksRes] = await Promise.all([
          sb.from('anki_folders').select('*').or(filter).order('created_at'),
          sb.from('anki_decks').select('*').or(filter).order('created_at'),
        ]);
        fData = foldersRes.data as unknown[] | null;
        dData = decksRes.data as unknown[] | null;
        fErr = foldersRes.error;
        dErr = decksRes.error;
        const gotRows = (fData?.length ?? 0) > 0 || (dData?.length ?? 0) > 0;
        if (!fErr && !dErr && gotRows) break;
        if (!fErr && !dErr && attempt === 2) break;
        await sleep(LOAD_RETRY_DELAY_MS * (attempt + 1));
      }

      if (!isCurrent()) return;
      if (fErr || dErr) {
        if (fErr) console.error('[Anki] load folders:', fErr.message);
        if (dErr) console.error('[Anki] load decks:', dErr.message);
        return;
      }

      setFolders((prev) => {
        const next = (fData ?? []) as AnkiFolder[];
        return next.length > 0 || prev.length === 0 ? next : prev;
      });
      const safeDecks = ((dData ?? []) as AnkiDeck[]).map((d) => ({
        ...d,
        cards: Array.isArray(d.cards) ? d.cards : [],
      }));
      setDecks((prev) => safeDecks.length > 0 || prev.length === 0 ? safeDecks : prev);

      // Load SRS progress — only meaningful for logged-in users; skip for guests
      if (!profileId) {
        setProgress({});
        setLoaded(true);
        return;
      }

      const { data: prog, error: pErr } = await sb
        .from('anki_card_progress')
        .select('*');
      if (!isCurrent()) return;
      if (pErr) {
        console.error('[Anki] load progress:', pErr.message);
      } else {
        const map: Record<string, SrsEntry> = {};
        (prog as { deck_id: string; card_index: number; interval_level: number; next_review: string }[] | null ?? []).forEach((r) => {
          map[`${r.deck_id}_${r.card_index}`] = {
            interval_level: r.interval_level,
            next_review: r.next_review,
          };
        });
        setProgress(map);
      }
      setLoaded(true);
    } catch (err) {
      if (!isCurrent()) return;
      console.error('[Anki] load failed:', err);
    }
  }, [profileId]);

  useEffect(() => {
    loadSeqRef.current++;
    setLoaded(false);
    setProgress({});
    setStudyDeck(null);
    setStudyQueue([]);
    setStudyPos(0);
    setFlipped(false);
  }, [profileId]);

  const getDeckStats = useCallback((deck: AnkiDeck) => {
    const now = Date.now();
    let newCount = 0, reviewCount = 0;
    (deck.cards || []).forEach((_, idx) => {
      const p = progress[`${deck.id}_${idx}`];
      if (!p) newCount++;
      else if (new Date(p.next_review).getTime() <= now) reviewCount++;
    });
    return { newCount, reviewCount, total: deck.cards.length };
  }, [progress]);

  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const startStudy = useCallback((deck: AnkiDeck) => {
    const now = Date.now();
    const batch = settings.batchSize;
    const reviewDue: StudyItem[] = [];
    const unseenDue: StudyItem[] = [];

    (deck.cards || []).forEach((card, idx) => {
      const prog = progress[`${deck.id}_${idx}`] ?? null;
      const nextReview = prog ? new Date(prog.next_review).getTime() : 0;
      if (!prog || nextReview <= now) {
        const item: StudyItem = { card, idx, prog };
        if (prog) reviewDue.push(item);
        else unseenDue.push(item);
      }
    });

    const allDue = [...shuffle(reviewDue), ...shuffle(unseenDue)];
    const limited = batch > 0 && allDue.length > batch ? allDue.slice(0, batch) : allDue;

    setStudyDeck(deck);
    setStudyQueue(limited);
    setStudyPos(0);
    setFlipped(false);
    setTotalDone(0);
    setTotalLearning(0);
    setTotalTarget(limited.length);
  }, [settings.batchSize, progress]);

  const flipCard = useCallback(() => setFlipped((f) => !f), []);

  const rateCard = useCallback(async (known: boolean) => {
    if (!studyDeck || !profile?.id) return;
    const item = studyQueue[studyPos];
    if (!item) return;
    const { idx } = item;
    const key = `${studyDeck.id}_${idx}`;
    const cur = progress[key];
    let lvl = cur ? cur.interval_level : 0;

    if (known) {
      lvl = Math.min(lvl + 1, SRS_INTERVALS.length - 1);
      const nextReview = new Date(Date.now() + SRS_INTERVALS[lvl] * 60 * 1000).toISOString();
      setProgress((p) => ({ ...p, [key]: { interval_level: lvl, next_review: nextReview } }));
      sb.from('anki_card_progress').upsert(
        {
          user_id: profile.id,
          deck_id: studyDeck.id,
          card_index: idx,
          interval_level: lvl,
          next_review: nextReview,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,deck_id,card_index' },
      ).then(({ error }) => {
        if (error) console.error('[Anki] upsert progress:', error.message);
      });
    } else {
      // Move card to end of queue — same behaviour as original (re-learn)
      setStudyQueue((q) => {
        const cur = q[studyPos];
        if (!cur) return q;
        const next = [...q];
        next.splice(studyPos, 1);
        next.push({ ...cur, prog: null });
        return next;
      });
      setTotalLearning((d) => d + 1);
      setProgress((p) => { const n = { ...p }; delete n[key]; return n; });
      // RLS-scoped DELETE — no need to filter user_id explicitly.
      sb.from('anki_card_progress')
        .delete()
        .eq('deck_id', studyDeck.id)
        .eq('card_index', idx)
        .then(({ error }) => {
          if (error) console.error('[Anki] delete progress:', error.message);
        });
      setFlipped(false);
      return; // pos stays the same — next item fills in
    }

    setTotalDone((d) => d + 1);
    setStudyPos((p) => p + 1);
    setFlipped(false);
  }, [studyDeck, studyQueue, studyPos, profile, progress]);

  const closeStudy = useCallback(() => {
    setStudyDeck(null); setStudyQueue([]); setStudyPos(0); setFlipped(false);
    setTotalDone(0); setTotalTarget(0); setTotalLearning(0);
    try { localStorage.removeItem(STUDY_SESSION_KEY); } catch { /* ignore */ }
  }, []);

  const toggleFolder = useCallback((id: string) => {
    setFolderOpen((f) => ({ ...f, [id]: !f[id] }));
  }, []);

  const updateSettings = useCallback((patch: Partial<CardSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try { localStorage.setItem(CARD_SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const isPremium = isPremiumForAnki(profile);

  return {
    folders, decks, progress, folderOpen, loaded, isPremium,
    studyDeck, studyQueue, studyPos, flipped, settings,
    totalDone, totalTarget, totalLearning,
    loadAnki, getDeckStats, startStudy, flipCard, rateCard, closeStudy,
    toggleFolder, updateSettings,
  };
}
