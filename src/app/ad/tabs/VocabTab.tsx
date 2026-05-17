"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { sb } from "@/lib/supabase";
import { adminCall, AdminApiError } from "@/lib/adminApi";

interface VocabEntry {
  id?: string | number;
  word: string;
  reading?: string;
  han_viet?: string;
  word_type?: string;
  meaning: string;
  meaning_jp?: string;
  jlpt_level?: string;
  examples?: string[];
  /** Optional inflection / variant forms — looked up by the in-exam
   *  vocab popup so 「飲んで」 in a passage maps back to the canonical
   *  「飲む」 entry. Defaults to [] in DB. */
  variants?: string[];
}

type EditingEntry = Partial<VocabEntry> & { examples?: string[] };

const WORD_TYPES = ["名詞","動詞","サ変動詞","形容詞","な形容詞","副詞","助詞","接続詞","感動詞","助動詞","その他"];
const PAGE_SIZE = 50;

// ── Verb-group detection ─────────────────────────────────────────────
// 1. ICHIDAN_EXCEPTIONS: verbs that LOOK godan-ru-ish but are actually
//    ichidan (single-stem). Anything in here forces ichidan conjugation.
// 2. GODAN_RU_EXCEPTIONS: verbs ending in る that look ichidan-ish but
//    are godan. Forces godan conjugation.
// 3. Default: any of the listed ichidanEndings → ichidan; else godan.
//
// Lists are intentionally explicit rather than ML — the heuristic only
// has to be good enough to prefill the variants hint; admins eyeball
// before saving.
const ICHIDAN_EXCEPTIONS = new Set([
  '浴びる','居る','いる','起きる','降りる','借りる','着る','足りる','できる',
  '信じる','落ちる','過ぎる','閉じる','生きる','飽きる','伸びる','尽きる',
  '老いる','似る','煮る','率いる','用いる','染みる','しみる','堕ちる',
  '朽ちる','満ちる','恥じる','滅びる','報いる','混じる','混じえる',
  '見る','出る','寝る','食べる','教える','覚える','考える','答える',
  '調べる','集める','始める','続ける','変える','伝える','見せる',
  '見える','聞こえる','求める','受ける','負ける','分ける','開ける',
  '閉める','決める','認める','進める','止める','支える','迎える',
  '超える','越える','得る','寄せる','乗せる','任せる','捨てる',
  '建てる','当てる','慣れる','離れる','忘れる','触れる','晴れる',
  '疲れる','壊れる','売れる','取れる','切れる','折れる','汚れる',
]);

const GODAN_RU_EXCEPTIONS = new Set([
  '帰る','切る','知る','入る','走る','蹴る','しゃべる','滑る','握る',
  '焦る','限る','座る','乗る','降る','通る','売る','取る','作る',
  '送る','配る','困る','頑張る','終わる','始まる','変わる','分かる',
  '助かる','泊まる','集まる','決まる','止まる','太る','眠る','曲がる',
  '上がる','下がる','広がる','繋がる','振る','張る','誇る','喋る','嵌る',
]);

function isIchidan(word: string): boolean {
  if (ICHIDAN_EXCEPTIONS.has(word)) return true;
  if (GODAN_RU_EXCEPTIONS.has(word)) return false;
  const ichidanEndings = [
    'える','ける','げる','せる','てる','ねる','べる','める','れる',
    'いる','きる','ぎる','じる','ちる','にる','ひる','びる','みる','りる',
  ];
  return ichidanEndings.some((e) => word.endsWith(e));
}

// ── Verb conjugator ──────────────────────────────────────────────────
// Special cases at the top cover irregulars that ignore the godan/
// ichidan rules. Returns [] when the word doesn't look like a verb the
// heuristic understands (admin can still type variants manually).
function generateVerbForms(word: string): string[] {
  if (word === 'ある') return ['あって','あった','ない','なかった','あります','ありません','あれば','あろう'];
  if (word === '行く' || word === 'いく') return ['行って','いって','行った','いった','行かない','いかない','行きます','いきます','行ける','いける','行こう','いこう','行けば'];
  if (word === 'くださる') return ['くださって','くださった','くださいます','くださいません','ください'];
  if (word === 'いらっしゃる') return ['いらっしゃって','いらっしゃった','いらっしゃいます','いらっしゃいません','いらっしゃい'];
  if (word === 'なさる') return ['なさって','なさった','なさいます','なさいません','なさい'];
  if (word === 'おっしゃる') return ['おっしゃって','おっしゃった','おっしゃいます','おっしゃいません'];
  if (word === 'ございます' || word === 'ござる') return ['ございます','ございません','ございました','ございませんでした'];
  if (word === 'ない') return ['なくて','なかった','なくない','なくなかった','なくなる','なければ'];
  if (word === '問う' || word === 'とう') {
    return ['問って','問うて','問った','問わない','問わなかった',
            '問います','問いません','問える','問おう','問えば'];
  }
  if (word === 'です') {
    return ['ではない','じゃない','でした','ではなかった',
            'じゃなかった','でしょう','であれば','だ','だった'];
  }

  const w = word.trim();
  if (!w) return [];

  // Ichidan (一段) — drop final る, append ending.
  if (isIchidan(w)) {
    const stem = w.slice(0, -1);
    return [
      stem+'て', stem+'た', stem+'ない', stem+'なかった',
      stem+'ます', stem+'ません', stem+'ました',
      stem+'られる',       // 受身 / 可能
      stem+'させる',       // 使役
      stem+'させられる',   // 使役受身
      stem+'よう',         // 意志
      stem+'れば',         // 条件
      stem+'ながら', stem+'たり', stem+'たら', stem+'ても',
      stem+'ている', stem+'てから',
    ];
  }

  // Godan (五段) — endings depend on the final mora.
  const godanMap: Record<string, {
    te: string; ta: string; neg: string; masu: string;
    passive: string; causative: string; potential: string;
    volitional: string; conditional: string;
  }> = {
    'う': { te:'って', ta:'った', neg:'わない', masu:'い', passive:'われる', causative:'わせる', potential:'える', volitional:'おう', conditional:'えば' },
    'く': { te:'いて', ta:'いた', neg:'かない', masu:'き', passive:'かれる', causative:'かせる', potential:'ける', volitional:'こう', conditional:'けば' },
    'ぐ': { te:'いで', ta:'いだ', neg:'がない', masu:'ぎ', passive:'がれる', causative:'がせる', potential:'げる', volitional:'ごう', conditional:'げば' },
    'す': { te:'して', ta:'した', neg:'さない', masu:'し', passive:'される', causative:'させる', potential:'せる', volitional:'そう', conditional:'せば' },
    'つ': { te:'って', ta:'った', neg:'たない', masu:'ち', passive:'たれる', causative:'たせる', potential:'てる', volitional:'とう', conditional:'てば' },
    'ぬ': { te:'んで', ta:'んだ', neg:'なない', masu:'に', passive:'なれる', causative:'なせる', potential:'ねる', volitional:'のう', conditional:'ねば' },
    'ぶ': { te:'んで', ta:'んだ', neg:'ばない', masu:'び', passive:'ばれる', causative:'ばせる', potential:'べる', volitional:'ぼう', conditional:'べば' },
    'む': { te:'んで', ta:'んだ', neg:'まない', masu:'み', passive:'まれる', causative:'ませる', potential:'める', volitional:'もう', conditional:'めば' },
    'る': { te:'って', ta:'った', neg:'らない', masu:'り', passive:'られる', causative:'らせる', potential:'れる', volitional:'ろう', conditional:'れば' },
  };

  const lastChar = w.slice(-1);
  const stem = w.slice(0, -1);
  const g = godanMap[lastChar];
  if (!g) return [];

  return [
    stem+g.te, stem+g.ta, stem+g.neg,
    stem+g.neg.slice(0, -1)+'なかった',
    stem+g.masu+'ます', stem+g.masu+'ません', stem+g.masu+'ました',
    stem+g.passive,                          // 受身
    stem+g.causative,                        // 使役
    stem+g.causative.slice(0, -1)+'られる',  // 使役受身
    stem+g.potential,                        // 可能
    stem+g.volitional,                       // 意志
    stem+g.conditional,                      // 条件
    stem+g.te+'いる',                        // ている
    stem+g.te+'から',                        // てから
    stem+g.ta+'り',                          // たり
    stem+g.ta+'ら',                          // たら
    stem+g.masu+'ながら',                    // ながら
  ];
}

// ── i-adjective conjugator ──
function generateIAdjectiveForms(word: string): string[] {
  if (word === 'いい' || word === '良い') return ['よく','よくて','よくない','よくなかった','よかった','よければ','よくなる','よさ'];

  const w = word.trim();
  if (!w || !w.endsWith('い')) return [];
  const stem = w.slice(0, -1);
  return [
    stem+'く',      stem+'くて',
    stem+'くない',  stem+'くなかった',
    stem+'かった',  stem+'ければ',
    stem+'くなる',  stem+'さ',
  ];
}

// ── na-adjective conjugator (uses the copula since na-adj itself
// doesn't inflect — these are the forms learners look for). ──
function generateNaAdjectiveForms(word: string): string[] {
  const w = word.trim();
  if (!w) return [];
  return [
    w+'な',       // attributive
    w+'に',       // adverbial
    w+'だ',       // plain assertive
    w+'です',     // polite
    w+'でした',   // polite past
    w+'じゃない',
    w+'じゃなかった',
    w+'で',       // te-form
    w+'なら',     // conditional
  ];
}

// ── Hint dispatcher ──
// Picks the right generator from word_type when available; falls back
// to ending-based detection. Returned string is what shows under the
// empty variants field (admin copy-pastes / edits).
function generateHint(word: string, wordType: string): string {
  if (!word) return "";

  const wt = (wordType ?? "").toLowerCase();
  if (wt.includes("động từ") || wt.includes("動詞") || wt.includes("verb")) {
    return generateVerbForms(word).join(", ");
  }
  if (wt.includes("tính từ い") || wt.includes("i-adj") || wt.includes("形容詞")) {
    return generateIAdjectiveForms(word).join(", ");
  }
  if (wt.includes("tính từ な") || wt.includes("na-adj") || wt.includes("形容動詞")) {
    return generateNaAdjectiveForms(word).join(", ");
  }

  // Fallback: detect by ending.
  if (["る","う","く","ぐ","す","つ","ぬ","ぶ","む"].some((e) => word.endsWith(e))) {
    return generateVerbForms(word).join(", ");
  }
  if (word.endsWith("い") && word !== "ない") {
    return generateIAdjectiveForms(word).join(", ");
  }
  return "";
}

function normalizeVocabWordType(raw: string): string | null {
  if (!raw) return null;
  const full = raw.trim();
  if (!full) return null;
  const noParen = full.replace(/[（(].*$/g, "").replace(/[)）].*$/g, "").trim() || full;
  const t = noParen.replace(/　/g, " ").replace(/\s+/g, "");
  const CANON = ["名詞","動詞","サ変動詞","形容詞","な形容詞","副詞","助詞","接続詞","感動詞","助動詞","その他"];
  if (CANON.includes(t)) return t;
  const v = noParen + " " + full;
  if (/danh\s*đ[ộo]ng/i.test(v)) return "サ変動詞";
  if (/danh\s*t[ừu]/i.test(v) && !/đ[ộo]ng/i.test(v)) return "名詞";
  if (/đ[ộo]ng\s*t[ừu]/i.test(v) && !/danh.*đ[ộo]ng/i.test(v)) return "動詞";
  if (/t[íi]nh.*い|い.*形容/i.test(v)) return "形容詞";
  if (/t[íi]nh.*な|な.*形容/i.test(v)) return "な形容詞";
  if (/tr[ạa]ng\s*t[ừu]/i.test(v)) return "副詞";
  if (/tr[ợo]\s*t[ừu]|助詞/i.test(v)) return "助詞";
  if (/t[háa]n\s*t[ừu]|感動/i.test(v)) return "感動詞";
  if (t.includes("サ変")) return "サ変動詞";
  if (t === "名" || t.startsWith("名詞")) return "名詞";
  if (t.includes("助動")) return "助動詞";
  if (t === "動" || t.includes("動詞")) return "動詞";
  if (t === "い" || t.startsWith("イ形容") || t.includes("い形容")) return "形容詞";
  if (t.startsWith("な形容")) return "な形容詞";
  if (t.includes("形容詞")) return "形容詞";
  if (t === "副" || t.includes("副詞")) return "副詞";
  if (t === "助詞" || t.includes("助詞")) return "助詞";
  if (t.startsWith("接続")) return "接続詞";
  if (t.startsWith("感動")) return "感動詞";
  if (t === "その他" || /^(others?|kh[áa]c|misc)$/i.test(full)) return "その他";
  return null;
}

/** Strip characters that would break a PostgREST .ilike() operand. */
function escapeIlike(q: string): string {
  return q.replace(/[%,()*]/g, "").trim();
}

export default function VocabTab() {
  // ── Server-side pagination state (replaces in-memory `all` + `filtered`) ──
  const [rows, setRows]                 = useState<VocabEntry[]>([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(0);
  const [loading, setLoading]           = useState(false);
  const [query, setQuery]               = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [levelFilter, setLevelFilter]   = useState("");
  const [dbStats, setDbStats]           = useState<{ total: number; n5: number; n4: number; n3up: number } | null>(null);
  const [editEntry, setEditEntry]       = useState<EditingEntry | null>(null);
  const [editOpen, setEditOpen]         = useState(false);
  const [editingId, setEditingId]       = useState<string | number | null>(null);
  const [editErr, setEditErr]           = useState("");
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState({ msg: "", type: "default" });
  const importRef                       = useRef<HTMLInputElement>(null);
  // Bulk-select để xoá nhiều dòng cùng lúc
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy]         = useState(false);

  // Nhập ví dụ hàng loạt (đính vào examples của vocabulary_library + grammar_library)
  const [examplesOpen,   setExamplesOpen]   = useState(false);
  const [examplesRaw,    setExamplesRaw]    = useState("");
  const [examplesBusy,   setExamplesBusy]   = useState(false);
  const [examplesErr,    setExamplesErr]    = useState("");
  const [examplesResult, setExamplesResult] = useState<null | {
    linesParsed: number; linesAttached: number;
    vocabUpdated: number; grammarUpdated: number;
    attachedCount: number; unmatchedTerms: string[];
    pendingSaved: number;
  }>(null);

  function showToast(msg: string, type = "default") {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "default" }), 2800);
  }

  // Đếm trực tiếp từ DB — không phụ thuộc vào dữ liệu đã tải về
  const loadStats = useCallback(async () => {
    const [resTotal, resN5, resN4, resN3up] = await Promise.all([
      sb.from("vocabulary_library").select("*", { count: "exact", head: true }),
      sb.from("vocabulary_library").select("*", { count: "exact", head: true }).eq("jlpt_level", "N5"),
      sb.from("vocabulary_library").select("*", { count: "exact", head: true }).eq("jlpt_level", "N4"),
      sb.from("vocabulary_library").select("*", { count: "exact", head: true }).in("jlpt_level", ["N3","N2","N1"]),
    ]);
    setDbStats({
      total: resTotal.count  ?? 0,
      n5:    resN5.count     ?? 0,
      n4:    resN4.count     ?? 0,
      n3up:  resN3up.count   ?? 0,
    });
  }, []);

  // Parse client-side để hiện preview trước khi submit.
  // Hỗ trợ furigana form {(漢字)(かな)} bên trong ＜＞ / 「」 — term thực
  // là phần kanji A, còn câu sạch giữ {(A)(B)} cho renderer flashcard.
  function parseExamplesPreview(raw: string) {
    const vocabRe   = /[＜<]([^＞>]+)[＞>]/g;
    // [] và 「」『』 đều nhận diện là grammar marker
    const grammarRe = /\[([^\]]+)\]/g;
    const stripFuri = (s: string) => s.replace(/\{\(([^)]*)\)\([^)]*\)\}/g, "$1").trim();
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const arrowIdx = line.indexOf("→");
      const jpRaw = arrowIdx >= 0 ? line.slice(0, arrowIdx).trim() : line;
      const vi    = arrowIdx >= 0 ? line.slice(arrowIdx + 1).trim() : "";
      const v: string[] = []; const g: string[] = [];
      for (const m of jpRaw.matchAll(vocabRe)) v.push(stripFuri(m[1]));
      for (const m of jpRaw.matchAll(grammarRe)) {
        const inner = m[1].replace(/[＜<]([^＞>]+)[＞>]/g, "$1");
        g.push(stripFuri(inner));
      }
      const jp = jpRaw.replace(vocabRe, "$1").replace(grammarRe, "$1").trim();
      return { jp, vi, vocab: Array.from(new Set(v)), grammar: Array.from(new Set(g)) };
    });
  }

  async function submitExamples() {
    if (!examplesRaw.trim()) { setExamplesErr("Hãy dán ít nhất 1 câu."); return; }
    setExamplesErr(""); setExamplesBusy(true); setExamplesResult(null);
    try {
      const res = await adminCall("/api/admin/vocab", { action: "attach_examples", raw: examplesRaw }) as {
        linesParsed: number; linesAttached: number;
        vocabUpdated: number; grammarUpdated: number;
        attachedCount: number; unmatchedTerms: string[];
        pendingSaved: number;
      };
      setExamplesResult(res);
      const toastMsg = res.pendingSaved > 0
        ? `Đã đính ${res.attachedCount} ví dụ ✓ · ${res.pendingSaved} câu chưa khớp đã lưu vào hàng chờ`
        : `Đã đính ${res.attachedCount} ví dụ vào ${res.vocabUpdated} từ vựng + ${res.grammarUpdated} ngữ pháp ✓`;
      showToast(toastMsg, "success");
      void loadPage(); void loadStats();
    } catch (err) {
      setExamplesErr(err instanceof AdminApiError ? err.message : "Lỗi không rõ");
    } finally {
      setExamplesBusy(false);
    }
  }

  // Server-side fetch — only the current page. `examples` deliberately
  // excluded from the list query (it's a heavy jsonb column unused in
  // the grid; openVocabForm fetches the full row when needed).
  const loadPage = useCallback(async () => {
    setLoading(true);
    let qb = sb
      .from("vocabulary_library")
      .select("id,word,reading,han_viet,word_type,meaning,meaning_jp,jlpt_level,variants", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (levelFilter) qb = qb.eq("jlpt_level", levelFilter);
    const safeQuery = escapeIlike(debouncedQuery);
    if (safeQuery) {
      // PostgREST .or() syntax: column.op.value, comma-separated.
      qb = qb.or(
        `word.ilike.%${safeQuery}%,` +
        `reading.ilike.%${safeQuery}%,` +
        `meaning.ilike.%${safeQuery}%,` +
        `meaning_jp.ilike.%${safeQuery}%,` +
        `han_viet.ilike.%${safeQuery}%`,
      );
    }

    const { data, count, error } = await qb;
    if (error) {
      showToast("Lỗi: " + error.message, "error");
      setLoading(false);
      return;
    }
    setRows((data ?? []) as VocabEntry[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, levelFilter, debouncedQuery]);

  // Debounce the search input — only fire the server query 300ms after
  // the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to page 0 when search/filter changes (otherwise user could be
  // on page 5 of an old result set with no rows in the new one).
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, levelFilter]);

  // Initial load + every page/filter change.
  useEffect(() => { void loadPage(); }, [loadPage]);
  useEffect(() => { void loadStats(); }, [loadStats]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const lvlColor: Record<string, string> = { N5:"#9B59B6",N4:"#3498db",N3:"#2ecc71",N2:"#e67e22",N1:"#e74c3c" };

  async function openVocabForm(vocab?: VocabEntry) {
    setEditErr("");
    if (!vocab) {
      setEditingId(null);
      setEditEntry({ word: "", reading: "", han_viet: "", word_type: "", meaning: "", meaning_jp: "", jlpt_level: "", examples: [""], variants: [] });
      setEditOpen(true);
      return;
    }
    // Editing an existing row — the list query doesn't include `examples`
    // (heavy jsonb), so fetch the full row now. Open the modal immediately
    // with what we have so the user sees something instantly.
    setEditingId(vocab.id ?? null);
    setEditEntry({ ...vocab, examples: [] });
    setEditOpen(true);
    if (vocab.id != null) {
      const { data, error } = await sb
        .from("vocabulary_library")
        .select("*")
        .eq("id", vocab.id)
        .maybeSingle();
      if (error) { showToast("Lỗi tải ví dụ: " + error.message, "error"); return; }
      if (data) {
        setEditEntry({
          ...(data as VocabEntry),
          examples: Array.isArray((data as VocabEntry).examples) ? [...(data as VocabEntry).examples!] : [],
        });
      }
    }
  }

  function setExamples(exs: string[]) {
    setEditEntry((p) => p ? { ...p, examples: exs } : p);
  }

  async function saveVocab() {
    if (!editEntry?.word?.trim() || !editEntry?.reading?.trim() || !editEntry?.meaning?.trim()) {
      setEditErr("Vui lòng nhập đủ: Từ vựng, Cách đọc, Nghĩa."); return;
    }
    setSaving(true); setEditErr("");
    const payload: Omit<VocabEntry, "id"> = {
      word:       editEntry.word!.trim(),
      reading:    editEntry.reading?.trim() || "",
      meaning:    editEntry.meaning!.trim(),
      meaning_jp: editEntry.meaning_jp?.trim() || null as unknown as string,
      han_viet:   editEntry.han_viet?.trim() || null as unknown as string,
      word_type:  editEntry.word_type || null as unknown as string,
      jlpt_level: editEntry.jlpt_level || null as unknown as string,
      examples:   (editEntry.examples ?? []).filter(Boolean),
      variants:   (editEntry.variants ?? []).filter(Boolean),
    };
    try {
      if (editingId) {
        await adminCall("/api/admin/vocab", { action: "update", id: String(editingId), payload });
      } else {
        await adminCall("/api/admin/vocab", { action: "create", payload });
      }
    } catch (err) {
      setSaving(false);
      setEditErr("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"));
      return;
    }
    setSaving(false);
    showToast(editingId ? "Đã cập nhật từ vựng ✓" : "Đã thêm từ vựng ✓", "success");
    setEditOpen(false); setEditEntry(null); setEditingId(null);
    void loadPage(); void loadStats();
  }

  async function deleteVocab(id: string | number, word: string) {
    if (!confirm(`Xóa từ "${word}"? Không thể hoàn tác.`)) return;
    try {
      await adminCall("/api/admin/vocab", { action: "delete", id: String(id) });
    } catch (err) {
      showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
      return;
    }
    showToast(`Đã xóa "${word}" ✓`, "success");
    void loadPage(); void loadStats();
  }

  // ── Bulk select / delete ──────────────────────────────────────────────
  function toggleSelect(id: string | number | undefined) {
    if (id == null) return;
    const key = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Tick / untick toàn bộ row của trang hiện tại (= những row user đang nhìn thấy). */
  function toggleSelectAllFiltered() {
    const visibleIds = rows.map((v) => v.id).filter((x): x is string | number => x != null).map(String);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  async function bulkDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Xoá ${selectedIds.size} từ vựng đã chọn? Không thể hoàn tác.`)) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    let okCount = 0, failCount = 0; let lastErr = "";
    for (const id of ids) {
      try {
        await adminCall("/api/admin/vocab", { action: "delete", id });
        okCount++;
      } catch (err) {
        failCount++;
        lastErr = err instanceof AdminApiError ? err.message : "không rõ";
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (failCount === 0) showToast(`Đã xoá ${okCount} từ ✓`, "success");
    else showToast(`Xoá ${okCount}/${ids.length} — ${failCount} lỗi (${lastErr})`, "error");
    void loadPage(); void loadStats();
  }

  async function importVocabExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    showToast("Đang đọc file Excel...");
    try {
      const _xl = await import("xlsx"); const XLSX = (_xl.default ?? _xl) as typeof _xl;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
      const firstCell = String(rows[0]?.[0] || "").trim();
      const startIdx = (firstCell === "Từ vựng" || firstCell === "Word") ? 1 : 0;
      const dataRows = rows.slice(startIdx)
        .filter((r) => String(r[0] || "").trim())
        .map((r) => {
          // Column G is the new jlpt_level slot (added 2026-05). For
          // forward-compat with files exported by the new template we
          // expect "N1".."N5" there; for files from the OLD template
          // (where G was just the first example), fall back to
          // treating G+ as examples and default the level to "N5".
          const rawLevel = String(r[6] || "").trim().toUpperCase();
          const hasLevel = ["N1", "N2", "N3", "N4", "N5"].includes(rawLevel);
          return {
            word:        String(r[0] || "").trim(),
            reading:     String(r[1] || "").trim(),
            han_viet:    String(r[2] || "").trim() || null,
            word_type:   String(r[3] || "").trim() || null,
            meaning:     String(r[4] || "").trim(),
            meaning_jp:  String(r[5] || "").trim() || null,
            jlpt_level:  hasLevel ? rawLevel : "N5",
            examples:   (hasLevel ? r.slice(7) : r.slice(6))
                          .map((c) => String(c).trim()).filter(Boolean),
          };
        })
        .filter((r) => r.word && r.meaning);
      if (!dataRows.length) { showToast("File không có dữ liệu hợp lệ.", "error"); return; }
      showToast("Đang cập nhật thư viện...");
      let done = 0;
      for (let i = 0; i < dataRows.length; i += 50) {
        try {
          await adminCall("/api/admin/vocab", { action: "bulk_upsert", rows: dataRows.slice(i, i + 50) });
        } catch (err) {
          showToast("Lỗi import: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
          return;
        }
        done += Math.min(50, dataRows.length - i);
      }
      showToast(`Đã import ${done} từ vựng ✓`, "success");
      void loadPage(); void loadStats();
    } catch (err: unknown) {
      showToast("Lỗi đọc file: " + (err as Error).message, "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  async function downloadTemplate() {
    const _xl = await import("xlsx"); const XLSX = (_xl.default ?? _xl) as typeof _xl;
    const ws = XLSX.utils.aoa_to_sheet([
      ["Từ vựng","Cách đọc (Hiragana)","Âm Hán Việt","Từ loại","Nghĩa tiếng Việt","Nghĩa tiếng Nhật","Cấp độ (N1-N5)","Ví dụ 1","Ví dụ 2","Ví dụ 3"],
      ["学校","がっこう","Học Hiệu","Danh từ","trường học","① 学校 ② 学びの場所","N5","学校に行く → Đi đến trường","学校が好きです → Tôi thích trường học",""],
      ["行く","いく","","Động từ","đi","① 行く ② 向かう","N5","学校に行く → Đi đến trường","",""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Từ vựng");
    XLSX.writeFile(wb, "vocab_template.xlsx");
  }

  return (
    <div id="tab-vocab" className="tab-pane" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div>
          <div className="topbar-title">Thư viện từ vựng</div>
          <div className="topbar-sub">Quản lý từ vựng — hiển thị trên trang học sinh</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => { void loadPage(); void loadStats(); }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>↻ Refresh</button>
          <button type="button" onClick={() => void downloadTemplate()} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>⬇ Template</button>
          <label style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>
            📥 Import Excel
            <input ref={importRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => void importVocabExcel(e)} />
          </label>
          <button type="button" onClick={() => setExamplesOpen((o) => !o)} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2DB87A", background: "#2DB87A15", color: "#2DB87A", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📝 Nhập ví dụ</button>
          <button type="button" onClick={() => openVocabForm()} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#6C6FF7", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Thêm từ</button>
        </div>
      </div>

      {examplesOpen && (() => {
        const preview = parseExamplesPreview(examplesRaw);
        return (
          <div id="vocab-examples-form" style={{ margin: "0 22px 16px", background: "#0d1a14", border: "1px solid #1f3a2c", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#9af0c2" }}>📝 Nhập ví dụ hàng loạt</div>
            <div style={{ fontSize: 11, color: "#5a8c73", marginBottom: 12, lineHeight: 1.65 }}>
              Đánh dấu <b style={{ color: "#aed6c0" }}>＜từ vựng＞</b> bằng ngoặc góc Nhật, <b style={{ color: "#aed6c0" }}>「ngữ pháp」</b> bằng ngoặc kép Nhật. Mỗi dòng 1 câu. Bản dịch tuỳ chọn sau dấu <code style={{ background: "#15291f", padding: "1px 5px", borderRadius: 4, color: "#aed6c0" }}>→</code>. Câu sẽ được đính trực tiếp vào trường <b style={{ color: "#aed6c0" }}>examples</b> của các từ vựng / ngữ pháp khớp.<br />
              <b style={{ color: "#aed6c0" }}>Furigana</b>: bọc <code style={{ background: "#15291f", padding: "1px 5px", borderRadius: 4, color: "#aed6c0" }}>{`{(漢字)(かな)}`}</code> bên trong ＜＞ — server tra theo phần kanji, câu hiển thị giữ ruby. VD: <code style={{ background: "#15291f", padding: "1px 5px", borderRadius: 4, color: "#aed6c0" }}>{`<{(簿記)(ぼき)}>の<資格>を取るために勉強している。`}</code> → tra `簿記` &amp; `資格`.<br />
              VD: <code style={{ background: "#15291f", padding: "1px 5px", borderRadius: 4, color: "#aed6c0" }}>＜私＞「にとって」＜家族＞は＜一番＞＜大切＞な＜物＞です。 → Đối với tôi, gia đình là điều quan trọng nhất.</code>
            </div>
            <textarea
              rows={6}
              value={examplesRaw}
              onChange={(e) => setExamplesRaw(e.target.value)}
              placeholder={"＜私＞「にとって」＜家族＞は＜一番＞＜大切＞な＜物＞です。 → Đối với tôi, gia đình là điều quan trọng nhất."}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #1f3a2c", background: "#0a120e", color: "#d3eedd", fontFamily: "Be Vietnam Pro,Noto Sans JP,monospace", fontSize: 13, outline: "none", resize: "vertical", lineHeight: 1.7, marginBottom: 12, boxSizing: "border-box" }}
            />

            {preview.length > 0 && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "#0a120e", border: "1px solid #1f3a2c", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#5a8c73", marginBottom: 8 }}>Xem trước {preview.length} câu — server sẽ tra theo word/name khớp:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {preview.slice(0, 8).map((p, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#aed6c0" }}>
                      <div style={{ marginBottom: 3 }}>{p.jp}{p.vi && <span style={{ color: "#5a8c73" }}> → {p.vi}</span>}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {p.vocab.map((v, j) => <span key={`v${j}`} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 99, background: "#2DB87A22", color: "#2DB87A", border: "1px solid #2DB87A55" }}>📖 {v}</span>)}
                        {p.grammar.map((g, j) => <span key={`g${j}`} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 99, background: "#6C6FF722", color: "#9b9eff", border: "1px solid #6C6FF755" }}>📐 {g}</span>)}
                        {p.vocab.length === 0 && p.grammar.length === 0 && <span style={{ fontSize: 10.5, color: "#E08A2B" }}>⚠ Không có ＜＞ hoặc 「」 — bị bỏ qua</span>}
                      </div>
                    </div>
                  ))}
                  {preview.length > 8 && <div style={{ fontSize: 11, color: "#5a8c73" }}>+{preview.length - 8} câu nữa...</div>}
                </div>
              </div>
            )}

            {examplesResult && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "#0a120e", border: "1px solid #1f3a2c", borderRadius: 8, fontSize: 12, color: "#aed6c0" }}>
                ✅ Parse {examplesResult.linesParsed} câu, đính {examplesResult.attachedCount} ví dụ vào {examplesResult.vocabUpdated} từ vựng và {examplesResult.grammarUpdated} ngữ pháp.
                {examplesResult.unmatchedTerms.length > 0 && (
                  <div style={{ marginTop: 6, color: "#E08A2B" }}>
                    ⚠ Chưa khớp ({examplesResult.unmatchedTerms.length}): {examplesResult.unmatchedTerms.join(", ")}
                    {examplesResult.pendingSaved > 0 && (
                      <span style={{ color: "#7ecff0", marginLeft: 6 }}>
                        → đã lưu vào hàng chờ, sẽ tự đính khi thêm từ/ngữ pháp đó vào từ điển.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {examplesErr && <div style={{ fontSize: 11, color: "#E05555", marginBottom: 10 }}>{examplesErr}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setExamplesOpen(false); setExamplesRaw(""); setExamplesResult(null); setExamplesErr(""); }} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, cursor: "pointer" }}>Đóng</button>
              <button onClick={submitExamples} disabled={examplesBusy || !examplesRaw.trim()} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#2DB87A", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, fontWeight: 700, cursor: examplesBusy ? "wait" : "pointer", opacity: examplesBusy || !examplesRaw.trim() ? 0.6 : 1 }}>
                {examplesBusy ? "Đang đính..." : "💾 Đính ví dụ"}
              </button>
            </div>
          </div>
        );
      })()}

      <div className="stats-row">
        <div className="stat-card"><div className="n" id="vs-total">{dbStats ? dbStats.total : "—"}</div><div className="l">Tổng từ vựng</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#9B59B6" }} id="vs-n5">{dbStats ? dbStats.n5 : "—"}</div><div className="l">N5</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#3498db" }} id="vs-n4">{dbStats ? dbStats.n4 : "—"}</div><div className="l">N4</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#2ecc71" }} id="vs-n3">{dbStats ? dbStats.n3up : "—"}</div><div className="l">N3 trở lên</div></div>
      </div>

      <div style={{ margin: "0 22px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="search-input" id="vocab-search" placeholder="🔍 Tìm từ vựng..." value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 240 }}
        />
        <select id="vocab-level-filter" value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12 }}>
          <option value="">Tất cả cấp độ</option>
          {["N5","N4","N3","N2","N1"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "#555" }}>
          {loading ? "Đang tải..." : `${total.toLocaleString()} từ${(debouncedQuery || levelFilter) ? " (đã lọc)" : ""}`}
        </span>
      </div>

      {/* Bulk-action bar — chỉ hiện khi đã tick ít nhất 1 dòng */}
      {selectedIds.size > 0 && (
        <div style={{ margin: "0 22px 12px", display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#2a0e0e", border: "1px solid #5a1f1f", borderRadius: 10 }}>
          <span style={{ fontSize: 12, color: "#f0a8a8", fontWeight: 600 }}>Đã chọn {selectedIds.size} từ</span>
          <button type="button" onClick={clearSelection} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #5a1f1f", background: "transparent", color: "#bbb", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>Bỏ chọn</button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void bulkDeleteSelected()}
            disabled={bulkBusy}
            title="Xoá các từ đã tick"
            style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#E05555", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, fontWeight: 700, cursor: bulkBusy ? "wait" : "pointer", opacity: bulkBusy ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            🗑 {bulkBusy ? "Đang xoá..." : `Xoá ${selectedIds.size} từ`}
          </button>
        </div>
      )}

      <div className="table-wrap" style={{ margin: "0 22px 22px" }}>
        <table>
          <thead><tr>
            <th style={{ width: 36, textAlign: "center" }}>
              <input
                type="checkbox"
                aria-label="Chọn tất cả"
                checked={rows.length > 0 && rows.every((v) => v.id != null && selectedIds.has(String(v.id)))}
                onChange={toggleSelectAllFiltered}
                style={{ cursor: "pointer" }}
              />
            </th>
            <th>Từ vựng</th><th>Cách đọc</th><th>Âm Hán Việt</th><th>Từ loại</th>
            <th>Nghĩa VI</th><th>Nghĩa JP</th><th>Cấp độ</th><th>Thao tác</th>
          </tr></thead>
          <tbody id="vocab-tbody">
            {loading && <tr><td colSpan={9} style={{ textAlign: "center", padding: 32, color: "#444" }}>Đang tải...</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 32, color: "#444" }}>Chưa có từ vựng nào.</td></tr>
            )}
            {!loading && rows.map((v) => {
              const lc = lvlColor[v.jlpt_level || ""] || "#555";
              const idKey = v.id != null ? String(v.id) : "";
              const checked = !!idKey && selectedIds.has(idKey);
              return (
                <tr key={v.id} style={{ background: checked ? "#1a1320" : undefined }}>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${v.word}`}
                      checked={checked}
                      onChange={() => toggleSelect(v.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ fontSize: 15, fontWeight: 700, color: "#e8e8e8" }}>{v.word || "—"}</td>
                  <td style={{ color: "#6C6FF7" }}>{v.reading || "—"}</td>
                  <td style={{ color: "#d4890a" }}>{v.han_viet || "—"}</td>
                  <td style={{ fontSize: 11, color: "#555" }}>{v.word_type || "—"}</td>
                  <td>{v.meaning || "—"}</td>
                  <td style={{ color: "#d0cfc8" }}>{v.meaning_jp || "—"}</td>
                  <td>
                    <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: lc + "18", color: lc }}>
                      {v.jlpt_level || "—"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="act-btn" onClick={() => void openVocabForm(v)}>✎ Sửa</button>
                    <button type="button" className="act-btn danger" onClick={() => void deleteVocab(v.id!, v.word)}>Xóa</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination bar — server-driven */}
        {!loading && total > 0 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "14px 0 4px", fontSize: 12, color: "#888" }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: page === 0 ? "#444" : "#bbb", cursor: page === 0 ? "not-allowed" : "pointer", fontSize: 12 }}
            >
              ← Trước
            </button>
            <span style={{ fontWeight: 600 }}>Trang {page + 1} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: page >= totalPages - 1 ? "#444" : "#bbb", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", fontSize: 12 }}
            >
              Sau →
            </button>
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {editOpen && editEntry !== null && (
        <div
          className="modal-overlay active"
          style={{ alignItems: "flex-start", padding: "40px 0", overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget && !editingId) setEditOpen(false); }}
        >
          <div id="vocab-modal" style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 14, width: "92%", maxWidth: 640, margin: "auto", padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div id="vocab-modal-title" style={{ fontSize: 15, fontWeight: 800 }}>{editingId ? "Sửa từ vựng" : "Thêm từ vựng"}</div>
              <button type="button" onClick={() => setEditOpen(false)} style={{ background: "transparent", border: "none", color: "#555", fontSize: 20, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {([
                { label: "Từ vựng *", field: "word", placeholder: "学校" },
                { label: "Cách đọc *", field: "reading", placeholder: "がっこう" },
                { label: "Âm Hán Việt", field: "han_viet", placeholder: "Học hiệu" },
                { label: "Từ loại", field: "word_type", placeholder: "Danh từ, Động từ..." },
              ] as { label: string; field: keyof EditingEntry; placeholder: string }[]).map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>{label}</label>
                  <input
                    value={String(editEntry[field] ?? "")}
                    onChange={(e) => setEditEntry((p) => p ? { ...p, [field]: e.target.value } : p)}
                    placeholder={placeholder}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Nghĩa tiếng Việt *</label>
                <input value={editEntry.meaning ?? ""} onChange={(e) => setEditEntry((p) => p ? { ...p, meaning: e.target.value } : p)} placeholder="Trường học" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Nghĩa tiếng Nhật</label>
                <input value={editEntry.meaning_jp ?? ""} onChange={(e) => setEditEntry((p) => p ? { ...p, meaning_jp: e.target.value } : p)} placeholder="① 学校 ② 学びの場所" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Cấp độ</label>
              <select value={editEntry.jlpt_level ?? ""} onChange={(e) => setEditEntry((p) => p ? { ...p, jlpt_level: e.target.value } : p)} style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }}>
                <option value="">—</option>
                {["N5","N4","N3","N2","N1"].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em" }}>Ví dụ</label>
                <button type="button" onClick={() => setExamples([...(editEntry.examples ?? []), ""])} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #2a2a2a", background: "transparent", color: "#6C6FF7", cursor: "pointer" }}>+ Thêm</button>
              </div>
              <div id="vf-examples-wrap">
                {(editEntry.examples ?? [""]).map((ex, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                    <input value={ex} placeholder="例：学校に行く → Đi đến trường" onChange={(e) => { const exs = [...(editEntry.examples ?? [])]; exs[idx] = e.target.value; setExamples(exs); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 7, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, outline: "none" }} />
                    <button type="button" onClick={() => setExamples((editEntry.examples ?? []).filter((_, i) => i !== idx))} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #2a2a2a", background: "transparent", color: "#E05555", cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            {/* Variants — comma-separated inflection / form list. Lookup
                in src/lib/vocabTag.ts falls back to .contains("variants",
                [surface]) so any of these forms in a passage opens the
                popup for the canonical word above. */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>
                Các dạng biến thể <span style={{ textTransform: "none", color: "#777", fontWeight: 500, marginLeft: 4 }}>(cách nhau bằng dấu phẩy)</span>
              </label>
              <input
                type="text"
                value={(editEntry.variants ?? []).join(", ")}
                onChange={(e) => setEditEntry((p) => p ? { ...p, variants: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : p)}
                placeholder="飲んで, 飲みます, 飲まない, 飲める..."
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }}
              />
              {(() => {
                const w = editEntry.word?.trim() ?? "";
                const noVariants = (editEntry.variants ?? []).length === 0;
                const hint = noVariants && w ? generateHint(w, editEntry.word_type ?? "") : "";
                if (!hint) {
                  return (
                    <div style={{ fontSize: 11, color: "#777", marginTop: 5 }}>
                      Nhập các dạng chia của từ để tự động nhận diện trong đề thi.
                    </div>
                  );
                }
                return (
                  <div style={{ fontSize: 11, color: "#9ea1ff", marginTop: 5 }}>
                    💡 Gợi ý cho <strong style={{ color: "#e8e8e8" }}>{w}</strong>: {hint}
                  </div>
                );
              })()}
            </div>
            {editErr && <div id="vf-err" style={{ color: "#E05555", fontSize: 12, marginBottom: 12 }}>{editErr}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="modal-cancel" style={{ flex: 1 }} onClick={() => setEditOpen(false)}>Hủy</button>
              <button type="button" id="vf-save-btn" disabled={saving} className="modal-confirm" style={{ flex: 2 }} onClick={() => void saveVocab()}>
                {saving ? "Đang lưu..." : "💾 Lưu từ vựng"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.msg && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
