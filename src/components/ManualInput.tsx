import React, { useState } from 'react';

type Props = {
  disabled?: boolean;
  onSubmit?: (segment: { time: number; speaker: string | null; text: string }) => void;
};

export default function ManualInput({ disabled, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (disabled || !value) return;
    onSubmit?.({ time: 0, speaker: null, text: value });
    setText('');
    setSubmitted(true);
  }
  return (
    <details className="manual-input">
      <summary>Type meeting text instead of speaking</summary>
      <p>Enter a meeting statement. Mock mode displays quoted input; live mode uses your selected AI provider.</p>
      <form onSubmit={submit}>
        <label htmlFor="manual-transcript">Meeting text</label>
        <textarea id="manual-transcript" rows={4} value={text}
          onChange={event => { setText(event.target.value); setSubmitted(false); }}
          style={{ display: 'block', width: '100%', margin: '8px 0' }} />
        <button type="submit" disabled={disabled || !text.trim()}>Send test text</button>
        {submitted && <p role="status">Text queued. Results or processing errors appear above.</p>}
      </form>
    </details>
  );
}
