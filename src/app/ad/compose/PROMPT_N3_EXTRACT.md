# Prompt trích xuất đề thi JLPT N3 — dán thẳng cho AI

---

```
You are a JLPT N3 exam digitizer. I will give you images or PDF pages of a JLPT N3 exam. Extract every question and return ONE JSON array. No explanation text before or after — only the JSON.

════════════════════════════════════════════════
PART 1 — OVERVIEW OF JLPT N3 STRUCTURE
════════════════════════════════════════════════

N3 has three test booklets:
  Booklet 1 → 言語知識（文字・語彙）  [moji/goi]
  Booklet 2 → 言語知識（文法）・読解  [bunpo/dokkai]
  Booklet 3 → 聴解                    [chokai]

Mondai map:

  BOOKLET 1 — 文字・語彙
  ┌──────────┬──────────────────────────────┬──────────┬──────────────┐
  │ 問題番号  │ 問題タイプ                    │ typeId   │ 問題数(目安) │
  ├──────────┼──────────────────────────────┼──────────┼──────────────┤
  │ 問題１   │ 漢字読み                      │ kanji    │ 8問          │
  │ 問題２   │ 表記                          │ hyouki   │ 6問          │
  │ 問題３   │ 文脈規定                      │ bunmyaku │ 11問         │
  │ 問題４   │ 言い換え類義                  │ iikae    │ 5問          │
  │ 問題５   │ 用法                          │ yoho     │ 5問          │
  └──────────┴──────────────────────────────┴──────────┴──────────────┘

  BOOKLET 2 — 文法・読解
  ┌──────────┬──────────────────────────────┬──────────┬──────────────┐
  │ 問題番号  │ 問題タイプ                    │ typeId   │ 問題数(目安) │
  ├──────────┼──────────────────────────────┼──────────┼──────────────┤
  │ 問題１   │ 文法形式の判断                │ bunpo1   │ 13問         │
  │ 問題２   │ 文の組み立て（★）             │ bunpo2   │ 5問          │
  │ 問題３   │ 文章の文法（穴埋め文章）       │ bunsho   │ 5問          │
  │ 問題４   │ 内容理解（短文）              │ tan      │ 4テキスト    │
  │ 問題５   │ 内容理解（中文）              │ chu      │ 2テキスト    │
  │ 問題６   │ 内容理解（長文）              │ cho      │ 1テキスト    │
  │ 問題７   │ 情報検索                      │ joho     │ 1テキスト    │
  └──────────┴──────────────────────────────┴──────────┴──────────────┘

  BOOKLET 3 — 聴解
  ┌──────────┬──────────────────────────────┬───────────────┬──────────────┐
  │ 問題番号  │ 問題タイプ                    │ typeId        │ 選択肢数     │
  ├──────────┼──────────────────────────────┼───────────────┼──────────────┤
  │ 問題１   │ 課題理解                      │ listen_kadai  │ 4択           │
  │ 問題２   │ ポイント理解                  │ listen_point  │ 4択           │
  │ 問題３   │ 概要理解                      │ listen_gaiyou │ 4択（音声）   │
  │ 問題４   │ 発話表現                      │ listen_hatsuwa│ 3択           │
  │ 問題５   │ 即時応答                      │ listen_sokuji │ 3択           │
  └──────────┴──────────────────────────────┴───────────────┴──────────────┘

════════════════════════════════════════════════
PART 2 — JSON OUTPUT STRUCTURE
════════════════════════════════════════════════

Each element in the output array:
{
  "type":        "<typeId from table above>",
  "level":       "N3",
  "order_index": <integer, 1-based, resets per typeId>,
  "data":        { ... }   ← schema defined per mondai below
}

════════════════════════════════════════════════
PART 3 — MONDAI-BY-MONDAI EXTRACTION RULES
════════════════════════════════════════════════

──────────────────────────────────────────────
問題１ · typeId = "kanji"  · 漢字読み
──────────────────────────────────────────────
Visual cue: 問題１ header + sentences with a word written in underline ( ＿＿＿ ) or bold.
The task: choose the correct reading (hiragana) of the underlined/bold word.

DATA SCHEMA:
{
  "question": "<full sentence including underlined word>",
  "correct":  "<hiragana reading of the underlined word>",
  "wrongs":   ["<opt>", "<opt>", "<opt>"],
  "explanation": "",
  "vocab": "",
  "grammar": ""
}

RULES:
- "question" = full exam sentence, e.g.: "彼女は毎日＿練習＿している。"
  Keep underline marker: wrap the target word with ＿ on both sides if underline is used,
  or write as-is if the exam uses bold/line formatting.
- options 1・2・3・4 printed below the sentence = hiragana readings.
- "correct" = the hiragana text of the correct answer (NOT "１" — use actual text).
- "wrongs"  = the other 3 option texts, in order ①②③ excluding correct.
- If no answer key: set "correct": "" and put all 4 options in "wrongs": ["opt1","opt2","opt3","opt4"].

EXAMPLE:
{
  "type": "kanji", "level": "N3", "order_index": 1,
  "data": {
    "question": "この映画の＿監督＿は有名な人だ。",
    "correct": "かんとく",
    "wrongs": ["かんどく", "かんそく", "かんとう"],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題２ · typeId = "hyouki"  · 表記
──────────────────────────────────────────────
Visual cue: 問題２ header + sentences with a hiragana word underlined.
The task: choose the correct kanji/written form of the underlined hiragana.

DATA SCHEMA: same shape as kanji.
{
  "question": "<full sentence with underlined hiragana>",
  "correct":  "<correct kanji/written form>",
  "wrongs":   ["<opt>", "<opt>", "<opt>"],
  "explanation": "", "vocab": "", "grammar": ""
}

RULES:
- Mark the underlined hiragana with ＿word＿ in "question".
- Options are kanji variants of the underlined hiragana.

EXAMPLE:
{
  "type": "hyouki", "level": "N3", "order_index": 1,
  "data": {
    "question": "明日の会議に＿さんかする＿予定です。",
    "correct": "参加する",
    "wrongs": ["参家する", "参加する", "産家する"],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題３ · typeId = "bunmyaku"  · 文脈規定
──────────────────────────────────────────────
Visual cue: 問題３ header + sentences with a blank （　　　）.
The task: choose the word/phrase that best fills the blank.

DATA SCHEMA:
{
  "question": "<sentence with （　　　） blank>",
  "correct":  "<correct fill-in text>",
  "wrongs":   ["<opt>", "<opt>", "<opt>"],
  "explanation": "", "vocab": "", "grammar": ""
}

RULES:
- Keep the blank as （　　　） in "question".
- Options are words or short phrases.

EXAMPLE:
{
  "type": "bunmyaku", "level": "N3", "order_index": 1,
  "data": {
    "question": "彼は会議中に突然（　　　）を上げた。",
    "correct": "声",
    "wrongs": ["音", "話", "目"],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題４ · typeId = "iikae"  · 言い換え類義
──────────────────────────────────────────────
Visual cue: 問題４ header + sentences with an underlined word/phrase.
The task: choose the option with the closest meaning to the underlined part.

DATA SCHEMA:
{
  "question": "<sentence with ＿underlined＿ target>",
  "correct":  "<synonym/paraphrase>",
  "wrongs":   ["<opt>", "<opt>", "<opt>"],
  "explanation": "", "vocab": "", "grammar": ""
}

EXAMPLE:
{
  "type": "iikae", "level": "N3", "order_index": 1,
  "data": {
    "question": "この問題は＿簡単＿ではない。",
    "correct": "難しい",
    "wrongs": ["複雑", "新しい", "長い"],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題５ · typeId = "yoho"  · 用法
──────────────────────────────────────────────
Visual cue: 問題５ header + a bold target word printed first, then 4 example sentences below.
The task: choose the sentence where the target word is used correctly.

DATA SCHEMA:
{
  "question": "<target word>\n１　<sentence 1>\n２　<sentence 2>\n３　<sentence 3>\n４　<sentence 4>",
  "correct":  "<full text of the correct sentence>",
  "wrongs":   ["<sentence>", "<sentence>", "<sentence>"],
  "explanation": "", "vocab": "", "grammar": ""
}

RULES:
- "question" starts with the target word, then a newline, then all 4 numbered sentences.
- "correct" = text of the correct usage sentence (exclude the leading number).
- "wrongs" = texts of the 3 wrong sentences, in original 1→4 order.

EXAMPLE:
{
  "type": "yoho", "level": "N3", "order_index": 1,
  "data": {
    "question": "感動\n１　映画を見て感動に泣いてしまった。\n２　彼の演技に感動した。\n３　試験の結果に感動になった。\n４　音楽が感動で流れていた。",
    "correct": "彼の演技に感動した。",
    "wrongs": [
      "映画を見て感動に泣いてしまった。",
      "試験の結果に感動になった。",
      "音楽が感動で流れていた。"
    ],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題１（文法） · typeId = "bunpo1"  · 文法形式の判断
──────────────────────────────────────────────
Visual cue: 問題１ in booklet 2 + sentences with （　　　） blank.
The task: choose the grammar form that best fills the blank.

DATA SCHEMA: identical to bunmyaku.
{
  "question": "<sentence with （　　　）>",
  "correct":  "<grammar form>",
  "wrongs":   ["<opt>", "<opt>", "<opt>"],
  "explanation": "", "vocab": "", "grammar": ""
}

EXAMPLE:
{
  "type": "bunpo1", "level": "N3", "order_index": 1,
  "data": {
    "question": "もう少し早く来て（　　　）よかった。",
    "correct": "くれれば",
    "wrongs": ["くれると", "くれるなら", "くれても"],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題２（文法） · typeId = "bunpo2"  · 文の組み立て
──────────────────────────────────────────────
Visual cue: 問題２ in booklet 2. Sentence has 4 blank slots ＿＿＿, one of which is marked ★.
The task: rearrange options 1・2・3・4 to complete the sentence; choose what goes in ★.

DATA SCHEMA:
{
  "question": "<sentence with ＿＿＿ ★ ＿＿＿ ＿＿＿ slots>",
  "correct":  "<option text that goes into ★>",
  "wrongs":   ["<opt>", "<opt>", "<opt>"],
  "explanation": "", "vocab": "", "grammar": ""
}

RULES:
- Copy the sentence exactly as printed, keeping ＿＿＿ for blank slots and ★ for the target slot.
- Options are 4 short phrases/words to be arranged into the blanks.
- "correct" = the option that fills the ★ slot.
- "wrongs" = the other 3 options.

EXAMPLE:
{
  "type": "bunpo2", "level": "N3", "order_index": 1,
  "data": {
    "question": "先生に　＿＿＿　＿＿＿　★　＿＿＿　もらいました。",
    "correct": "手伝って",
    "wrongs": ["を", "ことを", "頼んで"],
    "explanation": "", "vocab": "", "grammar": ""
  }
}

──────────────────────────────────────────────
問題３（文法） · typeId = "bunsho"  · 文章の文法
──────────────────────────────────────────────
Visual cue: 問題３ in booklet 2. A continuous passage with numbered blanks like [26][27][28][29][30].
The task: for each numbered blank, choose the best word/phrase from 4 options.

DATA SCHEMA:
{
  "x": "<first blank number as string, e.g. '26'>",
  "y": "<last blank number as string, e.g. '30'>",
  "passage": "<full passage text with blanks written as [26]（　　）[27]（　　）…>",
  "questions": [
    {
      "question": "[26]に入れるのに最もよいものを選びなさい。",
      "correct":  "<option text>",
      "wrongs":   ["<opt>", "<opt>", "<opt>"],
      "explanation": "", "vocab": "", "grammar": ""
    },
    ... one entry per blank number
  ]
}

RULES:
- "passage": reproduce the full passage. Where a blank appears, write [NN]（　　） with the bracket number.
- "x" = the first blank number, "y" = the last blank number (strings, not integers).
- "questions" array must have exactly (y - x + 1) entries, one per blank.
- Each sub-question's "question" field = "[NN]に入れるのに最もよいものを選びなさい。"

EXAMPLE:
{
  "type": "bunsho", "level": "N3", "order_index": 1,
  "data": {
    "x": "26", "y": "28",
    "passage": "私が日本語を勉強し始めたのは、[26]（　　）からです。最初は文字を覚えるのが[27]（　　）と思っていましたが、今では楽しいと感じています。勉強を続けることが[28]（　　）です。",
    "questions": [
      {
        "question": "[26]に入れるのに最もよいものを選びなさい。",
        "correct": "日本の文化に興味を持った",
        "wrongs": ["日本語が難しいと知った", "友達に勧められた", "仕事で必要になった"],
        "explanation": "", "vocab": "", "grammar": ""
      },
      {
        "question": "[27]に入れるのに最もよいものを選びなさい。",
        "correct": "難しい",
        "wrongs": ["簡単だ", "面白い", "つまらない"],
        "explanation": "", "vocab": "", "grammar": ""
      },
      {
        "question": "[28]に入れるのに最もよいものを選びなさい。",
        "correct": "大切",
        "wrongs": ["必要でない", "難しい", "楽しい"],
        "explanation": "", "vocab": "", "grammar": ""
      }
    ]
  }
}

──────────────────────────────────────────────
問題４ · typeId = "tan"  · 内容理解（短文）
──────────────────────────────────────────────
Visual cue: 問題４ in booklet 2. Multiple short reading texts (~100–200 characters each),
each followed by 1 comprehension question.

DATA SCHEMA: one order_index per text block.
{
  "x": "<first passage number as string, e.g. '1'>",
  "y": "<last passage number as string>",
  "passages": [
    {
      "text": "<full passage text>",
      "questions": [
        {
          "question": "<comprehension question>",
          "correct":  "<correct answer text>",
          "wrongs":   ["<opt>", "<opt>", "<opt>"],
          "explanation": "", "vocab": "", "grammar": ""
        }
      ]
    }
  ]
}

RULES:
- Each short text = one element in "passages" with exactly 1 entry in its "questions" array.
- All short texts for 問題４ are grouped into ONE order_index entry (order_index = 1).
  Put ALL passages inside the single "passages" array.
- "x"/"y": the passage numbers printed in the exam header, e.g. "(1)から(4)" → x="1", y="4".
  If not shown, use "x": "", "y": "".

EXAMPLE (2 passages shown, real exam has ~4):
{
  "type": "tan", "level": "N3", "order_index": 1,
  "data": {
    "x": "1", "y": "4",
    "passages": [
      {
        "text": "（１）\n　日本では毎年4月に新しい年度が始まる。会社員は新入社員を迎え、学校では新学期が始まる。この時期は桜が咲くことが多く、多くの人が花見を楽しむ。",
        "questions": [{
          "question": "この文章によると、4月に日本でよく行われることは何ですか。",
          "correct": "新入社員を迎えたり花見をしたりすること",
          "wrongs": [
            "会社の年度末の決算をすること",
            "学校の卒業式が行われること",
            "春の旅行に出かけること"
          ],
          "explanation": "", "vocab": "", "grammar": ""
        }]
      },
      {
        "text": "（２）\n　最近、テレワークをする会社員が増えている。自宅で仕事ができるため、通勤時間が不要になり、生活の質が向上したという意見がある一方で、仕事とプライベートの境界が曖昧になるという問題も指摘されている。",
        "questions": [{
          "question": "テレワークの問題点として挙げられていることは何ですか。",
          "correct": "仕事と私生活の区別がつきにくくなること",
          "wrongs": [
            "通勤時間が長くなること",
            "会社に行く機会が増えること",
            "生活の質が下がること"
          ],
          "explanation": "", "vocab": "", "grammar": ""
        }]
      }
    ]
  }
}

──────────────────────────────────────────────
問題５ · typeId = "chu"  · 内容理解（中文）
──────────────────────────────────────────────
Visual cue: 問題５ in booklet 2. Two medium-length passages (~350 characters each),
each followed by 3 comprehension questions.

DATA SCHEMA: same shape as tan, but each passage has ~3 questions.
ONE order_index entry (order_index = 1) containing both passages.

EXAMPLE (abbreviated):
{
  "type": "chu", "level": "N3", "order_index": 1,
  "data": {
    "x": "", "y": "",
    "passages": [
      {
        "text": "（パッセージAの全文）",
        "questions": [
          {
            "question": "筆者がこの文章で最も言いたいことは何ですか。",
            "correct": "...", "wrongs": ["...","...","..."],
            "explanation": "", "vocab": "", "grammar": ""
          },
          {
            "question": "＿＿＿とはどういう意味ですか。",
            "correct": "...", "wrongs": ["...","...","..."],
            "explanation": "", "vocab": "", "grammar": ""
          },
          {
            "question": "この文章の内容と合っているものはどれですか。",
            "correct": "...", "wrongs": ["...","...","..."],
            "explanation": "", "vocab": "", "grammar": ""
          }
        ]
      },
      {
        "text": "（パッセージBの全文）",
        "questions": [
          { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" },
          { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" },
          { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" }
        ]
      }
    ]
  }
}

──────────────────────────────────────────────
問題６ · typeId = "cho"  · 内容理解（長文）
──────────────────────────────────────────────
Visual cue: 問題６ in booklet 2. One long passage (~600+ characters), followed by 4 questions.

DATA SCHEMA: ONE order_index entry, ONE passage, 4 questions.
{
  "x": "", "y": "",
  "passages": [
    {
      "text": "<full long passage>",
      "questions": [
        { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" },
        { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" },
        { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" },
        { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" }
      ]
    }
  ]
}

──────────────────────────────────────────────
問題７ · typeId = "joho"  · 情報検索
──────────────────────────────────────────────
Visual cue: 問題７ in booklet 2. An information page (schedule, notice, table, advertisement,
website screenshot, etc.), followed by 2 questions.

DATA SCHEMA: ONE order_index entry, ONE "passage" containing the info document, 2 questions.
{
  "x": "", "y": "",
  "passages": [
    {
      "text": "<full text of the information document, preserving all labels, tables, bullet points>",
      "questions": [
        { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" },
        { "question": "...", "correct": "...", "wrongs": ["...","...","..."], "explanation": "", "vocab": "", "grammar": "" }
      ]
    }
  ]
}

RULES for "text":
- For tables: use plain text with tab or │ separator, e.g.: "コース名\t料金\t時間\n初級\t5,000円\t60分"
- For bullet lists: use "・item" on each line.
- Preserve all numbers, dates, times, prices — do not paraphrase.

──────────────────────────────────────────────
問題１（聴解） · typeId = "listen_kadai"  · 課題理解
──────────────────────────────────────────────
Visual cue: 問題１ in booklet 3. "まず質問を聞いてください" instruction.
Each sub-question shows 4 picture choices on the question sheet.

DATA SCHEMA:
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "<number printed, e.g. '1'>",
      "correct":  "",
      "wrongs":   ["", "", ""],
      "imageUrl": "PLACEHOLDER_KADAI_Q1",
      "explanation": ""
    }
  ]
}

RULES:
- "audioUrl": always "" — audio is uploaded separately.
- "orderNum": the question number printed on the sheet (1, 2, 3…).
- "correct" and "wrongs": set all to "" — answers come from audio.
- "imageUrl": set to "PLACEHOLDER_KADAI_Q{orderNum}" for every question.
  This signals that a picture image needs to be uploaded later.
- Typical N3 count: 6 sub-questions (orderNum "1" through "6").

EXAMPLE:
{
  "type": "listen_kadai", "level": "N3", "order_index": 1,
  "data": {
    "audioUrl": "",
    "questions": [
      { "orderNum": "1", "correct": "", "wrongs": ["","",""], "imageUrl": "PLACEHOLDER_KADAI_Q1", "explanation": "" },
      { "orderNum": "2", "correct": "", "wrongs": ["","",""], "imageUrl": "PLACEHOLDER_KADAI_Q2", "explanation": "" },
      { "orderNum": "3", "correct": "", "wrongs": ["","",""], "imageUrl": "PLACEHOLDER_KADAI_Q3", "explanation": "" },
      { "orderNum": "4", "correct": "", "wrongs": ["","",""], "imageUrl": "PLACEHOLDER_KADAI_Q4", "explanation": "" },
      { "orderNum": "5", "correct": "", "wrongs": ["","",""], "imageUrl": "PLACEHOLDER_KADAI_Q5", "explanation": "" },
      { "orderNum": "6", "correct": "", "wrongs": ["","",""], "imageUrl": "PLACEHOLDER_KADAI_Q6", "explanation": "" }
    ]
  }
}

──────────────────────────────────────────────
問題２（聴解） · typeId = "listen_point"  · ポイント理解
──────────────────────────────────────────────
Visual cue: 問題２ in booklet 3. "まず質問を聞いてください。そのあと、問題用紙を見てください" instruction.
4 TEXT choices are printed on the question sheet for each sub-question.

DATA SCHEMA:
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "<number>",
      "correct":  "<text of correct option if answer key known, else ''>",
      "wrongs":   ["<text>", "<text>", "<text>"],
      "explanation": ""
    }
  ]
}

RULES:
- Unlike 課題理解, the 4 TEXT options ARE printed on the sheet — extract them.
- "correct": fill if answer key is provided; else "".
- If correct unknown: put all 4 printed option texts into "wrongs": ["opt1","opt2","opt3","opt4"].
- NO "imageUrl" field for this type.
- Typical N3 count: 6 sub-questions.

EXAMPLE:
{
  "type": "listen_point", "level": "N3", "order_index": 1,
  "data": {
    "audioUrl": "",
    "questions": [
      {
        "orderNum": "1",
        "correct": "",
        "wrongs": ["来週の月曜日", "来週の火曜日", "今週の金曜日", "今週の土曜日"],
        "explanation": ""
      }
    ]
  }
}

──────────────────────────────────────────────
問題３（聴解） · typeId = "listen_gaiyou"  · 概要理解
──────────────────────────────────────────────
Visual cue: 問題３ in booklet 3. "問題用紙に何も印刷されていません" — NO choices on paper.
The question and all 4 options are spoken aloud.

DATA SCHEMA:
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "<number>",
      "correct":  "",
      "wrongs":   ["", "", ""],
      "explanation": ""
    }
  ]
}

RULES:
- Nothing is printed on the question sheet → all fields "" except "orderNum".
- Typical N3 count: 3 sub-questions.

EXAMPLE:
{
  "type": "listen_gaiyou", "level": "N3", "order_index": 1,
  "data": {
    "audioUrl": "",
    "questions": [
      { "orderNum": "1", "correct": "", "wrongs": ["","",""], "explanation": "" },
      { "orderNum": "2", "correct": "", "wrongs": ["","",""], "explanation": "" },
      { "orderNum": "3", "correct": "", "wrongs": ["","",""], "explanation": "" }
    ]
  }
}

──────────────────────────────────────────────
問題４（聴解） · typeId = "listen_hatsuwa"  · 発話表現  ← N3 ONLY
──────────────────────────────────────────────
Visual cue: 問題４ in booklet 3. Picture shows a social situation with an arrow (➡︎) pointing
to one person. 3 (not 4!) spoken options for what that person should say.

DATA SCHEMA:
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "<number>",
      "correct":  "",
      "wrongs":   ["", ""],        ← only 2 wrongs (total 3 choices)
      "imageUrl": "PLACEHOLDER_HATSUWA_Q1",
      "explanation": ""
    }
  ]
}

RULES:
- ⚠ ONLY 2 "wrongs" (3 total choices, not 4). Do not add a 4th.
- "imageUrl" = "PLACEHOLDER_HATSUWA_Q{orderNum}" (situation picture needs upload later).
- Typical N3 count: 4 sub-questions.

EXAMPLE:
{
  "type": "listen_hatsuwa", "level": "N3", "order_index": 1,
  "data": {
    "audioUrl": "",
    "questions": [
      { "orderNum": "1", "correct": "", "wrongs": ["",""], "imageUrl": "PLACEHOLDER_HATSUWA_Q1", "explanation": "" },
      { "orderNum": "2", "correct": "", "wrongs": ["",""], "imageUrl": "PLACEHOLDER_HATSUWA_Q2", "explanation": "" },
      { "orderNum": "3", "correct": "", "wrongs": ["",""], "imageUrl": "PLACEHOLDER_HATSUWA_Q3", "explanation": "" },
      { "orderNum": "4", "correct": "", "wrongs": ["",""], "imageUrl": "PLACEHOLDER_HATSUWA_Q4", "explanation": "" }
    ]
  }
}

──────────────────────────────────────────────
問題５（聴解） · typeId = "listen_sokuji"  · 即時応答
──────────────────────────────────────────────
Visual cue: 問題５ in booklet 3. "問題用紙に何も印刷されていません" — nothing on paper.
A short spoken prompt; choose from 3 spoken responses.

DATA SCHEMA:
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "<number>",
      "correct":  "",
      "wrongs":   ["", ""],        ← only 2 wrongs (total 3 choices)
      "explanation": ""
    }
  ]
}

RULES:
- ⚠ ONLY 2 "wrongs" — same as listen_hatsuwa.
- NO "imageUrl" field.
- Typical N3 count: 9 sub-questions (orderNum "1" through "9").

EXAMPLE:
{
  "type": "listen_sokuji", "level": "N3", "order_index": 1,
  "data": {
    "audioUrl": "",
    "questions": [
      { "orderNum": "1", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "2", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "3", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "4", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "5", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "6", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "7", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "8", "correct": "", "wrongs": ["",""], "explanation": "" },
      { "orderNum": "9", "correct": "", "wrongs": ["",""], "explanation": "" }
    ]
  }
}

════════════════════════════════════════════════
PART 4 — FURIGANA ENCODING
════════════════════════════════════════════════

When the original exam prints small hiragana (furigana) above a kanji, encode as:
  {(漢字)(かな)}

Examples:
  学校 with がっこう above → {(学校)(がっこう)}
  毎日 with まいにち above → {(毎日)(まいにち)}

Apply this encoding inside "question", "passage", "text", and option texts.
Do NOT encode words where no furigana is shown in the exam.

════════════════════════════════════════════════
PART 5 — ANSWER KEY HANDLING
════════════════════════════════════════════════

CASE A — No answer key provided:
  • "correct": ""
  • For 4-choice questions: "wrongs": ["opt1","opt2","opt3","opt4"] — all 4 options
  • For 3-choice questions: "wrongs": ["opt1","opt2","opt3"] — all 3 options
  • For questions with no printed options (gaiyou, sokuji): "wrongs": ["","",""] or ["",""]

CASE B — Answer key provided alongside:
  • "correct": exact text of the correct option
  • "wrongs": the other options in original order

════════════════════════════════════════════════
PART 6 — ORDER_INDEX RULES
════════════════════════════════════════════════

Reset order_index to 1 for each new typeId.

For types where multiple passages are grouped into one DB entry (tan, chu, cho, joho):
  → All passages for that mondai go into ONE item with order_index = 1.

For simple-choice types (kanji, hyouki, bunmyaku, iikae, yoho, bunpo1, bunpo2):
  → Each question = one item; order_index increments per question: 1, 2, 3…

For bunsho:
  → The entire passage + all its blanks = ONE item with order_index = 1.

For listening types:
  → The entire mondai (all sub-questions) = ONE item with order_index = 1.

════════════════════════════════════════════════
PART 7 — EXPECTED OUTPUT SKELETON (N3 full exam)
════════════════════════════════════════════════

The final array should contain roughly these items in this order:

[
  // 文字・語彙
  {"type":"kanji",    "level":"N3", "order_index":1, "data":{...}},  // ×8
  ...
  {"type":"hyouki",   "level":"N3", "order_index":1, "data":{...}},  // ×6
  ...
  {"type":"bunmyaku", "level":"N3", "order_index":1, "data":{...}},  // ×11
  ...
  {"type":"iikae",    "level":"N3", "order_index":1, "data":{...}},  // ×5
  ...
  {"type":"yoho",     "level":"N3", "order_index":1, "data":{...}},  // ×5

  // 文法・読解
  {"type":"bunpo1",   "level":"N3", "order_index":1, "data":{...}},  // ×13
  ...
  {"type":"bunpo2",   "level":"N3", "order_index":1, "data":{...}},  // ×5
  ...
  {"type":"bunsho",   "level":"N3", "order_index":1, "data":{...}},  // ×1 (contains 5 blanks)
  {"type":"tan",      "level":"N3", "order_index":1, "data":{...}},  // ×1 (contains ~4 passages)
  {"type":"chu",      "level":"N3", "order_index":1, "data":{...}},  // ×1 (contains 2 passages)
  {"type":"cho",      "level":"N3", "order_index":1, "data":{...}},  // ×1 (contains 1 passage)
  {"type":"joho",     "level":"N3", "order_index":1, "data":{...}},  // ×1 (contains 1 info doc)

  // 聴解
  {"type":"listen_kadai",   "level":"N3", "order_index":1, "data":{...}},  // 6 sub-Qs
  {"type":"listen_point",   "level":"N3", "order_index":1, "data":{...}},  // 6 sub-Qs
  {"type":"listen_gaiyou",  "level":"N3", "order_index":1, "data":{...}},  // 3 sub-Qs
  {"type":"listen_hatsuwa", "level":"N3", "order_index":1, "data":{...}},  // 4 sub-Qs
  {"type":"listen_sokuji",  "level":"N3", "order_index":1, "data":{...}}   // 9 sub-Qs
]

════════════════════════════════════════════════
CRITICAL RULES — READ BEFORE OUTPUTTING
════════════════════════════════════════════════

1. Output ONLY the JSON array — no markdown fences, no intro text, no explanation.
2. Do NOT translate Japanese text. Copy it exactly as printed.
3. Do NOT summarize passages. Copy the full original text.
4. "wrongs" for 4-choice types = exactly 3 strings.
   "wrongs" for listen_hatsuwa and listen_sokuji = exactly 2 strings.
5. If a page is blurry or illegible, use "question": "[不明 — ページX]" and continue.
6. Passage types (tan, chu, cho, joho): ALL passages in ONE order_index = 1 entry.
7. "vocab" and "grammar" fields: always "" unless you are explicitly told to fill them.
```

---

## Cách dùng

1. **Claude.ai / ChatGPT**: Tạo conversation mới → dán toàn bộ prompt → upload ảnh/PDF đề thi
2. **Gợi ý upload**: Upload từng booklet riêng (booklet 1 / booklet 2 / booklet 3) để kết quả chính xác hơn
3. **Có đáp án**: Upload thêm trang đáp án cùng lúc → AI điền `correct` ngay
4. **Không có đáp án**: Để `correct: ""`, điền thủ công trong admin sau

## Checklist kiểm tra output

Sau khi AI xuất JSON, kiểm tra:
- [ ] Số item `kanji` = đúng số câu trong 問題１
- [ ] `bunsho` có 1 item, bên trong `questions` array = số blank trong passage
- [ ] `tan` / `chu` / `cho` / `joho`: mỗi type chỉ có 1 item (order_index: 1)
- [ ] `listen_hatsuwa` và `listen_sokuji`: `wrongs` có đúng 2 phần tử (không phải 3)
- [ ] `listen_kadai` và `listen_hatsuwa` có `imageUrl` field
- [ ] Toàn bộ passage text trong `bunsho`/`tan`/`chu`/`cho`/`joho` không bị tóm tắt
