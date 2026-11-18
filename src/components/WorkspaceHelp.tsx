import React from 'react';
import './workspaceHelp.css';

const shared = [
  ['Explore and edit the mind map', 'Topics are grouped into trees. Select a topic to explore it; use Tree, Linear, or Bubble to change the view. Turn on Edit to change topics or move them. Use Accessible outline and keyboard editing for a text-based alternative. Intentional edits are protected from automatic AI rewrites.'],
  ['Use the keyboard', 'Press Tab to move between controls and Enter or Space to open help sections and activate buttons. The accessible outline provides topic editing without dragging. Focus the divider beside the transcript and use the arrow keys to resize it.'],
];
const local = [
  ['Start a meeting', 'Choose Speech language, then select Start Recording and allow microphone access. Stop & Process Stream releases the microphone and finishes the last audio chunk. You can also expand typed input in the transcript panel and submit text without a microphone. Live speech needs the transcription server running.'],
  ['Understand the results', 'The transcript contains the recognized speech. The mind map groups the discussion into topics. Action items capture commitments, and the summary appears after recording stops and processing catches up. Review generated content before relying on it.'],
  ['Translate speech and results', 'Speech language tells the transcription service what language is being spoken; it does not translate speech. Translate transcript, beside the transcript, adds a translation while keeping the original. Output language, above the map, controls newly generated map and summary text. Translation requires a live AI provider and uses additional requests; mock mode does not translate.'],
  ['Add meeting materials', 'Use Meeting materials to attach PDF, PPTX, or TXT files as background context. You can preview, replace, or remove them. Limits are three files, 10 MB each; scanned pages and image-only slides need text extraction first. Extracted text is sent to your configured AI provider. Documents are context, not automatically agreed decisions or tasks.'],
  ['Listen again and keep your audio', 'After stopping, use the recording player or select a transcript timestamp to jump to that moment. Download the WAV if you need to keep it. This local page stores the meeting and audio only in memory: refreshing, closing it, or resetting loses them. Recordings stop at the storage limit of about 35 minutes.'],
  ['When something fails', 'Leave the page open to retain pending audio. Check the displayed error and whether the transcription service is running. Failed transcription and AI processing retry automatically. Reset session discards the current meeting and audio; it is not a repair button.'],
  ['Adjust the display', 'Use Neutral, Warm, Cool, or Dark at the top to change the theme. Hide transcript gives the map more space; Show transcript brings it back. Regenerate summary requests a fresh summary once processing has caught up.'],
  ['Local mode versus saved meetings', 'This page is the local recording workspace. Open saved meeting workspace launches a separate page that needs the saved-meeting server. Your current transcript, documents, and audio are not transferred automatically.'],
];
const saved = [
  ['Start here', 'Connect through your meeting company, or enter the short-lived workspace token it provides. Never enter a service API key. Choose a meeting from the library or enter a title and select New meeting. An embedded or read-only session may hide library or editing controls.'],
  ['Save, finish, and reopen', 'Map edits and submitted changes save to the server. Transcript corrections autosave one second after you stop typing; other forms have a Save button. Check the saving status before leaving. Finish meeting closes transcript editing and requests an update. Reopen meeting allows more transcript changes.'],
  ['Follow the evidence', 'Select Source beside a highlight or task, or select a map topic, to inspect its supporting transcript passage. With a recording loaded, a source link also jumps to that time. No current source attached means the item is manual or its old source was corrected. A matching quote does not guarantee that the AI interpretation is right.'],
  ['Correct the transcript', 'Expand Transcript corrections and edit a passage or speaker. Corrections refresh generated content and translations, and invalidate old evidence links. Intentional map edits and human-confirmed decisions stay protected; review those yourself if a correction changes their meaning. Reopen a finished meeting before correcting it.'],
  ['Search or ask a question', 'Search transcript finds passages containing your words. Ask this meeting produces an AI answer with source links, or says there is not enough evidence. It uses only this meeting, not the web or other meetings. Verify the cited words. Asking requires a live provider and editing access.'],
  ['Track decisions and tasks', 'AI classifications start as suggestions. Review them before selecting Confirm classification. You can record a confirmed decision, proposal, or open question yourself and attach a source. Mark questions resolved or reopen them. Set task progress to Open, In progress, or Done.'],
  ['Connect related meetings', 'Set the same Series / project in Meeting settings for related meetings. History shows their decisions, questions, and task progress. A new decision can explicitly replace an earlier confirmed decision in the series. A meeting-only embedded session cannot open the organization library. Use Refresh history to see recent changes.'],
  ['Languages and recordings', 'In Meeting settings, set Map and summary language and, optionally, Transcript translation language. Originals stay visible. Translation needs a live AI provider. If private recording storage is enabled, upload an aligned WAV up to 64 MiB; its time zero must match the transcript. Load private recording enables playback and timestamp seeking. This workspace receives partner transcripts; it does not record your microphone.'],
  ['Recover after a connection problem', 'Accepted changes stay saved on the server. Pending changes are encrypted on this device; reconnect to the same meeting after a refresh to recover them. Inspect Pending change, then retry or discard it. Conflicting edits are not overwritten automatically. Unsaved typing before autosave, unfinished forms, and recording uploads are not guaranteed to recover. If the session expires, reconnect through your meeting company.'],
  ['Export, disconnect, or delete', 'Export downloads meeting data as JSON, not the recording. Disconnect ends access in this page without deleting the saved meeting. Delete removes the meeting and schedules stored-recording cleanup; confirm only when you intend to remove it. Your organization controls retention and backups.'],
];

export default function WorkspaceHelp({ mode = 'local', demo = false }) {
  return <details className="workspace-help">
    <summary><span className="help-symbol" aria-hidden="true">?</span><span>How to use this workspace<span className="help-subtitle">Getting started, controls, and troubleshooting</span></span></summary>
    <div className="workspace-help-body">
      <p className="help-mode">{mode === 'saved' ? 'Saved meeting workspace' : 'Local recording workspace'}{demo ? ' · Synthetic demo' : ''}</p>
      {demo && <p className="help-notice"><strong>Trying the demo?</strong> Select Open sample workspace, then Launch planning. Try a source link, correct a passage, or update a task. Demo meetings disappear when the demo server stops. AI questions and translation are unavailable in mock mode.</p>}
      <p>Open a topic below when you need it. You can close this guide without interrupting your meeting.</p>
      <div className="help-topics">{[...(mode === 'saved' ? saved : local), ...shared].map(([title, text]) => <details key={title}><summary>{title}</summary><p>{text}</p></details>)}</div>
    </div>
  </details>;
}
