import { colors, fonts, gradients } from '../theme'
import { CheckIcon } from './icons'

interface Step {
  label: string
}

interface Props {
  steps: Step[]
  /** 0-based index of the current step. Steps before it show a checkmark
   *  (done), the current one a filled gradient circle, later ones a plain
   *  numbered circle. */
  current: number
}

// Makes an otherwise-invisible internal step flip ("modal quietly swaps its
// content") into a legible "2 of 2" — see docs/design-system.html §4.12
// Navigation for the same drill-down visual language used elsewhere.
function StepTracker({ steps, current }: Props): React.JSX.Element {
  return (
    <div style={styles.row}>
      {steps.map((step, i) => (
        <div key={step.label} style={styles.stepGroup}>
          {i > 0 && (
            <div
              style={{
                ...styles.connector,
                background: i <= current ? gradients.energy : colors.borderDefault
              }}
            />
          )}
          <div style={styles.step}>
            {i < current ? (
              <span style={styles.doneCircle}>
                <CheckIcon size={12} color="#06140e" />
              </span>
            ) : i === current ? (
              <span style={styles.activeCircle}>{i + 1}</span>
            ) : (
              <span style={styles.futureCircle}>{i + 1}</span>
            )}
            <span style={{ ...styles.label, color: i === current ? colors.text1 : colors.text3 }}>
              {step.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

const circleBase: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: fonts.mono,
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  stepGroup: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  connector: { flex: 1, height: 2, borderRadius: 2 },
  step: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  doneCircle: { ...circleBase, background: colors.success },
  activeCircle: {
    ...circleBase,
    background: gradients.energy,
    color: colors.textOnAccent,
    boxShadow: '0 0 14px rgba(54,226,232,.4)'
  },
  futureCircle: {
    ...circleBase,
    background: colors.bgRaised,
    border: `1px solid ${colors.borderStrong}`,
    color: colors.text3
  },
  label: { fontFamily: fonts.display, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }
}

export default StepTracker
