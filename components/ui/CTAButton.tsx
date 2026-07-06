interface CTAButtonProps {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "danger"
  disabled?: boolean
  onClick?: () => void
  type?: "button" | "submit"
}

const VARIANT_STYLES = {
  primary: "bg-[var(--color-primary-mid)] text-white disabled:bg-[var(--color-primary-muted)] disabled:text-[var(--color-text-muted)]",
  secondary: "bg-transparent text-[var(--color-text-muted)] border border-[var(--color-primary-border)]",
  danger: "bg-white text-[#e05252] border border-[#f5c4c4]",
}

export default function CTAButton({
  children,
  variant = "primary",
  disabled = false,
  onClick,
  type = "button",
}: CTAButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-[16px] py-[13px] text-[15px] font-medium transition-colors ${VARIANT_STYLES[variant]}`}
      style={{ borderWidth: variant === "primary" ? 0 : "0.5px" }}
    >
      {children}
    </button>
  )
}
