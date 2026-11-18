import React from 'react';

type Props = {
  recording: { url: string; duration: number } | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export default function RecordingPlayer({ recording, audioRef }: Props) {
  return <section aria-label="Meeting recording" id="help-recording" tabIndex={-1} className="recording-card">
    <span className="eyebrow">Revisit the conversation</span>
    <h2>Meeting recording</h2>
    {!recording ? <p>Your recording will be ready here after you stop. Select a transcript timestamp to jump to that moment.</p> : <>
    <audio ref={audioRef} src={recording.url} controls preload="metadata" aria-label="Play meeting recording" />
    <p><a href={recording.url} download="micaws-meeting.wav">Download recording (WAV)</a></p>
    <p>Saved in this page only. Download before resetting or closing the page. Pauses between recordings are omitted.</p>
    </>}
  </section>;
}
