import React, { useEffect, useId, useRef, useState } from 'react';
import { addMeetingMaterial, extractMeetingMaterial } from '../services/meetingMaterials.js';

export default function MeetingMaterials({ materials = [], onChange }) {
  const input = useRef(null);
  const operation = useRef(null);
  const replacement = useRef(null);
  const latest = useRef(materials);
  latest.current = materials;
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const descriptionId = useId();
  useEffect(() => () => operation.current?.abort(), []);

  function cancel() {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setStatus('Import cancelled.');
  }

  async function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const snapshot = latest.current;
    const replaceId = replacement.current;
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const result = await extractMeetingMaterial(file, {
        signal: controller.signal,
        onProgress: message => { if (operation.current === controller) setStatus(message); },
      });
      if (controller.signal.aborted || operation.current !== controller) return;
      if (latest.current !== snapshot) throw new Error('Meeting materials changed during import. Select the file again.');
      onChange(addMeetingMaterial(snapshot, result.material, replaceId));
      setWarning(result.warning || '');
      setStatus(`${file.name} added as background context.`);
    } catch (cause) {
      if (!controller.signal.aborted && operation.current === controller) {
        setError(cause.message || 'The file could not be read. Try a text export.');
        setStatus('');
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  function choose(replaceId = null) {
    replacement.current = replaceId;
    input.current.click();
  }

  return <section aria-label="Supporting materials" className="meeting-materials">
    <h2>Supporting materials</h2>
    <p id={descriptionId}>Add PDF, PPTX or UTF-8 TXT background context (10 MB and 50 pages per file; 3 files maximum).
      Text is held in this tab until reset or reload. Extracted text is sent to your configured AI provider; Gemini sends it to Google, while local Ollama processes it locally.
      Images, charts and slide speaker notes are not read.</p>
    <input ref={input} type="file" accept=".pdf,.pptx,.txt" aria-label="Choose supporting material"
      aria-describedby={descriptionId} onChange={selectFile} hidden />
    <button type="button" onClick={() => choose()} disabled={busy || materials.length >= 3}>Add material</button>
    {busy && <button type="button" onClick={cancel}>Cancel import</button>}
    <p role="status" aria-live="polite">{status}</p>
    {error && <p role="alert">{error}</p>}
    {warning && <p role="status">{warning}</p>}
    <ul>{materials.map(material => <li key={material.id}>
      <strong>{material.name}</strong> — {material.pages.length} readable page(s) or slide(s)
      {' '}<button type="button" onClick={() => choose(material.id)} disabled={busy} aria-label={`Replace ${material.name}`}>Replace</button>
      {' '}<button type="button" onClick={() => { cancel(); onChange(materials.filter(item => item.id !== material.id)); setStatus(`${material.name} removed from context.`); }}
        aria-label={`Remove ${material.name}`}>Remove</button>
      <details><summary>Review extracted text from {material.name}</summary>
        {material.pages.map(page => <section key={page.page}><h3>Page / slide {page.page}</h3><p>{page.text}</p></section>)}
      </details>
    </li>)}</ul>
  </section>;
}
