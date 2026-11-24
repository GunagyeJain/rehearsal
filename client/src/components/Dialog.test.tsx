import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Harness({ onConfirm = () => undefined }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Leave scenario
      </button>
      <Dialog
        open={open}
        title="Leave this scenario?"
        description="Answered turns are kept."
        confirmLabel="Leave"
        cancelLabel="Keep going"
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('Dialog', () => {
  it('opens with focus on the safe action and is labelled by its title', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave scenario' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Leave this scenario?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep going' }));
  });

  it('traps focus with Tab and Shift+Tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave scenario' }));
    const cancel = screen.getByRole('button', { name: 'Keep going' });
    const confirm = screen.getByRole('button', { name: 'Leave' });

    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Leave scenario' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('calls onConfirm from the confirm action', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave scenario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
