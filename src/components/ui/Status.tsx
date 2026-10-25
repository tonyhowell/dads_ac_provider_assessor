import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type Status = 'good' | 'caution' | 'stop' | 'info';

export const STATUS_ICON: Record<Status, IconName> = { good: 'check', caution: 'triangle', stop: 'octagon', info: 'info' };
const STATUS_WORD: Record<Status, string> = { good: 'Good', caution: 'Check', stop: 'Stop', info: 'Note' };

export function StatusIcon({ status, size }: { status: Status; size?: number }) {
  return <Icon name={STATUS_ICON[status]} size={size} />;
}

/** Icon + words in the status colour. The words carry the meaning; colour and shape reinforce it. */
export function StatusText({ status, children, className = '' }: { status: Status; children: ReactNode; className?: string }) {
  return (
    <span className={`status status-${status} ${className}`}>
      <StatusIcon status={status} size={20} />
      <span>{children}</span>
    </span>
  );
}

export function Chip({ status, children }: { status: Status | 'neutral'; children: ReactNode }) {
  return (
    <span className={`chip chip-${status}`}>
      {status !== 'neutral' && <StatusIcon status={status} size={16} />}
      {children}
    </span>
  );
}

export const statusWord = (s: Status) => STATUS_WORD[s];
