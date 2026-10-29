import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, HelpCircle, Info, Loader2, X } from 'lucide-react';
import { useUiStore, type ToastKind } from '@/store/uiStore';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={16} className="spin" /> : icon}
      {children ? <span>{children}</span> : null}
    </button>
  );
});

export function IconButton({
  label,
  className,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      {...props}
      aria-label={label}
      title={label}
      size="icon"
      variant={props.variant ?? 'ghost'}
      className={cx('icon-btn', className)}
    />
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && dismissible) onClose();
    }}>
      <div className={cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {dismissible ? (
            <IconButton label="Cerrar" onClick={onClose} icon={<X size={18} />} />
          ) : null}
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Botón «?» que abre una ventana de ayuda. Sirve para sacar los textos largos
 * de los paneles y dejar la interfaz limpia.
 */
export function HelpButton({
  title,
  children,
  label = 'Ayuda',
}: {
  title: string;
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="help-btn"
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <HelpCircle size={12} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <div className="help-content">{children}</div>
      </Modal>
    </>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  );
}

export function Field({
  label,
  hint,
  children,
  inline,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  return (
    <label className={cx('field', inline && 'field-inline', className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cx('input', className)} {...props} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cx('input', 'textarea', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cx('input', 'select', className)} {...props}>
        {children}
      </select>
    );
  },
);

export function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  suffix,
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('number-input', className)}>
      <input
        type="number"
        className="input"
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {suffix ? <span className="number-suffix">{suffix}</span> : null}
    </div>
  );
}

export function ColorInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cx('color-input', className)}>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <input
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

export function RangeInput({
  value,
  onChange,
  min,
  max,
  step,
  label,
  format,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  format?: (value: number) => string;
}) {
  return (
    <div className="range-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{format ? format(value) : value.toFixed(2)}</strong>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="switch-row">
      <span>
        <span className="switch-label">{label}</span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={cx('switch', checked && 'is-on')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('segmented', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          className={cx(option.value === value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; badge?: number | string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={cx(value === option.value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.badge !== undefined ? <span className="tab-badge">{option.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  title?: string;
}) {
  return <span title={title} className={cx('badge', `badge-${tone}`)}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner">
      <Loader2 size={18} className="spin" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

const TOAST_ICONS: Record<ToastKind, ReactNode> = {
  info: <Info size={17} />,
  success: <Check size={17} />,
  error: <AlertTriangle size={17} />,
  warning: <AlertTriangle size={17} />,
};

export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);
  return createPortal(
    <div className="toaster" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx('toast', `toast-${toast.kind}`)}>
          <span className="toast-icon">{TOAST_ICONS[toast.kind]}</span>
          <span className="toast-message">{toast.message}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Cerrar aviso">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
