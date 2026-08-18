import { Icon } from './Icon'

/* =========================================================
 * 画面下に固定する2つのボタン
 *
 * 左下＝録音、右下＝直接入力（＋）。それだけ。
 *
 * v1.10 までは中央にマイク、両脇に「キーボード」「直接入力」を並べた
 * 統合バーだった。入口が3つに割れていて、どれを押せば何が起きるのかが
 * 分かりにくかったので、バーごと廃止した。
 * 自然文の入力は「＋」の中（タスクを作る画面）へ移してある。
 *
 * 親指の届く左右の下隅に置き、中身（一覧）を隠さない。
 * =======================================================*/

export function QuickBar({
  onStartVoice,
  onOpenForm,
  busy,
  voiceSupported,
}: {
  /** 録音を始める（画面は App 側の録音オーバーレイに切り替わる） */
  onStartVoice: () => void
  /** 1件を作る画面を開く */
  onOpenForm: () => void
  busy: boolean
  voiceSupported: boolean
}) {
  return (
    <div className="tp-quick">
      <button
        type="button"
        className="tp-quick-btn tp-quick-mic"
        disabled={busy || !voiceSupported}
        aria-label={voiceSupported ? '音声で入力する' : '音声は使えません'}
        title={voiceSupported ? '音声で入力' : '音声は未対応'}
        onClick={onStartVoice}
      >
        <span className="tp-fab-ring" aria-hidden="true" />
        <Icon name="mic" size={26} strokeWidth={2} />
      </button>

      <button
        type="button"
        className="tp-quick-btn tp-quick-add"
        aria-label="タスクを作る"
        title="タスクを作る"
        onClick={onOpenForm}
      >
        <Icon name="plus" size={28} strokeWidth={2.2} />
      </button>
    </div>
  )
}
