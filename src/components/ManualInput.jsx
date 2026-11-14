import React, { useState } from 'react';

export default function ManualInput({ disabled, onSubmit }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  function submit(event) {
    event.preventDefault();
    const value = text.trim();
    if (disabled || !value) return;
    onSubmit({ time: 0, speaker: null, text: value });
    setText('');
    setSubmitted(true);
  }
  return (
    <details style={{ marginTop: 24 }}>
      <summary>Dev tools — test text</summary>
      <p>Enter a meeting statement. Mock mode displays quoted input; live mode asks Gemini to analyze it.</p>
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
