import { useEffect, useRef, useState } from 'react'
import { colors, fonts, gradients, radii, shadows } from '../theme'
import { useI18n } from '../i18n'
import { describeError } from '../errors'
import { useFocusTrap } from '../hooks/useFocusTrap'
import Button from './Button'
import GamePoster from './GamePoster'
import Select from './Select'
import { SupportIcon, CloseIcon, CheckIcon, SearchIcon, ImageIcon } from './icons'
import { MAX_GAME_REQUESTS, MAX_SCREENSHOTS, MAX_SCREENSHOT_BYTES } from '../../../shared/types'
import type { SupportCategory, SteamSearchResult, InstalledGame, SupportScreenshot } from '../../../shared/types'

const ALLOWED_SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface Props {
  onClose: () => void
  /** Pre-attach a game (poster+name+id, GamePoster resolves the cover art
   *  from appId) — used when opened from an experimental-confirm toast's
   *  "є проблеми" answer (see TitleBar.tsx), same rich card the
   *  "game-request" category already shows for a manually picked game.
   *  Category stays whatever the default is ('bug' below) — attaching a
   *  game no longer implies switching category, unlike selecting one via
   *  the game-request search. */
  initialGame?: SteamSearchResult
}

const CATEGORIES: SupportCategory[] = ['bug', 'game-request', 'idea', 'other']
const SEARCH_DEBOUNCE_MS = 350

// Modal for the "Support" button — category selection + free text (or a Steam
// game search for the "I want a game" category) — sends via window.api.support.send
// (main -> Worker -> Resend -> my inbox). No email-sending secrets appear here
// in any form.
function SupportModal({ onClose, initialGame }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [category, setCategory] = useState<SupportCategory>('bug')
  const [message, setMessage] = useState('')
  const [selectedGames, setSelectedGames] = useState<SteamSearchResult[]>(initialGame ? [initialGame] : [])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SteamSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // For the 'bug' category's game search — Vitalii's own already-synced
  // games (installed + supported), not the whole Steam catalog like
  // 'game-request' searches — a bug report should only ever point at a game
  // CoopSync actually handles. Loaded once (small local list, no debounce/
  // network needed — filtering happens synchronously in render below).
  const [myGames, setMyGames] = useState<InstalledGame[]>([])
  useEffect(() => {
    // Catalog games only — a custom (manually pointed-at) game isn't
    // something CoopSync's own sync logic can have a "bug" in the same
    // sense (Vitalii's call, 2026-07-30).
    window.api.games.allInstalled().then((list) => setMyGames(list.filter((g) => g.supported && !g.isCustom)))
  }, [])
  // 'bug' only (Vitalii's request, 2026-07-30) — content is the base64 the
  // Worker forwards straight into Resend's attachments field, previewUrl is
  // the same data kept as a full data: URL just for the thumbnail <img>
  // (cheaper than re-deriving one from content on every render).
  const [screenshots, setScreenshots] = useState<(SupportScreenshot & { previewUrl: string })[]>([])
  const [screenshotError, setScreenshotError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // Animated height for the category-conditional content area — switching
  // categories (or picking/deselecting a game, seeing search results, etc.)
  // used to just snap the modal to its new size instantly (Vitalii's
  // report, 2026-07-30: felt like the modal was "jumping"). ResizeObserver
  // measures the inner content's real height on every change (same pattern
  // as ToastStack.tsx's own content-size reporting); the outer wrapper below
  // transitions to that pixel height instead of sizing itself — CSS can't
  // animate to/from 'auto' directly. undefined on first mount (no observer
  // reading yet) deliberately falls back to 'auto' sizing, so opening the
  // modal never animates, only later changes do.
  const categoryContentRef = useRef<HTMLDivElement>(null)
  const [categoryContentHeight, setCategoryContentHeight] = useState<number | undefined>(undefined)
  useEffect(() => {
    const el = categoryContentRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setCategoryContentHeight(entries[0]?.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const categoryLabel: Record<SupportCategory, string> = {
    bug: t.support.categoryBug,
    'game-request': t.support.categoryGame,
    idea: t.support.categoryIdea,
    other: t.support.categoryOther
  }

  const gameLimitReached = selectedGames.length >= MAX_GAME_REQUESTS

  // Synchronous local filter (no debounce/network — myGames is a small
  // already-loaded list) — only shown for category 'bug', see myGames' own
  // doc comment above.
  const myGameResults =
    category === 'bug' && query.trim().length >= 1
      ? myGames
          .filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))
          .filter((g) => !selectedGames.some((s) => s.appId === g.appId))
          .slice(0, 8)
      : []

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
    setScreenshots([])
    setScreenshotError(null)
  }

  function addGame(game: SteamSearchResult): void {
    setSelectedGames((prev) => (prev.some((g) => g.appId === game.appId) ? prev : [...prev, game]))
    setQuery('')
    setResults([])
  }

  function removeGame(appId: string): void {
    setSelectedGames((prev) => prev.filter((g) => g.appId !== appId))
  }

  // 'bug' only — reads each picked file as a data URL (FileReader, no IPC
  // needed, a plain <input type="file"> works fine in Electron's renderer),
  // strips the "data:...;base64," prefix for the part that actually gets
  // sent (content), keeps the full data URL only for the local thumbnail
  // (previewUrl). Validated client-side for a quick error message — the
  // Worker re-validates the same limits server-side regardless (a direct
  // POST bypassing the app is always possible).
  function handleScreenshotFiles(files: FileList | null): void {
    if (!files || files.length === 0) return
    setScreenshotError(null)
    const room = MAX_SCREENSHOTS - screenshots.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    if (files.length > picked.length) {
      setScreenshotError(t.support.tooManyScreenshots(MAX_SCREENSHOTS))
    }
    for (const file of picked) {
      if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) {
        setScreenshotError(t.support.screenshotBadType)
        continue
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setScreenshotError(t.support.screenshotTooBig)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        if (!base64) return
        setScreenshots((prev) =>
          prev.length >= MAX_SCREENSHOTS
            ? prev
            : [...prev, { filename: file.name, content: base64, mimeType: file.type, previewUrl: dataUrl }]
        )
      }
      reader.readAsDataURL(file)
    }
  }

  function removeScreenshot(index: number): void {
    setScreenshots((prev) => prev.filter((_, i) => i !== index))
    setScreenshotError(null)
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
        // Not gated to game-request anymore — a game pre-attached to a
        // 'bug'/'idea'/'other' report should still reach the email (the
        // Worker's own template already renders a game card for any
        // category, see support-mailer/src/index.ts's gamesHtml).
        games: selectedGames.length > 0 ? selectedGames : undefined,
        screenshots:
          category === 'bug' && screenshots.length > 0
            ? screenshots.map(({ filename, content, mimeType }) => ({ filename, content, mimeType }))
            : undefined
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
        {/* Full-width gradient again (Vitalii's request, 2026-07-30) —
            clipped to just the card's own top corners via this dedicated
            small wrapper, NOT the whole card (that's what caused the
            dropdown-clipping bug this file's card style comment explains).
            Tall enough (16px) that its own border-radius isn't clamped down
            to near-nothing by CSS on a too-thin box — a 2px-tall element
            with a 16px radius gets auto-clamped to ~1px, which read as a
            visible seam against the card's real corner curve. */}
        <div style={styles.topBarClip}>
          <div style={styles.topBar} />
        </div>
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

              {/* Animates to the new content height instead of snapping — see
                  categoryContentHeight's doc comment above. No +buffer
                  needed anymore now that categoryContentOuter isn't
                  overflow:hidden (see its own doc comment) — a focus glow or
                  dropdown extending past the measured height just shows,
                  it's no longer clipped. */}
              <div style={{ ...styles.categoryContentOuter, height: categoryContentHeight }}>
              <div ref={categoryContentRef} style={styles.categoryContentInner}>
                {/* Not gated to category === 'game-request' anymore — a game can
                  also arrive pre-attached on a 'bug' report (see initialGame's
                  doc comment above), and stays visible even if the user then
                  switches to 'game-request' and back. */}
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

              {category === 'game-request' &&
                (gameLimitReached ? (
                  <div style={styles.maxGamesHint}>{t.support.maxGamesReached(MAX_GAME_REQUESTS)}</div>
                ) : (
                  <div style={{ ...styles.searchBlock, marginTop: selectedGames.length > 0 ? 12 : 0 }}>
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
                  </div>
                ))}

              {/* 'bug' — search Vitalii's OWN already-synced games (installed
                  + supported, catalog only — no custom games, see myGames'
                  own doc comment), not the whole Steam catalog like
                  game-request above. Capped at exactly ONE game (unlike
                  game-request's up-to-MAX_GAME_REQUESTS) — a single bug
                  report is always about one specific game, "add another"
                  doesn't make sense here (Vitalii's call, 2026-07-30): the
                  search just disappears once a game is attached, instead of
                  gameLimitReached's hint. No debounce/searching indicator —
                  myGames is a small already-loaded local list, filtering is
                  synchronous. */}
              {category === 'bug' && selectedGames.length === 0 && (
                <div style={styles.searchBlock}>
                  <div style={styles.searchWrap}>
                    <div style={styles.searchIcon}>
                      <SearchIcon size={15} color={colors.text3} />
                    </div>
                    <input
                      className="input-field"
                      style={styles.searchInput}
                      placeholder={t.support.myGamesSearchPlaceholder}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={busy}
                    />
                  </div>

                  {query.trim().length >= 1 && (
                    <div style={styles.resultsBox}>
                      {myGameResults.length === 0 ? (
                        <div style={styles.resultsEmpty}>{t.support.gameSearchEmpty}</div>
                      ) : (
                        myGameResults.map((g) => (
                          <button
                            key={g.appId}
                            className="reset-btn"
                            style={styles.resultRow}
                            onClick={() => addGame({ appId: g.appId, name: g.name })}
                          >
                            <GamePoster appId={g.appId} style={styles.resultPoster} />
                            <span style={styles.resultName}>{g.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {category === 'game-request' ? (
                selectedGames.length > 0 && (
                  <textarea
                    className="input-field"
                    style={styles.textareaComment}
                    placeholder={t.support.commentOptionalPlaceholder}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={busy}
                    rows={3}
                  />
                )
              ) : (
                <textarea
                  className="input-field"
                  style={selectedGames.length > 0 ? styles.textareaComment : styles.textarea}
                  placeholder={t.support.placeholder}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  rows={selectedGames.length > 0 ? 3 : 5}
                />
              )}

              {/* Thumbnails only here (grouped with the description, both
                  inside the animated categoryContentInner) — the trigger
                  button itself moved to the static actions row below (see
                  its own doc comment there): it used to sit in here and
                  could get clipped for a frame while this container's
                  ResizeObserver-driven height caught up with a layout change
                  like picking a game (Vitalii's report, 2026-07-30). */}
              {category === 'bug' && screenshots.length > 0 && (
                <div style={styles.screenshotThumbs}>
                  {screenshots.map((s, i) => (
                    <div key={i} style={styles.screenshotThumb}>
                      <img src={s.previewUrl} alt={s.filename} style={styles.screenshotThumbImg} />
                      <button
                        className="icon-btn-plain screenshot-remove-btn"
                        style={styles.screenshotRemoveBtn}
                        onClick={() => removeScreenshot(i)}
                        disabled={busy}
                        title={t.support.removeScreenshot}
                        aria-label={t.support.removeScreenshot}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              </div>
              </div>

              {error && <div style={styles.error}>{error}</div>}
              {screenshotError && <div style={styles.error}>{screenshotError}</div>}

              <div style={styles.actions}>
                {/* Not inside the animated categoryContentInner (see that
                    thumbnails-only comment above) — a static row, same as
                    Send beside it, never subject to the height-transition
                    clipping. marginRight:'auto' on the button pushes Send to
                    the far right without disturbing actions' own
                    justifyContent for every OTHER category, which never
                    renders this at all (Vitalii's request, 2026-07-30: same
                    row, screenshot button on the left, Send on the right). */}
                {category === 'bug' && screenshots.length < MAX_SCREENSHOTS && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      style={styles.hiddenFileInput}
                      onChange={(e) => {
                        handleScreenshotFiles(e.target.files)
                        e.target.value = ''
                      }}
                      disabled={busy}
                    />
                    <Button
                      variant="ghost"
                      style={{ ...styles.addScreenshotBtn, marginRight: 'auto' }}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                    >
                      <ImageIcon size={14} color={colors.text2} />
                      {t.support.addScreenshot}
                    </Button>
                  </>
                )}
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
    position: 'relative',
    width: 460,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    background: colors.bgOverlay,
    boxShadow: shadows.sh5,
    // Deliberately NOT overflow:hidden — the category Select's dropdown is
    // an absolutely-positioned child that can extend below the card's
    // current (content-driven) height, e.g. right after switching to the
    // short "game-request, nothing picked yet" state. overflow:hidden here
    // used to clip that dropdown's last option(s) off (Vitalii's report,
    // 2026-07-30: "Інше" missing, only 3 rows visible). topBarClip below
    // clips just the gradient stripe's own corners instead, in its own
    // small absolutely-positioned wrapper — see its doc comment at the JSX
    // usage above.
    outline: 'none'
  },
  // Absolutely positioned (out of normal flow — position:relative on card
  // above anchors it) so it never affects layout height, just overlays the
  // top edge. See this style's JSX usage comment for why it's 16px tall
  // (avoiding CSS's border-radius clamping on a too-thin box) despite the
  // gradient itself (topBar below) only being 2px.
  topBarClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    overflow: 'hidden',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    pointerEvents: 'none'
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
  // Matches the plain textarea's own minHeight (100) below — see this
  // wrapper's usage doc comment above.
  // overflow:hidden clips content during the transition (e.g. text
  // reflowing while the height is mid-animation) — harmless since the inner
  // content is never actually taller than the current animated height for
  // more than a frame (ResizeObserver reacts almost immediately).
  // Deliberately NOT overflow:hidden anymore — it clipped growing content
  // that's taller than the CURRENT (mid-transition or stale) height value:
  // the category Select's own dropdown, a focus-glow box-shadow, and the
  // game-request search results dropdown all got cut off this way at
  // different points (Vitalii's reports, 2026-07-30). The height transition
  // still smooths things out; a shrinking transition may show old content
  // linger visibly for the ~220ms of the animation — a minor cosmetic
  // tradeoff, and far less broken than clipping real interactive UI.
  categoryContentOuter: { transition: 'height 220ms ease' },
  categoryContentInner: {},
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
    marginTop: 8,
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
  // Wraps the search input + its results dropdown — gives the whole block
  // breathing room from whatever follows (textarea, or the selected-games
  // list) instead of them sitting flush against each other (Vitalii's
  // report, 2026-07-30: "Знайшов баг" search and "Опиши тут..." were too
  // close together).
  // marginTop set inline per-instance (0 vs 12) — only needed when a game
  // card sits right above (selectedGamesList has no bottom margin of its
  // own); with NO game selected yet, this is the first thing after the
  // Select and 12 extra px on top of the Select's own marginBottom made the
  // gap to it too big (Vitalii's report, 2026-07-30).
  searchBlock: { marginBottom: 14 },
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
  // marginTop clearly bigger than marginBottom — the attached game visually
  // belongs WITH the description field below it, not with the category
  // picker above (Vitalii's report, 2026-07-30: it read as closer to
  // "Знайшов баг" than to "Опиши тут...").
  selectedGamesList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 },
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
  // marginTop, not marginBottom — sits right below the textarea (grouped as
  // "explaining the bug"). The add-screenshot trigger button itself lives in
  // the actions row now (see its own doc comment there) — this is just the
  // thumbnail previews, still inside the animated categoryContentInner.
  screenshotThumbs: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  screenshotThumb: {
    position: 'relative',
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    overflow: 'hidden',
    border: `1px solid ${colors.borderDefault}`,
    background: colors.bgInset
  },
  screenshotThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  // color/background deliberately NOT here anymore — the
  // .screenshot-remove-btn CSS class (index.css) owns them now so its
  // :hover rule can actually win (same reasoning as toast.css's
  // .toast-dismiss: an inline style always beats a stylesheet rule).
  screenshotRemoveBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%'
  },
  hiddenFileInput: { display: 'none' },
  addScreenshotBtn: { height: 34, padding: '0 14px', fontSize: 12.5 },
  maxGamesHint: {
    fontSize: 12.5,
    color: colors.info,
    background: colors.infoBg,
    border: `1px solid ${colors.infoBd}`,
    borderRadius: radii.sm,
    padding: '8px 10px',
    marginTop: 12,
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
