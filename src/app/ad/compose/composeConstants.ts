// ── composeConstants.ts ──────────────────────────────────────────
// All constants, type definitions, and helpers for the Compose tab.
// Ported directly from the <script type="text/babel"> block in ad.html.
// ─────────────────────────────────────────────────────────────────

// ─── DESIGN TOKENS ────────────────────────────────────────────────
export const C = {
  bg: "#0a0a0a", surface: "#0f0f0f", panel: "#141414", card: "#181818",
  border: "#1e1e1e", border2: "#2a2a2a",
  text: "#e8e8e8", muted: "#666", muted2: "#3a3a3a",
  accent: "#6C6FF7", green: "#2DB87A", amber: "#E09B3D", red: "#E05555", blue: "#3B9FD4",
  purple: "#9B6FF7",
} as const;

export const iBase: React.CSSProperties = {
  width: "100%", padding: "9px 13px", borderRadius: 8,
  border: `1.5px solid ${C.border2}`, background: C.panel, color: C.text,
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
export const taBase: React.CSSProperties = { ...iBase, resize: "vertical", lineHeight: 1.7 };

// ─── LEVEL HELPERS ────────────────────────────────────────────────
export function isN4OrN5Level(level: string) {
  const L = String(level || "").toUpperCase();
  return L === "N4" || L === "N5";
}
export function isN3Level(level: string) {
  return String(level || "").toUpperCase() === "N3";
}
export function isN1OrN2Level(level: string) {
  const L = String(level || "").toUpperCase();
  return L === "N1" || L === "N2";
}

// ─── TYPE GROUPS ──────────────────────────────────────────────────
export interface TypeDef { id: string; label: string; color?: string; }
export interface TypeGroup { label: string; labelVi: string; color: string; types: TypeDef[]; }

export const TYPE_GROUPS: TypeGroup[] = [
  { label: "語彙", labelVi: "Từ vựng", color: "#6C6FF7", types: [
    { id: "kanji",    label: "漢字読み" },
    { id: "bunmyaku", label: "文脈規定" },
    { id: "iikae",   label: "言い換え表現" },
    { id: "yoho",    label: "用法" },
  ]},
  { label: "文法", labelVi: "Ngữ pháp", color: "#E07B39", types: [
    { id: "bunpo1", label: "文の文法１" },
    { id: "bunpo2", label: "文の文法２" },
    { id: "bunsho", label: "文章の文法" },
  ]},
  { label: "読解", labelVi: "Đọc hiểu", color: "#2DB87A", types: [
    { id: "tan",    label: "読解（短文）" },
    { id: "chu",    label: "読解（中文）" },
    { id: "cho",    label: "読解（長文）" },
    { id: "togo",   label: "統合理解" },
    { id: "shudai", label: "主題理解" },
    { id: "joho",   label: "情報検索" },
  ]},
  { label: "聴解", labelVi: "Nghe hiểu", color: "#9B6FF7", types: [
    { id: "listen_kadai",  label: "課題理解" },
    { id: "listen_point",  label: "ポイント理解" },
    { id: "listen_gaiyou", label: "概要理解" },
    { id: "listen_sokuji", label: "即時応答" },
    { id: "listen_togo",   label: "統合的聴解" },
  ]},
];

export const BJT_TYPE_GROUPS: TypeGroup[] = [
  { label: "第１部 聴解", labelVi: "BJT · Nghe", color: "#9B6FF7", types: [
    { id: "bjt_1_1", label: "セクション１ 場面把握" },
    { id: "bjt_1_2", label: "セクション２ 発言聴解" },
    { id: "bjt_1_3", label: "セクション３ 総合聴解" },
  ]},
  { label: "第２部", labelVi: "BJT · 第２部", color: "#E07B39", types: [
    { id: "bjt_2_1", label: "セクション１ 状況把握" },
    { id: "bjt_2_2", label: "セクション２ 資料読解" },
    { id: "bjt_2_3", label: "セクション３ 総合聴解" },
  ]},
  { label: "第３部", labelVi: "BJT · Đọc", color: "#2DB87A", types: [
    { id: "bjt_3_1", label: "セクション１ 語彙・文法" },
    { id: "bjt_3_2", label: "セクション２ 表現読解" },
    { id: "bjt_3_3", label: "セクション３ 総合読解" },
  ]},
];

export const N5_TYPE_GROUPS: TypeGroup[] = [
  { label: "語彙", labelVi: "Từ vựng", color: "#6C6FF7", types: [
    { id: "kanji",    label: "問題1 漢字読み" },
    { id: "hyouki",   label: "問題2 表記" },
    { id: "bunmyaku", label: "問題3 文脈規定" },
    { id: "yoho",     label: "問題4 言い換え類義" },
  ]},
  { label: "文法・読解", labelVi: "Ngữ pháp & Đọc hiểu", color: "#2DB87A", types: [
    { id: "bunpo1", label: "問題1 文法形式の判断" },
    { id: "bunpo2", label: "問題2 文の組み立て" },
    { id: "bunsho", label: "問題3 文章の文法" },
    { id: "tan",    label: "問題4 内容理解（短文）" },
    { id: "chu",    label: "問題5 内容理解（中文）" },
    { id: "joho",   label: "問題6 情報検索" },
  ]},
  { label: "聴解", labelVi: "Nghe hiểu", color: "#9B6FF7", types: [
    { id: "listen_kadai",  label: "問題1 課題理解（画像）" },
    { id: "listen_point",  label: "問題2 ポイント理解" },
    { id: "listen_gaiyou", label: "問題3 発話表現（画像）" },
    { id: "listen_sokuji", label: "問題4 即時応答" },
  ]},
];

export const N3_TYPE_GROUPS: TypeGroup[] = [
  { label: "言語知識（文字・語彙）", labelVi: "Từ vựng & chữ", color: "#6C6FF7", types: [
    { id: "kanji",    label: "問題1 漢字読み" },
    { id: "hyouki",   label: "問題2 表記" },
    { id: "bunmyaku", label: "問題3 文脈規定" },
    { id: "iikae",    label: "問題4 言い換え類義" },
    { id: "yoho",     label: "問題5 用法" },
  ]},
  { label: "言語知識（文法）・読解", labelVi: "Ngữ pháp & Đọc hiểu", color: "#2DB87A", types: [
    { id: "bunpo1", label: "問題1 文法形式の判断" },
    { id: "bunpo2", label: "問題2 文の組み立て" },
    { id: "bunsho", label: "問題3 文章の文法" },
    { id: "tan",    label: "問題4 内容理解（短文）" },
    { id: "chu",    label: "問題5 内容理解（中文）" },
    { id: "cho",    label: "問題6 内容理解（長文）" },
    { id: "joho",   label: "問題7 情報検索" },
  ]},
  { label: "聴解", labelVi: "Nghe hiểu", color: "#9B6FF7", types: [
    { id: "listen_kadai",   label: "問題1 課題理解" },
    { id: "listen_point",   label: "問題2 ポイント理解" },
    { id: "listen_gaiyou",  label: "問題3 概要理解" },
    { id: "listen_hatsuwa", label: "問題4 発話表現" },
    { id: "listen_sokuji",  label: "問題5 即時応答" },
  ]},
];

export const EXTRA_COMPOSE_TYPES: TypeDef[] = [
  { id: "hyouki",        label: "表記",    color: "#6C6FF7" },
  { id: "listen_hatsuwa", label: "発話表現", color: "#9B6FF7" },
];

export const ALL_TYPES: TypeDef[] = [
  ...TYPE_GROUPS.flatMap(g => g.types.map(t => ({ ...t, color: g.color }))),
  ...EXTRA_COMPOSE_TYPES,
  ...BJT_TYPE_GROUPS.flatMap(g => g.types.map(t => ({ ...t, color: g.color }))),
];
export const TYPE_MAP: Record<string, TypeDef> = Object.fromEntries(ALL_TYPES.map(t => [t.id, t]));
export const GROUP_MAP: Record<string, TypeGroup> = Object.fromEntries([
  ...TYPE_GROUPS.flatMap(g => g.types.map(t => [t.id, g])),
  ...BJT_TYPE_GROUPS.flatMap(g => g.types.map(t => [t.id, g])),
  { id: "hyouki" } as TypeDef, { id: "listen_hatsuwa" } as TypeDef,
].filter(Array.isArray).map(([id, g]) => [id as string, g as TypeGroup]));

function withN1N2ListenLabels(groups: TypeGroup[]): TypeGroup[] {
  return groups.map(g => {
    const isListen = g.types.some(t => String(t.id).startsWith("listen"));
    if (!isListen) return g;
    return { ...g, types: [
      { id: "listen_kadai",  label: "問題1 課題理解" },
      { id: "listen_point",  label: "問題2 ポイント理解" },
      { id: "listen_gaiyou", label: "問題3 概要理解" },
      { id: "listen_sokuji", label: "問題4 即時応答" },
      { id: "listen_togo",   label: "問題5 統合理解" },
    ]};
  });
}
export function getComposeTypeGroups(level: string): TypeGroup[] {
  const L = String(level || "").toUpperCase();
  if (L === "BJT")                 return BJT_TYPE_GROUPS;
  if (L === "N3")                  return N3_TYPE_GROUPS;
  if (isN4OrN5Level(L))            return N5_TYPE_GROUPS;
  if (isN1OrN2Level(L))            return withN1N2ListenLabels(TYPE_GROUPS);
  return TYPE_GROUPS;
}

// ─── FIXED HEADERS ────────────────────────────────────────────────
type FixedHeaderFn = (data?: Record<string, string>) => string;

const DEFAULT_FIXED_HEADERS: Record<string, FixedHeaderFn> = {
  kanji:   () => "問題１ ＿＿＿の言葉の読み方として最もよいものを、１・２・３・４から一つ選びなさい。",
  bunmyaku:() => "問題２　（　　　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  iikae:   () => "問題３　＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
  yoho:    () => "問題４　次の言葉の使い方として最もよいものを、１・２・３・４から一つ選びなさい。",
  bunpo1:  () => "問題５　次の文の（　　　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  bunpo2:  () => "問題６　次の文の (★) に入る最もよいものを、１・２・３・４から一つ選びなさい。",
  bunsho:  (d) => `問題７　次の文章を読んで、文章全体の趣旨を踏まえて、 [${d?.x || "　"}] から [${d?.y || "　"}] の中に入る最もよいものを、１・２・３・４から一つ選びなさい。`,
  tan:     (d) => `問題８　次の（${d?.x || "　"}）から（${d?.y || "　"}）の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。`,
  chu:     (d) => `問題９　次の（${d?.x || "　"}）から（${d?.y || "　"}）の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。`,
  cho:     () => "問題10　次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。",
  togo:    () => "問題11　次のＡとＢの文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。",
  shudai:  () => "問題12　次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。",
  joho:    () => "問題13　右のページは、大森大学の図書館のホームページに書かれたサービスの案内である。下の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。",
  listen_kadai: () => "課題理解",
  listen_point: () => "ポイント理解",
  listen_gaiyou:() => "概要理解",
  listen_sokuji:() => "即時応答",
  listen_togo:  () => "統合的聴解",
};

const N5_FIXED_HEADERS: Record<string, FixedHeaderFn> = {
  kanji:   () => "もんだい１：_____の　ことばは　ひらがなで　どう　かきますか。１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください",
  hyouki:  () => "もんだい２：_____の　ことばは　どう　かきますか。１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください。",
  iikae:   () => "もんだい２：_____の　ことばは　どう　かきますか。１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください。",
  bunmyaku:() => "もんだい３：（　　）に　なにが　はいりますか。１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんでください。",
  yoho:    () => "もんだい４：_____の　ぶんと　だいたい　おなじ　いみの　ぶんが　あります。１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんでください。",
  bunpo1:  () => "もんだい１：（　　）に　なにを　いれますか。１・２・３・４から　いちばん　いいものを　ひとつ　えらんで　ください。",
  bunpo2:  () => "もんだい２：★ に　はいる　ものは　どれですか。１・２・３・４から　いちばん　いいものを　ひとつ　えらんで　ください。",
  bunsho:  (d) => `もんだい３：[${d?.x || "X"}] から [${d?.y || "Y"}] に　なにを　いれますか。ぶんしょうの　いみを　かんがえて、１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください。`,
  tan:     () => "もんだい４：つぎの（１） と（２）の　ぶんしょうを　よんで、しつもんに　こたえて　ください。こたえは、１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください。",
  chu:     () => "もんだい５：つぎの　ぶんしょうを　よんで、しつもんに　こたえて　ください。こたえは、１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください。",
  joho:    () => "みぎの　ページを　みて、したの　しつもんに　こたえて　ください。こたえは　１・２・３・４から　いちばん　いい　ものを　ひとつ　えらんで　ください。",
  listen_kadai: () => "問題１：もんだい１では、はじめに　しつもんを　きいて　ください。それから　はなしを　きいて、もんだいようしの　1から4の　なかから、いちばん　いい　ものを　ひとつ　えらんで　ください。",
  listen_point: () => "問題２：もんだい１では、はじめに　しつもんを　きいて　ください。それから　はなしを　きいて、もんだいようしの　1から4の　なかから、いちばん　いい　ものを　ひとつ　えらんで　ください。",
  listen_gaiyou:() => "問題３：もんだい３では、えを　みながら　しつもんを　きいて　ください。➡︎（やじるし）の　ひとは　なんと　いいますか。1から３の　なかから、いちばん　いい　ものを　ひとつ　えらんで　ください。",
  listen_sokuji:() => "問題４：もんだい４は、えなどが　ありません。ぶんを　きいて、1から３の　なかから、いちばん　いい　ものを　ひとつ　えらんで　ください。",
};

const N3_FIXED_HEADERS: Record<string, FixedHeaderFn> = {
  kanji:   () => "問題１ ＿＿＿の言葉の読み方として最もよいものを、１・２・３・４から一つ選びなさい。",
  hyouki:  () => "問題２　＿＿＿に漢字を書き取るとき、最もよいものを、１・２・３・４から一つ選びなさい。",
  bunmyaku:() => "問題３　（　　　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  iikae:   () => "問題４　＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
  yoho:    () => "問題５　次の言葉の使い方として最もよいものを、１・２・３・４から一つ選びなさい。",
  bunpo1:  () => "問題１　次の文の（　　　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  bunpo2:  () => "問題２　次の文の (★) に入る最もよいものを、１・２・３・４から一つ選びなさい。",
  bunsho:  (d) => `問題３　次の文章を読んで、文章全体の趣旨を踏まえて、 [${d?.x || "　"}] から [${d?.y || "　"}] の中に入る最もよいものを、１・２・３・４から一つ選びなさい。`,
  tan:     (d) => `問題４　次の（${d?.x || "　"}）から（${d?.y || "　"}）の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。`,
  chu:     (d) => `問題５　次の（${d?.x || "　"}）から（${d?.y || "　"}）の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。`,
  cho:     () => "問題６　次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。",
  joho:    () => "問題７　右のページは、大森大学の図書館のホームページに書かれたサービスの案内である。下の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。",
  listen_kadai:  () => "問題1では、まず質問を聞いてください。それから話を聞いて、問題用紙の1から4の中から、最もよいものを一つ選んでください。",
  listen_point:  () => "問題2では、まず質問を聞いてください。そのあと、問題用紙を見てください。読む時間があります。それから話を聞いて、問題用紙の1から4の中から、最もよいものを一つ選んでください。",
  listen_gaiyou: () => "問題3では、問題用紙に何も印刷されていません。この問題は、ぜんたいとしてどんな内容かを聞く問題です。話の前に質問はありません。まず話を聞いてください。それから、質問と選択肢を聞いて、1から4の中から、最もよいものを一つ選んでください。",
  listen_hatsuwa:() => "問題4では、えを見ながら質問を聞いてください。➡︎（やじるし）の人は何と言いますか。1から3の中から、最もよいものを一つ選んでください。",
  listen_sokuji: () => "問題5では、問題用紙に何も印刷されていません。まず文を聞いてください。それから、その返事を聞いて、1から3の中から、最もよいものを一つ選んでください。",
};

const N1N2_LISTEN_FIXED_HEADERS: Record<string, FixedHeaderFn> = {
  listen_kadai: () => "問題1では、まず質問を聞いてください。それから話を聞いて、問題用紙の1から4の中から、最もよいものを一つ選んでください。",
  listen_point: () => "問題2では、まず質問を聞いてください。そのあと、問題用紙を見てください。読む時間があります。それから話を聞いて、問題用紙の1から4の中から、最もよいものを一つ選んでください。",
  listen_gaiyou:() => "問題3では、問題用紙に何も印刷されていません。この問題は、ぜんたいとしてどんな内容かを聞く問題です。話の前に質問はありません。まず話を聞いてください。それから、質問と選択肢を聞いて、1から4の中から、最もよいものを一つ選んでください。",
  listen_sokuji:() => "問題4では、問題用紙に何も印刷されていません。まず文を聞いてください。それから、その返事を聞いて、1から3の中から、最もよいものを一つ選んでください。",
  listen_togo:  () => "問題５では、長めのはなしを聞きます。この問題には練習はありません。問題用紙にメモをとってもかまいません。",
};

export function getFixedHeaderText(typeId: string, data?: Record<string, string>, level?: string): string {
  if (isN1OrN2Level(level || "")) {
    const fn12 = N1N2_LISTEN_FIXED_HEADERS[typeId];
    if (fn12) return fn12(data);
  }
  let src: Record<string, FixedHeaderFn> = DEFAULT_FIXED_HEADERS;
  if (isN4OrN5Level(level || ""))     src = N5_FIXED_HEADERS;
  else if (isN3Level(level || ""))    src = N3_FIXED_HEADERS;
  const fn = src[typeId] || DEFAULT_FIXED_HEADERS[typeId];
  return fn ? fn(data) : "";
}

// ─── BJT FIXED HEADERS ────────────────────────────────────────────
export const BJT_FORM_FIXED_JP: Record<string, string> = {
  bjt_1_1: "セクション１では、写真を見て、答えてください。４つの選択肢を読み上げます。写真の内容を表している文はどれですか。１・２・３・４のなかから最も良いものを一つ選んでください。",
  bjt_1_2: "セクション２では、音声を聞きながら写真を見て答えてください。質問の後、４つの選択肢を読み上げます。１・２・３・４のなかから最も良いものを一つ選んでください。",
  bjt_1_3: "セクション３では、イラストを見ながら、音声を聞いて答えてください。イラストは場面を表しています。質問の後、４つの選択肢を読み上げます。１・２・３・４のなかから最も良いものを一つ選んでください。",
  bjt_2_1: "セクション１では、音声を聴きながら、写真を見て答えてください。質問をよく聴いて、１、２、３、４の中から最もよいものを１つ選んでください。",
  bjt_2_2: "セクション２では、音声を聴きながら、資料を見て答えてください。質問をよく聴いて、１、２、３、４の中から最もよいものを１つ選んでください。",
  bjt_2_3: "セクション３では、音声を聴きながら、資料を見て答えてください。質問をよく聴いて、１、２、３、４の中から最もよいものを１つ選んでください。",
  bjt_3_1: "次の文の　　　に入る最もよいものを１、２、３、４の中から１つ選んでください。",
  bjt_3_2: "次の文の　　　に入る最もよいものを１、２、３、４の中から１つ選んでください。",
  bjt_3_3: "次の文章を読んで、質問に答えてください。１、２、３、４の中から最もよいものを１つ選んでください。",
};

// ─── DEFAULT QUESTION DATA ────────────────────────────────────────
export type QData = Record<string, unknown>;

export const mkBase  = (): QData => ({ question: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" });
export const mkSQ    = (): QData => ({ question: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" });
export const mkLQ    = (): QData => ({ orderNum: "", correct: "", wrongs: ["","",""] });
export const mkLQS   = (): QData => ({ orderNum: "", correct: "", wrongs: ["",""] });
export const mkLTQ   = (): QData => ({ orderNum: "", correct: "", wrongs: ["","",""] });
// Fixed-choice listen mondai (概要理解 / 即時応答) — admin picks
// the correct number via radio so we only ever store `correct`.
export const mkLFixed = (): QData => ({ orderNum: "", correct: "" });
// listen_togo type2 sub-questions: admin types each option text +
// uses a radio to mark which one is correct. Storage groups them
// as `options[]` + `correctIdx`; pipeline maps that to legacy
// correct/wrongs at sanitize time so applyShuffle can run.
export const mkLTQ2  = (): QData => ({ orderNum: "", options: ["","","",""], correctIdx: 0 });

export function mkDefault(id: string): QData {
  if (["kanji","bunmyaku","iikae","hyouki","yoho","bunpo1","bunpo2"].includes(id)) return mkBase();
  if (id === "bunsho") return { x: "", y: "", passage: "", questions: [mkSQ()] };
  if (id === "togo")   return { passages: ["",""], questions: [mkSQ()] };
  if (["tan","chu","cho","shudai","joho"].includes(id)) {
    const n = ({ tan:1, chu:2, cho:3, shudai:3, joho:2 } as Record<string,number>)[id] || 1;
    return { x: "", y: "", passages: [{ text: "", questions: Array.from({length:n}, mkSQ) }] };
  }
  if (id === "listen_kadai" || id === "listen_point" || id === "listen_hatsuwa")
    return { audioUrl: "", questions: [mkLQ()] };
  if (id === "listen_gaiyou" || id === "listen_sokuji")
    return { audioUrl: "", questions: [mkLFixed()] };
  if (id === "listen_togo")
    return {
      audioUrl: "",
      // type1 = fixed-choice radio (1/2/3/4), no wrongs.
      type1: { mainQuestion: "", orderNum: "", correct: "", explanation: "", vocab: "", grammar: "" },
      // type2 = N sub-questions, each with options[] + correctIdx.
      type2: { mainQuestion: "", questions: [mkLTQ2(), mkLTQ2()] },
    };
  if (id === "bjt_1_1" || id === "bjt_1_2")
    return { imageUrl: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" };
  if (id === "bjt_1_3")
    return { imageUrl: "", correct: "1", wrongs: ["2","3","4"], explanation: "", vocab: "", grammar: "" };
  if (id === "bjt_2_1")
    return { imageUrl: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" };
  if (id === "bjt_2_2")
    return { imageUrl: "", question: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" };
  if (id === "bjt_2_3")
    return { imageUrl: "", question: "", correct: "1", wrongs: ["2","3","4"], explanation: "", vocab: "", grammar: "" };
  if (id === "bjt_3_1" || id === "bjt_3_2")
    return { sentence: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" };
  if (id === "bjt_3_3")
    return { question: "", passage: "", correct: "", wrongs: ["","",""], explanation: "", vocab: "", grammar: "" };
  return {};
}

export function normalizeBjtSogoChokaiQuestion(q: QData) {
  let n = parseInt(String(q.correct || "").trim(), 10);
  if (isNaN(n) || n < 1 || n > 4) n = 1;
  q.correct = String(n);
  q.wrongs = [1,2,3,4].filter(x => x !== n).map(String);
}

// ─── COMPOSED QUESTION TYPE ───────────────────────────────────────
export interface ComposeQuestion extends QData {
  id: string;
  type: string;
  level: string;
  order_index?: number;
}
