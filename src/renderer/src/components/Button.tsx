import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

// A single button for the whole app. Styles and hover are in index.css (.btn .btn-*).
function Button({ variant = 'primary', className, ...rest }: Props): React.JSX.Element {
  return <button className={`btn btn-${variant}${className ? ' ' + className : ''}`} {...rest} />
}

export default Button
