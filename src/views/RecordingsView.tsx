import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { durationLabel } from '../lib/date'
import { repository } from '../repository'
import { RECORDING_KEEP, type Recording } from '../types'

/* =========================================================
 * 録音履歴
 *
 * 「あのタスク、本当にそう言ったか」を後から確かめるための画面。
 * 音声は端末内にしか無い。書き出しは端末内での保存のみで、
 * どこかへ送信することはしない。
 * =======================================================*/

function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return '音声なし'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function RecordingsView({ onNotify }: { onNotify: (text: string, tone?: 'ok' | 'error') => void }) {
  const [items, setItems] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const reload = async () => {
    setItems(await repository.listRecordings())
    setLoading(false)
  }

  useEffect(() => {
    void reload()
  }, [])

  // 再生用のURLは使い終わったら必ず解放する
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )

  const play = async (rec: Recording) => {
    if (playing === rec.id) {
      setPlaying(null)
      if (url) URL.revokeObjectURL(url)
      setUrl(null)
      return
    }
    const blob = await repository.getRecordingAudio(rec.id)
    if (!blob) {
      onNotify('この録音の音声は残っていません。テキストだけ確認してください。', 'error')
      return
    }
    if (url) URL.revokeObjectURL(url)
    setUrl(URL.createObjectURL(blob))
    setPlaying(rec.id)
  }

  const save = async (rec: Recording) => {
    const blob = await repository.getRecordingAudio(rec.id)
    if (!blob) {
      onNotify('この録音の音声は残っていません。', 'error')
      return
    }
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('wav') ? 'wav' : 'webm'
    const a = document.createElement('a')
    const u = URL.createObjectURL(blob)
    a.href = u
    a.download = `taskport-${rec.createdAt.slice(0, 10)}-${rec.id.slice(-6)}.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 2000)
    onNotify('音声を保存しました')
  }

  const remove = async (rec: Recording) => {
    await repository.removeRecording(rec.id)
    if (playing === rec.id) {
      setPlaying(null)
      if (url) URL.revokeObjectURL(url)
      setUrl(null)
    }
    setConfirmId(null)
    await reload()
    onNotify('録音を消しました')
  }

  if (loading) return <div className="tp-view"><p className="tp-loading">読み込んでいます…</p></div>

  if (items.length === 0) {
    return (
      <div className="tp-view">
        <div className="tp-empty">
          <Icon name="mic" size={26} />
          <p className="tp-empty-head">録音はまだありません</p>
          <p className="tp-empty-body">
            下のマイクを押して話すと、認識したテキストと音声がここに残ります。
            登録したタスクの元を後から確かめられます。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="tp-view">
      {items.map((rec) => (
        <Reveal key={rec.id}>
          <section className="tp-panel tp-recitem">
            <div className="tp-panel-head">
              <h2 className="tp-mono">{stamp(rec.createdAt)}</h2>
              <span className="tp-badge tp-mono">
                {durationLabel(Math.round(rec.durationSec / 60) || 0) === '0分'
                  ? `${rec.durationSec}秒`
                  : `${Math.floor(rec.durationSec / 60)}分${String(rec.durationSec % 60).padStart(2, '0')}秒`}
              </span>
            </div>

            <p className="tp-recitem-text">{rec.transcript || '（認識できたテキストがありません）'}</p>

            <p className="tp-recitem-meta tp-mono">
              {sizeLabel(rec.bytes)}
              {rec.taskIds.length > 0 && ` ／ ${rec.taskIds.length}件を登録`}
            </p>
            {rec.warning && (
              <p className="tp-recitem-warn">
                <Icon name="alert" size={13} />
                {rec.warning}
              </p>
            )}

            {playing === rec.id && url && (
              <audio className="tp-recitem-audio" src={url} controls autoPlay />
            )}

            <div className="tp-recitem-acts">
              <button
                type="button"
                className="tp-chip-btn"
                disabled={rec.bytes === 0}
                onClick={() => void play(rec)}
              >
                <Icon name="mic" size={14} />
                {playing === rec.id ? '閉じる' : '聞く'}
              </button>
              <button
                type="button"
                className="tp-chip-btn"
                disabled={rec.bytes === 0}
                onClick={() => void save(rec)}
              >
                <Icon name="download" size={14} />
                音声を保存
              </button>
              {confirmId === rec.id ? (
                <>
                  <button type="button" className="tp-chip-btn" onClick={() => setConfirmId(null)}>
                    やめる
                  </button>
                  <button type="button" className="tp-chip-btn is-danger" onClick={() => void remove(rec)}>
                    <Icon name="trash" size={14} />
                    消す
                  </button>
                </>
              ) : (
                <button type="button" className="tp-chip-btn is-danger" onClick={() => setConfirmId(rec.id)}>
                  <Icon name="trash" size={14} />
                  消す
                </button>
              )}
            </div>
          </section>
        </Reveal>
      ))}

      <p className="tp-list-foot">
        録音は新しい方から {RECORDING_KEEP} 本まで端末内に残します。古いものは自動で消えます。
      </p>
    </div>
  )
}
