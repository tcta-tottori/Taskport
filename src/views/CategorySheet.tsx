import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { catStyle, CategoryChip } from '../components/CategoryChip'
import { colorOf, guessGroupId } from '../lib/workCategories'
import { ulid } from '../lib/ulid'
import { CATEGORY_COLORS, type CategoryColor, type CategoryGroup } from '../types'

/* =========================================================
 * 区分を選ぶ／マスタを直す
 *
 * 区分は複数選べる。数が多い（既定で35）ので、平らに並べると探せない。
 * グループで畳んだ階層にして、開いた中から押して選ぶ。
 *
 * 選んだ内容は ✓ を押すまで仮（✕ で捨てられる）。
 * **マスタの編集（グループ・区分の追加や削除）はその場で保存する** —
 * 「区分を足したのに ✕ で消えた」を起こさないため。画面にもそう書く。
 * =======================================================*/

export function CategorySheet({
  groups,
  selected,
  onCommit,
  onChangeGroups,
  onClose,
  manageOnly = false,
}: {
  groups: CategoryGroup[]
  /** いま選ばれている区分 */
  selected: string[]
  /** ✓ を押したとき。manageOnly のときは呼ばれない */
  onCommit: (categories: string[]) => void
  /** マスタを直したとき（その場で保存する） */
  onChangeGroups: (next: CategoryGroup[]) => void
  onClose: () => void
  /** 設定画面から開いたとき。選ぶ機能を出さず、マスタの編集だけにする */
  manageOnly?: boolean
}) {
  const [picked, setPicked] = useState<string[]>(selected)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(manageOnly)
  const [openIds, setOpenIds] = useState<string[]>(() => {
    // 選んである区分が入っているグループだけ開けておく
    const has = groups.filter((g) => g.items.some((i) => selected.includes(i))).map((g) => g.id)
    return has.length > 0 ? has : groups.length <= 3 ? groups.map((g) => g.id) : []
  })
  const [newName, setNewName] = useState('')
  const [newGroupId, setNewGroupId] = useState('')
  /** 消してよいか確かめているグループ */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const terms = q.trim().normalize('NFKC').toLowerCase()
  const match = (s: string) => !terms || s.normalize('NFKC').toLowerCase().includes(terms)

  const shown = useMemo(
    () =>
      groups
        .map((g) => ({ group: g, items: g.items.filter((i) => match(i) || match(g.name)) }))
        .filter((g) => editing || g.items.length > 0 || !terms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, terms, editing],
  )

  /** マスタに無い区分（自然文の解析や古いデータが持っているもの） */
  const strays = picked.filter((c) => !groups.some((g) => g.items.includes(c)))

  const toggle = (c: string) =>
    setPicked((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))

  const toggleOpen = (id: string) =>
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const patchGroup = (id: string, p: Partial<CategoryGroup>) =>
    onChangeGroups(groups.map((g) => (g.id === id ? { ...g, ...p } : g)))

  /** 区分を足す。行き先を選んでいなければ、語から見当づけたグループへ入れる。 */
  const addCategory = () => {
    const name = newName.trim()
    if (!name) return
    const to = newGroupId || guessGroupId(name, groups)
    const exists = groups.some((g) => g.items.includes(name))
    if (!exists) {
      onChangeGroups(groups.map((g) => (g.id === to ? { ...g, items: [...g.items, name] } : g)))
    }
    if (!manageOnly) setPicked((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setOpenIds((prev) => (prev.includes(to) ? prev : [...prev, to]))
    setNewName('')
    setNewGroupId('')
  }

  const addGroup = () => {
    const g: CategoryGroup = {
      id: ulid(),
      name: `グループ${groups.length + 1}`,
      color: CATEGORY_COLORS[groups.length % CATEGORY_COLORS.length],
      items: [],
    }
    onChangeGroups([...groups, g])
    setOpenIds((prev) => [...prev, g.id])
  }

  const removeGroup = (g: CategoryGroup) => {
    onChangeGroups(groups.filter((x) => x.id !== g.id))
    setConfirmDel(null)
  }

  const removeItem = (g: CategoryGroup, item: string) =>
    patchGroup(g.id, { items: g.items.filter((i) => i !== item) })

  const moveItem = (from: CategoryGroup, item: string, toId: string) =>
    onChangeGroups(
      groups.map((g) =>
        g.id === from.id
          ? { ...g, items: g.items.filter((i) => i !== item) }
          : g.id === toId
            ? { ...g, items: [...g.items, item] }
            : g,
      ),
    )

  return (
    <div
      className="tp-sheet tp-sheet-over"
      role="dialog"
      aria-modal="true"
      aria-label={manageOnly ? '区分のグループを直す' : '区分を選ぶ'}
    >
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>
            {manageOnly ? '区分とグループ' : '区分を選ぶ'}
            {!manageOnly && <b className="tp-mono tp-head-n">{picked.length}</b>}
          </h2>
          <div className="tp-head-acts">
            {!manageOnly && (
              <button
                type="button"
                className={`tp-mini-btn${editing ? ' is-on' : ''}`}
                aria-pressed={editing}
                onClick={() => setEditing((v) => !v)}
              >
                <Icon name="pencil" size={14} />
                {editing ? '選ぶ' : '編集'}
              </button>
            )}
            <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        {!manageOnly && (
          <div className="tp-cat-picked">
            {picked.length === 0 ? (
              <p className="tp-hint">まだ選んでいません。下の一覧から押して選びます（いくつでも可）。</p>
            ) : (
              <>
                {picked.map((c, i) => (
                  <CategoryChip
                    key={c}
                    label={i === 0 ? `${c}（主）` : c}
                    color={colorOf(groups, c)}
                    onRemove={() => toggle(c)}
                  />
                ))}
                <p className="tp-hint">
                  先頭が主区分。日報と「区分ごとの時間」はここだけで数えます。
                </p>
              </>
            )}
          </div>
        )}

        <div className="tp-sheet-body">
          {!editing && (
            <div className="tp-search tp-cat-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={q}
                placeholder="区分を探す"
                aria-label="区分を探す"
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button type="button" className="tp-search-clear" aria-label="語を消す" onClick={() => setQ('')}>
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          )}

          {strays.length > 0 && !editing && (
            <div className="tp-cat-group">
              <p className="tp-cat-stray-head">マスタに無い区分</p>
              <div className="tp-chips">
                {strays.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="tp-cat-item is-on"
                    style={catStyle('slate')}
                    aria-pressed={true}
                    onClick={() => toggle(c)}
                  >
                    <Icon name="check" size={13} strokeWidth={2.6} />
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {shown.map(({ group: g, items }) => {
            const open = openIds.includes(g.id) || (!!terms && !editing)
            const on = items.filter((i) => picked.includes(i)).length
            return (
              <section key={g.id} className="tp-cat-group" style={catStyle(g.color)}>
                <div className="tp-cat-ghead">
                  <button
                    type="button"
                    className="tp-cat-gtoggle"
                    aria-expanded={open}
                    onClick={() => toggleOpen(g.id)}
                  >
                    <span className="tp-cat-dot" aria-hidden="true" />
                    <b>{g.name}</b>
                    <span className="tp-mono tp-cat-gn">
                      {on > 0 ? `${on}/${g.items.length}` : g.items.length}
                    </span>
                    <Icon name="chevron" size={15} className={`tp-cat-caret${open ? ' is-open' : ''}`} />
                  </button>
                </div>

                {editing && (
                  <div className="tp-cat-gedit">
                    <label className="tp-field">
                      <span className="tp-label">グループ名</span>
                      <input
                        type="text"
                        value={g.name}
                        onChange={(e) => patchGroup(g.id, { name: e.target.value })}
                      />
                    </label>
                    <div className="tp-field">
                      <span className="tp-label">色</span>
                      <div className="tp-cat-colors" role="group" aria-label={`${g.name} の色`}>
                        {CATEGORY_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`tp-cat-color${g.color === c ? ' is-on' : ''}`}
                            style={catStyle(c as CategoryColor)}
                            aria-label={c}
                            aria-pressed={g.color === c}
                            onClick={() => patchGroup(g.id, { color: c as CategoryColor })}
                          />
                        ))}
                      </div>
                    </div>
                    {confirmDel === g.id ? (
                      <div className="tp-cat-confirm">
                        <p>
                          「{g.name}」と、その中の区分 {g.items.length} 件を候補から外します。
                          <b>すでに付けてあるタスクの区分は消えません</b>（グループなしとして集計されます）。
                        </p>
                        <div className="tp-row-end">
                          <button type="button" className="tp-btn-ghost" onClick={() => setConfirmDel(null)}>
                            やめる
                          </button>
                          <button type="button" className="tp-btn-danger" onClick={() => removeGroup(g)}>
                            <Icon name="trash" size={15} />
                            消す
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="tp-link-danger" onClick={() => setConfirmDel(g.id)}>
                        <Icon name="trash" size={14} />
                        このグループを消す（区分 {g.items.length} 件も外れます）
                      </button>
                    )}
                  </div>
                )}

                {open && (
                  <div className={editing ? 'tp-cat-items is-edit' : 'tp-chips tp-cat-items'}>
                    {items.length === 0 && <p className="tp-hint">区分がありません。下から足せます。</p>}
                    {items.map((c) =>
                      editing ? (
                        <div key={c} className="tp-cat-row">
                          <span className="tp-cat-rowname">{c}</span>
                          <select
                            value={g.id}
                            aria-label={`${c} の行き先グループ`}
                            onChange={(e) => moveItem(g, c, e.target.value)}
                          >
                            {groups.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="tp-sub-del"
                            aria-label={`区分「${c}」を消す`}
                            onClick={() => removeItem(g, c)}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          key={c}
                          type="button"
                          className={`tp-cat-item${picked.includes(c) ? ' is-on' : ''}`}
                          aria-pressed={picked.includes(c)}
                          onClick={() => toggle(c)}
                        >
                          {picked.includes(c) && <Icon name="check" size={13} strokeWidth={2.6} />}
                          {c}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </section>
            )
          })}

          {/* 手で足す。行き先は語から見当づけるので、ふつうは名前を書いて押すだけ。 */}
          <div className="tp-cat-add">
            <p className="tp-label">区分を足す</p>
            <div className="tp-cat-addrow">
              <input
                type="text"
                value={newName}
                placeholder="例: 客先訪問"
                aria-label="足す区分の名前"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCategory()
                  }
                }}
              />
              <select
                value={newGroupId || (newName.trim() ? guessGroupId(newName, groups) : '')}
                aria-label="入れるグループ"
                onChange={(e) => setNewGroupId(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button type="button" className="tp-btn-ghost" disabled={!newName.trim()} onClick={addCategory}>
                <Icon name="plus" size={15} />
                足す
              </button>
            </div>
            <p className="tp-hint">
              グループは名前から自動で振り分けます。違うときは右で選び直してください。
              足した区分はすぐ保存されます（✕ で閉じても残ります）。
            </p>
            {editing && (
              <button type="button" className="tp-sub-add" onClick={addGroup}>
                <Icon name="plus" size={14} />
                グループを足す
              </button>
            )}
          </div>
        </div>

        <footer className="tp-sheet-foot">
          {manageOnly ? (
            <button type="button" className="tp-round-btn tp-round-go" onClick={onClose} aria-label="閉じる">
              <Icon name="check" size={22} strokeWidth={2.4} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className="tp-round-btn tp-round-cancel"
                onClick={onClose}
                aria-label="やめる"
                title="やめる"
              >
                <Icon name="close" size={22} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="tp-round-btn tp-round-go"
                onClick={() => onCommit(picked)}
                aria-label={`区分 ${picked.length} 件を決める`}
                title="決める"
              >
                <Icon name="check" size={22} strokeWidth={2.4} />
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
