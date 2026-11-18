import React, { useEffect, useRef, useState } from "react";
import { formatTime } from "../shared/formatTime.js";

import type { SavedSegment } from "../shared/savedMeeting.js";

export default function TranscriptCorrection({ segment, disabled, onSave }: {
  segment: SavedSegment; disabled: boolean; onSave: (segment: SavedSegment) => void;
}) {
  const [text, setText] = useState(segment.text);
  const [speaker, setSpeaker] = useState(segment.speaker || "");
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const changed =
    text.trim() &&
    (text !== segment.text || speaker !== (segment.speaker || ""));
  useEffect(() => {
    if (disabled || !changed) return;
    const timer = setTimeout(
      () =>
        saveRef.current({
          ...segment,
          revision: segment.revision + 1,
          text,
          speaker: speaker || null,
        }),
      1000,
    );
    return () => clearTimeout(timer);
  }, [text, speaker, segment, changed, disabled]);
  return (
    <div className="transcript-correction">
      <label>
        {formatTime(segment.time)} · revision {segment.revision}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          maxLength={2000}
        />
      </label>
      <label>
        Speaker
        <input
          value={speaker}
          onChange={(e) => setSpeaker(e.target.value)}
          disabled={disabled}
          maxLength={160}
        />
      </label>
      <small role="status">
        {changed ? "Autosaves after a short pause…" : "Saved"}
      </small>
    </div>
  );
}
