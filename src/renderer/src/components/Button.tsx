import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

// Єдина кнопка для всього застосунку. Стилі й hover — у index.css (.btn .btn-*).
function Button({ variant = 'primary', className, ...rest }: Props): React.JSX.Element {
  return <button className={`btn btn-${variant}${className ? ' ' + className : ''}`} {...rest} />
}

export default Button
