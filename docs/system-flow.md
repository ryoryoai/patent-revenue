# PatentRevenue システムフロー

## 1. 全体概要

```
┌─────────┐    ┌──────────────┐    ┌──────────────────┐    ┌────────────────┐    ┌──────────────┐
│ ユーザー │───▶│  server.js   │───▶│ 特許データ取得   │───▶│  2層評価       │───▶│ PDF/メール   │
│ (ブラウザ)│    │  HTTP handler │    │ JPO / LLM       │    │ ルール + LLM   │    │ 出力         │
└─────────┘    └──────────────┘    └──────────────────┘    └────────────────┘    └──────────────┘
                     │                                                                  │
                     │  ┌────────────┐                                                  │
                     ├─▶│ Turnstile  │ CAPTCHA検証                                      │
                     │  └────────────┘                                                  │
                     │  ┌────────────┐                                                  │
                     └─▶│ レート制限 │ ユーザー/グローバル                                │
                        └────────────┘                                                  │
                                                                          ┌─────────────┘
                                                                          ▼
                                                                   ┌────────────┐
                                                                   │  Resend    │
                                                                   │  メール送信 │
                                                                   └────────────┘
```

## 2. 外部サービス連携

| サービス | 用途 | エンドポイント | 認証 |
|---------|------|--------------|------|
| JPO 特許情報取得API | 書誌・経過情報の取得 | `https://ip-data.jpo.go.jp` | Username/Password → Bearer Token |
| OpenAI API | メトリクス補完・詳細分析 | `https://api.openai.com/v1/chat/completions` | API Key |
| Resend | メール送信 | `https://api.resend.com` | API Key |
| Cloudflare Turnstile | CAPTCHA検証 | `https://challenges.cloudflare.com/turnstile/v0/siteverify` | Site Key + Secret Key |
| Chromium (Puppeteer) | PDF生成 | ローカル / Vercel上でリモートバイナリ | — |

## 3. APIエンドポイント一覧

| Route | Method | 概要 | 応答 |
|-------|--------|------|------|
| `/api/diagnose` | POST | クイック診断（特許データ取得のみ） | 200 同期 |
| `/api/detailed-report` | POST | 詳細評価レポート生成 | 200 同期 |
| `/api/request-detailed-report` | POST | 詳細レポート＋メール送信 | 202 非同期 |
| `/api/send-report` | POST | 簡易結果メール送信 | 200 |
| `/api/send-detailed-report` | POST | 詳細レポートメール送信 | 200 |
| `/api/evaluate` | POST | V2パイプライン評価 | 202 非同期 |
| `/api/v2-status` | GET | V2パイプライン死活確認 | 200 |
| `/api/metrics` | GET | 内部メトリクス（要キー） | 200 |

## 4. リクエスト処理フロー（詳細）

### Step 0: 検証 & レート制限

```
リクエスト受信
    │
    ├─▶ セキュリティヘッダ付与（CSP, HSTS, X-Frame-Options 等）
    │
    ├─▶ Cookieによるユーザー識別（pvc_vid, HttpOnly, 1年有効）
    │
    ├─▶ ユーザーレート制限チェック
    │     ├── 日次上限: 5件/日 (ANON_DAILY_QUOTA)
    │     ├── バースト制限: 15秒間隔 (BURST_INTERVAL_MS)
    │     ├── 分間上限: 3件/分 (PER_MIN_LIMIT)
    │     ├── 違反時: 5分クールダウン (COOLDOWN_MS)
    │     └── 2回違反: 10分間CAPTCHA必須
    │
    ├─▶ グローバルバジェットチェック
    │     ├── 日次上限: 3,000件 (GLOBAL_DAY_LIMIT)
    │     ├── 時間上限: 500件 (GLOBAL_HOUR_LIMIT)
    │     └── 80%到達でアラート
    │
    └─▶ Turnstile CAPTCHA検証（必要時のみ, タイムアウト3秒）
```

### Step 1: 特許データ取得

```
特許番号入力
    │
    ├─▶ キャッシュ確認（resultCache, TTL: 30日）
    │     └── ヒット → 即返却
    │
    ├─▶ インフライト重複排除（inFlight Map）
    │
    ├─▶ [優先] JPO API (patent-api.js)
    │     ├── トークン取得/更新（1時間有効, リフレッシュ8時間）
    │     ├── 登録番号 → 出願番号変換
    │     ├── fetchComprehensiveData() で全データ取得
    │     └── タイムアウト: 10秒
    │
    ├─▶ [フォールバック] LLM検索 (llm.js)
    │     ├── lookupPatentWithLlm() — gpt-5
    │     ├── 書誌情報をJSON構造で返却
    │     └── タイムアウト: 60秒
    │
    └─▶ [最終] モックデータ（3件のハードコード特許）
```

### Step 2: 事業化評価層（ルールベース）

`patent-research.js` の `researchPatent()` が統括。

```
特許データ
    │
    ├─ 2-1. カテゴリ推定 — inferCategory()
    │   IPC分類コード → 6カテゴリにマッピング
    │   ソフトウェア / 製造DX・AI / エネルギー・材料
    │   医療機器・画像解析 / 通信・IoT / 車載・パワートレイン
    │
    ├─ 2-2. メトリクス補完 — enrichMetricsWithLlm()
    │   不足データをLLM(gpt-5)で推定
    │   marketPlayers, filingDensity, citationGrowth, familySize, classRank
    │
    ├─ 2-3. 品質乗数算出 — computeQualityMultiplier()
    │   8因子の加重平均 → 乗数 0.6〜1.4
    │   ┌────────────────────────┬────────┐
    │   │ 因子                   │ ウェイト │
    │   ├────────────────────────┼────────┤
    │   │ 権利状態 (legal)       │ 0.20   │
    │   │ 残存年数 (term)        │ 0.15   │
    │   │ クレーム強度 (claim)    │ 0.15   │
    │   │ 実験的証拠 (evidence)   │ 0.10   │
    │   │ 設計回避困難性          │ 0.10   │
    │   │ 市場適合性 (market)     │ 0.10   │
    │   │ 立証可能性 (provability)│ 0.10   │
    │   │ ポートフォリオ強度      │ 0.10   │
    │   └────────────────────────┴────────┘
    │   multiplier = 0.6 + 0.8 × weightedSum
    │
    ├─ 2-4. ロイヤルティレンジ — computeRoyaltyRange()
    │   業界別ベースレンジ × 品質乗数
    │   ソフトウェア: 1.2%〜5.5% / 車載: 0.5%〜1.5%
    │   医療: 1.5%〜5.0% / エネルギー: 1.0%〜3.5%
    │
    ├─ 2-5. 収益額推定 — computeValueBracketRevenue()
    │   Relief-from-Royalty法
    │   license_value = 市場規模 × 対象比率 × 採用確率
    │                   × ロイヤルティ率 × 排他性 × 執行性 × 残存年係数
    │   → 4区分: 1000万未満 / 1000万〜1億 / 1億〜10億 / 10億以上
    │
    ├─ 2-6. ライセンス可能分野 — scoreLicenseableFields()
    │   カテゴリ別4分野をスコアリング
    │   ベーススコア + キーワードマッチ + IPC多様性ボーナス
    │
    ├─ 2-7. 収益化手段スコアリング — scoreMonetizationMethods()
    │   5手段を0〜0.95でスコアリング:
    │   ライセンス / 売却 / 製品化 / 共同開発 / 訴訟
    │
    └─ 2-8. 次の一手 — computeNextActions()
        上位手段に紐づくアクション候補から上位4件を選定
```

### Step 3: 文献解析層（LLM）

```
ルールベース評価結果 + 特許データ
    │
    ├─▶ buildStructuredResearchPrompt() — プロンプト構築（~4,000トークン）
    │
    ├─▶ OpenAI API呼び出し (gpt-5.4, maxTokens: 4096)
    │
    └─▶ 構造化JSON出力:
          ├── summary — 発明概要 + 信頼度
          ├── strengths — 軸別評価 [{axis, level, basis, hasEvidence}]
          ├── claimScopeAnalysis — 請求項範囲分析
          ├── licensableFieldsComment — 対象業界コメント
          ├── royaltyRate — 技術的根拠
          ├── perVerticalRates — 業界別料率
          ├── valueBracketReason — 区分判定理由
          ├── monetizationComments — 手段別分析
          └── overseasFamilyAssessment — 外国出願評価

    ※ LLM障害時: generateStructuredFallback() でルールベース結果のみ返却
```

### Step 4: 結果統合 & 出力

```
ルールベース結果 + LLM分析結果
    │
    ├─▶ スコア算出 — computeScoresAndRank()
    │     impact   = 証拠スコア × 100
    │     breadth  = (クレーム×0.6 + 設計回避×0.4) × 100
    │     strength = 権利状態 × 100
    │     monetization = (市場×0.5 + 残存年×0.5) × 100
    │     total    = 4項目平均
    │
    ├─▶ ランク判定
    │     A: total ≥ 75
    │     B: 55〜74
    │     C: 35〜54
    │     D: < 35
    │
    ├─▶ 結果キャッシュ保存 (resultCache)
    │
    └─▶ ファイル永続化 — saveResult() → data/results/{patentNumber}.json
```

## 5. PDF生成 & メール送信フロー

```
researchPatent() 完了
    │
    ├─▶ PDF生成 — generateReportPdf() (pdf-report.js)
    │     ├── Puppeteer + Chromium起動
    │     │     ├── ローカル: システムChrome使用
    │     │     └── Vercel: chromium-min リモートバイナリ
    │     ├── HTML構築（ヘッダー・概要・強み・分野・手段・アクション）
    │     ├── Google Fontsロード（10秒タイムアウト, フォールバックあり）
    │     └── A4 PDF出力
    │
    └─▶ メール送信 — Resend API (mailer.js)
          ├── sendResultEmail() — 簡易結果（A-Dランク + 説明）
          └── sendDetailedReportEmail() — 詳細レポート（PDF添付）
               ├── HTML本文（ブランドスタイリング）
               └── PDF添付ファイル
```

## 6. API料金シミュレーション（1件あたり）

### 使用モデル

| モデル | 用途 | 入力単価 | 出力単価 |
|--------|------|---------|---------|
| gpt-5 | メトリクス補完 | $1.25/1Mトークン | $10.00/1Mトークン |
| gpt-5.4 | 詳細レポート生成 | $2.50/1Mトークン | $15.00/1Mトークン |

### 1件あたりの呼び出し構成

| # | 処理 | モデル | 入力トークン | 出力トークン |
|---|------|--------|------------|------------|
| 1 | メトリクス補完 (`enrichMetricsWithLlm`) | gpt-5 | ~1,500 | ~80 |
| 2 | 詳細レポート生成 (`buildStructuredResearchPrompt`) | gpt-5.4 | 6,200 + 公報テキスト | ~3,000 |
| 3 | LLMフォールバック（JPO API失敗時のみ） | gpt-5 | ~500 | ~300 |

### 公報サイズ別コスト

| ケース | 公報サイズ | ②入力トークン | 合計コスト | 円換算(150円/$) |
|--------|----------|-------------|-----------|----------------|
| 小 | 5.6K字 | ~14,700 | $0.084 | **約12.6円** |
| 中 | 12.3K字 | ~24,700 | $0.107 | **約16円** |
| 大 | 26.3K字 | ~45,600 | $0.159 | **約24円** |
| 特大 | 54.2K字 | ~87,500 | $0.264 | **約40円** |

**典型的な1件あたり: 約12〜25円（$0.08〜$0.17）**

### 月間コストシミュレーション

| 月間件数 | 小規模 | 中央値(~18円) | 大規模 |
|---------|--------|-------------|--------|
| 50件 | 630円 | 900円 | 1,200円 |
| 100件 | 1,260円 | 1,800円 | 2,400円 |
| 500件 | 6,300円 | 9,000円 | 12,000円 |
| 1,000件 | 12,600円 | 18,000円 | 24,000円 |

> JPO API失敗時は `lookupPatentWithLlm`（gpt-5）が追加で +約0.6円

## 7. 主要関数の呼び出しマップ

### server.js — HTTPハンドラ & セキュリティ

| 関数 | 概要 |
|------|------|
| `handler(req, res)` | メインHTTPハンドラ |
| `getDiagnosis(query)` | 特許取得 + キャッシュ管理 |
| `checkAndConsumeUserQuota(vid)` | ユーザーレート制限 |
| `checkGlobalBudget()` | グローバル予算チェック |
| `verifyTurnstileToken(token)` | CAPTCHA検証 |
| `ensureVisitorCookie(req, res)` | Cookie発行 |

### lib/patent-research.js — 2層評価エンジン

| 関数 | 概要 |
|------|------|
| `researchPatent(patentNumber, options)` | メインオーケストレータ |
| `inferCategory(patent)` | IPC → カテゴリ分類 |
| `enrichMetricsWithLlm(patent)` | LLMによるメトリクス補完 |
| `computeQualityMultiplier(patent)` | 8因子品質乗数 |
| `computeRoyaltyRange(patent)` | ロイヤルティレンジ算出 |
| `computeValueBracketRevenue(royaltyRange, patent)` | 収益額4区分判定 |
| `scoreLicenseableFields(patent, royaltyRange)` | ライセンス可能分野スコア |
| `scoreMonetizationMethods(patent, royaltyRange)` | 5手段スコアリング |
| `computeNextActions(methods, patent)` | アクション推薦 |
| `computeScoresAndRank(patent, royaltyRange)` | 総合スコア & ランク |
| `buildStructuredResearchPrompt(patent, ruleResults)` | LLM分析プロンプト構築 |

### lib/patent-api.js — JPO API クライアント

| 関数 | 概要 |
|------|------|
| `isPatentApiAvailable()` | JPO認証情報の有無 |
| `getAccessToken()` | トークン取得/更新 |
| `fetchComprehensiveData(patentNumber)` | 全特許データ取得 |
| `resolveApplicationNumber(regNum)` | 登録番号 → 出願番号変換 |

### lib/llm.js — OpenAI連携

| 関数 | 概要 |
|------|------|
| `callOpenAiApi(prompt, options)` | OpenAI API呼び出し |
| `lookupPatentWithLlm(query, patentNumber)` | LLMによる特許検索 |

### lib/pdf-report.js — PDF生成

| 関数 | 概要 |
|------|------|
| `generateReportPdf(data)` | HTML → A4 PDF変換 |

### lib/mailer.js — メール送信

| 関数 | 概要 |
|------|------|
| `sendResultEmail({email, name, reportData})` | 簡易結果メール |
| `sendDetailedReportEmail({email, name, reportData})` | 詳細レポート + PDF添付メール |

### lib/result-store.js — 結果永続化

| 関数 | 概要 |
|------|------|
| `saveResult(patentNumber, result)` | ファイル保存（JSON） |
| `loadResult(patentNumber)` | 結果読み込み |
| `listResults()` | 全件サマリ |

### lib/v2-client.js — V2パイプライン（現在停止中）

| 関数 | 概要 |
|------|------|
| `investigateAndRank(patentId, options)` | V2評価オーケストレータ |
| `startInvestigation(patentId, options)` | 非同期ジョブ開始 |
| `waitForCompletion(jobId, onProgress)` | ポーリング待機 |
| `determineRank(data)` | A-Dランク判定 |
| `isV2Available()` | 死活確認 |
