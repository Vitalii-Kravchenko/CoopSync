import { useEffect, useRef, useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import { useFocusTrap } from '../hooks/useFocusTrap'
import Button from './Button'
import GamePoster from './GamePoster'
import Select from './Select'
import { SupportIcon, CloseIcon, CheckIcon, SearchIcon } from './icons'
import { MAX_GAME_REQUESTS } from '../../../shared/types'
import type { SupportCategory, SteamSearchResult } from '../../../shared/types'

interface Props {
  onClose: () => void
}

const CATEGORIES: SupportCategory[] = ['bug', 'game-request', 'idea', 'other']
const SEARCH_DEBOUNCE_MS = 350

// Modal for the "Support" button — category selection + free text (or a Steam
// game search for the "I want a game" category) — sends via window.api.support.send
// (main -> Worker -> Resend -> my inbox). No email-sending secrets appear here
// in any form.
function SupportModal({ onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [category, setCategory] = useState<SupportCategory>('bug')
  const [message, setMessage] = useState('')
  const [selectedGames, setSelectedGames] = useState<SteamSearchResult[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SteamSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const searchToken = useRef(0)
  // Only close on a backdrop click if the mouse PRESS itself was also on the
  // backdrop, not inside the card. Otherwise selecting text (mousedown in a field ->
  // drag outside the modal -> mouseup on the backdrop) is treated by the browser
  // as a backdrop click (common ancestor of the mousedown/mouseup targets), and
  // the modal would close on its own.
  const mouseDownOnBackdrop = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef)

  const categoryLabel: Record<SupportCategory, string> = {
    bug: t.support.categoryBug,
    'game-request': t.support.categoryGame,
    idea: t.support.categoryIdea,
    other: t.support.categoryOther
  }

  const gameLimitReached = selectedGames.length >= MAX_GAME_REQUESTS

  // Debounced Steam store search — only while the game limit hasn't been reached.
  useEffect(() => {
    if (category !== 'game-request' || gameLimitReached) return
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const token = ++searchToken.current
    const timer = setTimeout(() => {
      window.api.games.searchStore(term).then((found) => {
        if (searchToken.current === token) {
          setResults(found)
          setSearching(false)
        }
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, category, gameLimitReached])

  function handleCategoryChange(c: SupportCategory): void {
    setCategory(c)
    setError(null)
    setSelectedGames([])
    setQuery('')
    setResults([])
  }

  function addGame(game: SteamSearchResult): void {
    setSelectedGames((prev) => (prev.some((g) => g.appId === game.appId) ? prev : [...prev, game]))
    setQuery('')
    setResults([])
  }

  function removeGame(appId: string): void {
    setSelectedGames((prev) => prev.filter((g) => g.appId !== appId))
  }

  async function handleSend(): Promise<void> {
    if (category === 'game-request') {
      if (selectedGames.length === 0) {
        setError(t.support.gameRequired)
        return
      }
    } else if (!message.trim()) {
      setError(t.support.messageRequired)
      return
    }
    // Deliberately NOT clearing the previous error here — otherwise it would briefly
    // disappear and reappear (same text) if a retry fails for the same reason.
    // We only replace/clear it once the new result is known.
    setState('sending')
    try {
      await window.api.support.send({
        category,
        message,
        games: category === 'game-request' ? selectedGames : undefined
      })
      setError(null)
      setState('sent')
      setTimeout(onClose, 3200)
    } catch (err) {
      setError(describeError(err, t, t.errors.SUPPORT_SEND_FAILED({})))
      setState('error')
    }
  }

  const busy = state === 'sending' || state === 'sent'

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (!busy && mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={cardRef} style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.topBar} />
        <div style={styles.body}>
          <div style={styles.titleRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={styles.titleIcon}>
                <SupportIcon size={16} color={colors.cy} />
              </div>
              <div style={styles.title}>{t.support.title}</div>
            </div>
            <button
              className="icon-btn"
              style={styles.headerCloseBtn}
              onClick={onClose}
              disabled={state === 'sending'}
              title={t.windowControls.close}
              aria-label={t.windowControls.close}
            >
              <CloseIcon size={15} />
            </button>
          </div>

          {state === 'sent' ? (
            <div style={styles.success}>
              <CheckIcon size={18} color={colors.success} />
              <span>{t.support.success}</span>
            </div>
          ) : (
            <>
              <Select
                style={styles.selectWrap}
                value={category}
                onChange={handleCategoryChange}
                disabled={busy}
                options={CATEGORIES.map((c) => ({ value: c, label: categoryLabel[c] }))}
              />

              {category === 'game-request' ? (
                <>
                  {selectedGames.length > 0 && (
                    <div style={styles.selectedGamesList}>
                      {selectedGames.map((g) => (
                        <div key={g.appId} style={styles.selectedGameRow}>
                          <GamePoster appId={g.appId} imageUrl={g.imageUrl} style={styles.selectedGamePoster} />
                          <span style={styles.selectedGameName}>{g.name}</span>
                          <button
                            className="icon-btn-plain"
                            style={styles.removeGameBtn}
                            onClick={() => removeGame(g.appId)}
                            disabled={busy}
                            title={t.support.removeGame}
                            aria-label={t.support.removeGame}
                          >
                            <CloseIcon size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {gameLimitReached ? (
                    <div style={styles.maxGamesHint}>{t.support.maxGamesReached(MAX_GAME_REQUESTS)}</div>
                  ) : (
                    <>
                      <div style={styles.searchWrap}>
                        <div style={styles.searchIcon}>
                          <SearchIcon size={15} color={colors.text3} />
                        </div>
                        <input
                          className="input-field"
                          style={styles.searchInput}
                          placeholder={
                            selectedGames.length > 0 ? t.support.addAnotherGame : t.support.gameSearchPlaceholder
                          }
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          disabled={busy}
                        />
                      </div>

                      {query.trim().length >= 2 && (
                        <div style={styles.resultsBox}>
                          {searching ? (
                            <div style={styles.resultsHint}>…</div>
                          ) : results.length === 0 ? (
                            <div style={styles.resultsEmpty}>{t.support.gameSearchEmpty}</div>
                          ) : (
                            results
                              .filter((r) => !selectedGames.some((g) => g.appId === r.appId))
                              .map((r) => (
                                <button
                                  key={r.appId}
                                  className="reset-btn"
                                  style={styles.resultRow}
                                  onClick={() => addGame(r)}
                                >
                                  <GamePoster appId={r.appId} imageUrl={r.imageUrl} style={styles.resultPoster} />
                                  <span style={styles.resultName}>{r.name}</span>
                                </button>
                              ))
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {selectedGames.length > 0 && (
                    <textarea
                      className="input-field"
                      style={styles.textareaComment}
                      placeholder={t.support.commentOptionalPlaceholder}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      disabled={busy}
                      rows={3}
                    />
                  )}
                </>
              ) : (
                <textarea
                  className="input-field"
                  style={styles.textarea}
                  placeholder={t.support.placeholder}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  rows={5}
                />
              )}

              {error && <div style={styles.error}>{error}</div>}

              <div style={styles.actions}>
                <Button variant="primary" onClick={handleSend} disabled={busy}>
                  {state === 'sending' ? t.support.sending : t.support.send}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: `radial-gradient(circle at 20% -10%, rgba(30,40,60,.5), ${colors.bgVoid} 60%)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200
  },
  card: {
    width: 460,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: shadows.sh5,
    overflow: 'hidden',
    outline: 'none'
  },
  topBar: { height: 2, background: gradients.energy },
  body: { padding: 22 },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16
  },
  headerCloseBtn: { width: 32, height: 32 },
  titleIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    background: gradients.energySoft,
    border: `1px solid ${colors.borderAccent}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  title: { fontFamily: fonts.display, fontWeight: 600, fontSize: 17, color: colors.text1 },
  selectWrap: { marginBottom: 14 },
  textarea: {
    width: '100%',
    resize: 'vertical',
    minHeight: 100,
    padding: '12px 14px',
    fontSize: 14,
    lineHeight: 1.5,
    fontFamily: fonts.body,
    color: colors.text1,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    boxSizing: 'border-box',
    outline: 'none'
  },
  textareaComment: {
    width: '100%',
    resize: 'vertical',
    minHeight: 60,
    marginTop: 12,
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: fonts.body,
    color: colors.text1,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    boxSizing: 'border-box',
    outline: 'none'
  },
  searchWrap: { position: 'relative' },
  searchIcon: {
    position: 'absolute',
    left: 13,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    pointerEvents: 'none'
  },
  searchInput: {
    width: '100%',
    height: 42,
    padding: '0 14px 0 38px',
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.text1,
    background: colors.bgInset,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,.3)',
    boxSizing: 'border-box',
    outline: 'none'
  },
  resultsBox: {
    marginTop: 8,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.md,
    background: colors.bgOverlay,
    boxShadow: shadows.sh2,
    overflow: 'hidden',
    maxHeight: 220,
    overflowY: 'auto'
  },
  resultsHint: { padding: '14px 12px', fontSize: 13, color: colors.text3, textAlign: 'center' },
  resultsEmpty: { padding: '14px 12px', fontSize: 13, color: colors.text3, textAlign: 'center' },
  resultRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${colors.borderSubtle}`,
    cursor: 'pointer',
    textAlign: 'left'
  },
  resultPoster: {
    // Steam poster 600x900 = exactly 2:3.
    width: 28,
    height: 42,
    objectFit: 'cover',
    borderRadius: radii.sm,
    flexShrink: 0,
    background: colors.bgInset
  },
  resultName: { fontSize: 13.5, color: colors.text1 },
  selectedGamesList: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 },
  selectedGameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    background: colors.bgRaised,
    border: `1px solid ${colors.borderAccent}`,
    borderRadius: radii.md
  },
  selectedGamePoster: {
    // Steam poster 600x900 = exactly 2:3.
    width: 32,
    height: 48,
    objectFit: 'cover',
    borderRadius: radii.sm,
    flexShrink: 0,
    background: colors.bgInset
  },
  selectedGameName: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.display,
    fontWeight: 600,
    fontSize: 13.5,
    color: colors.text1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  removeGameBtn: { flexShrink: 0 },
  maxGamesHint: {
    fontSize: 12.5,
    color: colors.info,
    background: colors.infoBg,
    border: `1px solid ${colors.infoBd}`,
    borderRadius: radii.sm,
    padding: '8px 10px',
    marginBottom: 12
  },
  error: {
    fontSize: 12.5,
    color: colors.danger,
    background: colors.dangerBg,
    border: `1px solid ${colors.dangerBd}`,
    borderRadius: radii.sm,
    padding: '8px 10px',
    marginTop: 12
  },
  success: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: colors.success,
    fontSize: 14,
    padding: '10px 2px 4px'
  },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', marginTop: 18 }
}

export default SupportModal
