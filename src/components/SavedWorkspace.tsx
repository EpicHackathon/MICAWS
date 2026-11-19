import type { MeetingAnswer, MeetingListItem, SearchHit, WorkspaceSession } from "../../sdk/client.js";
import type { Citation, MeetingCommand, PendingChange, SavedDecision, SavedSegment, WorkspaceMeeting } from "../shared/savedMeeting.js";

type WorkspaceConfig = { embedOrigins: string[]; demo?: boolean; brand?: string; provider?: string; recordings: boolean };

import WorkspaceHelp from './WorkspaceHelp.tsx';
import React, { useEffect, useRef, useState } from "react";
import { createMicawsClient } from "../../sdk/client.js";
import { draftVault } from "../services/recoveryDraft.js";
import MeetingView from "./MeetingView.tsx";
import TranscriptCorrection from "./TranscriptCorrection.tsx";
import { formatTime } from "../shared/formatTime.js";
import "./savedWorkspace.css";

function References({ citations = [], onSelect }: { citations?: Citation[]; onSelect: (citation: Citation) => void }) {
  return (
    <span className="evidence-links">
      {citations.length ? (
        citations.map((c, i) => (
          <button
            type="button"
            key={`${c.segmentId}-${i}`}
            title={c.quote}
            onClick={() => onSelect(c)}
            aria-label={`View evidence: ${c.quote}`}
          >
            Source {i + 1}
          </button>
        ))
      ) : (
        <span className="muted">No current source attached</span>
      )}
    </span>
  );
}

export default function SavedWorkspace() {
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [token, setToken] = useState("");
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [connection, setConnection] = useState("Not connected");
  const [error, setError] = useState("");
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [meeting, setMeeting] = useState<WorkspaceMeeting | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PendingChange | null>(null);
  const [source, setSource] = useState<SavedSegment | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const vault = useRef<Awaited<ReturnType<typeof draftVault>> | null>(null);
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const client = React.useMemo(() => createMicawsClient({ token }), [token]);
  const editable = session?.role === "editor";

  useEffect(() => {
    fetch("/api/v1/config")
      .then((r) => {
        if (!r.ok)
          throw new Error(
            "Start the saved-meeting server to use this workspace.",
          );
        return r.json();
      })
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!config || window.parent === window) return;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        !config.embedOrigins.includes(event.origin)
      )
        return;
      if (
        event.data?.type === "micaws:session" &&
        typeof event.data.token === "string" &&
        event.data.token.length < 10000
      )
        setToken(event.data.token);
    };
    window.addEventListener("message", receive);
    for (const origin of config.embedOrigins)
      window.parent.postMessage({ type: "micaws:ready" }, origin);
    return () => window.removeEventListener("message", receive);
  }, [config]);

  async function open(id: string, api = client, identity = session) {
    const version = ++generation.current;
    setError("");
    setDraft(null);
    setMeeting(null);
    vault.current = null;
    active.current = id;
    setSource(null);
    setAnswer(null);
    setHits([]);
    setRecordingUrl("");
    try {
      const m = await api.get(id);
      let v = null;
      let recovered = null;
      if (identity?.role === "editor") {
        const { key } = await api.request<{ key: string }>(
          `/api/v1/meetings/${id}/recovery-key`,
        );
        v = await draftVault(key);
        recovered = await v.read(id);
      }
      if (version !== generation.current) return;
      vault.current = v;
      setMeeting(m);
      setDraft(recovered);
      try {
        sessionStorage.setItem(`micaws-last:${identity?.org}`, id);
      } catch {
        /* optional navigation recovery */
      }
    } catch (cause) {
      const e = cause instanceof Error ? cause : new Error(String(cause));
      if (version === generation.current) setError(e.message);
    }
  }
  useEffect(() => {
    const version = ++generation.current;
    active.current = null;
    setMeeting(null);
    setSession(null);
    setMeetings([]);
    setSaving(false);
    vault.current = null;
    if (!token) return;
    client
      .session()
      .then(async (identity) => {
        if (version !== generation.current) return;
        setSession(identity);
        setError("");
        if (identity.meetingId)
          await open(identity.meetingId, client, identity);
        else {
          const list = await client.list();
          if (version !== generation.current) return;
          setMeetings(list);
          let last;
          try {
            last = sessionStorage.getItem(`micaws-last:${identity.org}`);
          } catch {
            /* optional */
          }
          if (last && list.some((m) => m.id === last))
            await open(last, client, identity);
        }
      })
      .catch((e) => {
        if (version === generation.current) setError(e.message);
      });
    return () => {
      generation.current++;
    };
  }, [client]);
  useEffect(() => {
    if (!meeting || !session) return;
    const id = meeting.id;
    const controller = new AbortController();
    client.watch(
      id,
      async () => {
        const updated = await client.get(id);
        if (!controller.signal.aborted && active.current === id)
          setMeeting((current) =>
            !current || updated.revision >= current.revision
              ? updated
              : current,
          );
      },
      controller.signal,
      (status) => {
        if (controller.signal.aborted) return;
        setConnection(status);
        if (status.startsWith("Session expired")) {
          setToken("");
          setError(status);
          setMeeting(null);
          setRecordingUrl("");
          active.current = null;
          generation.current++;
        }
      },
    );
    return () => controller.abort();
  }, [meeting?.id, client, session]);
  useEffect(() => {
    setAnswer(null);
    setHits([]);
    setSource(null);
  }, [meeting?.inputVersion]);
  useEffect(
    () => () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    },
    [recordingUrl],
  );
  useEffect(() => {
    if (!draft && !saving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, saving]);

  async function send(command: MeetingCommand, recovery: PendingChange | null = null) {
    if (!editable || !meeting || savingRef.current || (draft && !recovery))
      return;
    const id = meeting.id;
    const version = generation.current;
    const v = vault.current;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const pending = recovery || {
      revision: meeting.revision,
      command,
      key: crypto.randomUUID(),
    };
    try {
      if (!v)
        throw new Error(
          "Secure draft recovery is unavailable. Reconnect before saving.",
        );
      await v.save(id, pending);
      setDraft(pending);
      let revision = pending.revision;
      if (recovery && pending.command.type === "segments")
        revision = (await client.get(id)).revision;
      const updated = await client.command(
        id,
        revision,
        pending.command,
        pending.key,
      );
      v.clear(id);
      if (version === generation.current) {
        setMeeting((current) =>
          current && current.revision > updated.revision ? current : updated,
        );
        setDraft(null);
      }
    } catch (cause) {
      const e = cause instanceof Error ? cause : new Error(String(cause));
      if (version === generation.current)
        setError(
          `${e.message} Your pending change is retained on this device.`,
        );
    } finally {
      savingRef.current = false;
      if (version === generation.current) setSaving(false);
    }
  }
  function selectCitation(c: Pick<Citation, "segmentId" | "revision">) {
    const segment = meeting?.segments.find(
      (s) => s.id === c.segmentId && s.revision === c.revision,
    );
    if (!segment) {
      setError("That source has changed. Refresh the evidence.");
      return;
    }
    setSource(segment);
    if (audio.current) {
      audio.current.currentTime = segment.time;
      audio.current.play().catch(() => {});
    }
    setTimeout(() => document.getElementById("source-inspector")?.focus(), 0);
  }
  async function run(fn: () => void | Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (cause) {
      const e = cause instanceof Error ? cause : new Error(String(cause));
      setError(e.message);
    }
  }
  const locked = !editable || saving || !!draft;
  const sameSeries = meetings.filter(
    (m) =>
      meeting &&
      m.id !== meeting.id &&
      meeting.series &&
      m.series === meeting.series,
  );

  return (
    <main className="saved-shell">
      <header id="help-account" tabIndex={-1} className="saved-header">
        <a className="brand" href="/workspace">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          {config?.brand || "MICAWS"}
        </a>
        <span className="saved-badge">Meeting library</span>
        <span role="status">{session ? connection : "Secure workspace"}</span>
        {session && (
          <button
            onClick={() => {
              setToken("");
              setDraft(null);
              setRecordingUrl("");
            }}
          >
            Disconnect
          </button>
        )}
      </header>
      <WorkspaceHelp mode="saved" demo={config?.demo} />
      {error && (
        <p role="alert" className="saved-alert">
          {error}
        </p>
      )}
      {!session ? (
        <section id="help-connect" tabIndex={-1} className="saved-welcome">
          <p className="eyebrow">Keep the conversation connected</p>
          <h1>Your meetings, with the evidence.</h1>
          <p>
            Reopen your work, trace a decision to its source, and carry progress
            into the next meeting.
          </p>
          {config?.demo && (
            <button
              onClick={() =>
                run(async () => {
                  const r = await fetch("/api/v1/demo-session");
                  if (!r.ok) throw new Error("Demo unavailable");
                  setToken((await r.json()).token);
                })
              }
            >
              Open sample workspace
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setToken(String(new FormData(e.currentTarget).get("session") ?? "").trim());
              e.currentTarget.reset();
            }}
          >
            <label>
              Short-lived workspace token
              <input
                name="session"
                type="password"
                autoComplete="off"
                required
                placeholder="Provided by your meeting company"
              />
            </label>
            <button disabled={!config}>Connect</button>
          </form>
          <p className="muted">
            Use a browser session token, never a service API key. Tokens are
            kept in memory. After a refresh, reconnect to recover saved meetings
            and encrypted pending edits.
          </p>
        </section>
      ) : (
        <>
          {!session.meetingId && (
            <section id="help-library" tabIndex={-1} className="saved-library" aria-label="Saved meetings">
              <div>
                <h1>Meeting library</h1>
                <p>Saved to your organization. Select a meeting to continue.</p>
              </div>
              <button
                onClick={() =>
                  run(async () => setMeetings(await client.list()))
                }
              >
                Refresh library
              </button>
              {editable && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    run(async () => {
                      const m = await client.create({
                        title: String(data.get("title") ?? ""),
                        series: String(data.get("series") ?? ""),
                      });
                      setMeetings(await client.list());
                      await open(m.id);
                    });
                  }}
                >
                  <label>
                    Meeting title
                    <input name="title" maxLength={200} required />
                  </label>
                  <label>
                    Series / project
                    <input
                      name="series"
                      maxLength={100}
                      placeholder="Optional, for related meetings"
                    />
                  </label>
                  <button disabled={saving || !!draft}>New meeting</button>
                </form>
              )}
              <nav className="meeting-tiles" aria-label="Choose meeting">
                {meetings.map((m) => (
                  <button
                    key={m.id}
                    disabled={saving || !!draft}
                    aria-current={meeting?.id === m.id ? "page" : undefined}
                    onClick={() => open(m.id)}
                  >
                    <strong>{m.title}</strong>
                    <span>
                      {m.series || "Independent meeting"} · {m.status}
                    </span>
                  </button>
                ))}
              </nav>
            </section>
          )}
          {meeting && (
            <>
              <section id="help-meeting" tabIndex={-1} className="saved-meeting-heading">
                <div>
                  <p className="eyebrow">
                    {meeting.series || "Meeting workspace"}
                  </p>
                  <h1>{meeting.title}</h1>
                  <p role="status">
                    {saving
                      ? "Saving…"
                      : draft
                        ? "Pending change retained on this device"
                        : `Saved · revision ${meeting.revision}`}{" "}
                    ·{" "}
                    {meeting.processing === "idle"
                      ? "Up to date"
                      : meeting.processing}
                  </p>
                  {meeting.processingError && (
                    <p role="alert">{meeting.processingError}</p>
                  )}
                  {config?.provider === "mock" && (
                    <p className="muted">
                      Mock mode: extractive examples only. AI questions and
                      translations are unavailable.
                    </p>
                  )}
                </div>
                <div className="saved-actions">
                  <button
                    disabled={locked}
                    onClick={() =>
                      send({
                        type: meeting.status === "open" ? "finish" : "reopen",
                      })
                    }
                  >
                    {meeting.status === "open"
                      ? "Finish meeting"
                      : "Reopen meeting"}
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => send({ type: "retry" })}
                  >
                    Reprocess
                  </button>
                  <button
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(meeting, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "meeting.json";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    Export
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Permanently delete this meeting and its stored recording?",
                        )
                      )
                        run(async () => {
                          await client.remove(meeting.id);
                          active.current = null;
                          generation.current++;
                          setMeeting(null);
                          setRecordingUrl("");
                          if (!session.meetingId)
                            setMeetings(await client.list());
                        });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </section>
              {draft && (
                <aside id="help-recovery" tabIndex={-1} className="saved-alert" aria-label="Recovered change">
                  <strong>Pending change</strong>
                  <p>
                    Review your retained change before retrying. Conflicting map
                    edits are never overwritten automatically.
                  </p>
                  <details>
                    <summary>View pending change</summary>
                    <pre>{JSON.stringify(draft.command, null, 2)}</pre>
                  </details>
                  <button
                    disabled={saving}
                    onClick={() => send(draft.command, draft)}
                  >
                    Retry retained change
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Discard this unsaved change? Saved meeting data stays intact.",
                        )
                      ) {
                        vault.current?.clear(meeting.id);
                        setDraft(null);
                      }
                    }}
                  >
                    Discard pending change
                  </button>
                </aside>
              )}
              <MeetingView
                hideSummary
                onSelectNode={(node) => {
                  const c = meeting.evidence[`node:${node.id}`]?.[0];
                  if (c) selectCitation(c);
                  else {
                    setSource(null);
                    setError(
                      "This topic has no current source attached. Add one in Map and task evidence.",
                    );
                  }
                }}
                taskEvidence={(task) => (
                  <References
                    citations={meeting.evidence[`task:${task.id}`]}
                    onSelect={selectCitation}
                  />
                )}
                state={meeting.state}
                onEdit={
                  locked
                    ? undefined
                    : (edit) => {
                        const next = edit(meeting.state);
                        send({ type: "edit", state: next });
                      }
                }
                segments={meeting.segments}
                pendingCount={meeting.processing === "idle" ? 0 : 1}
                summary={{ status: "idle", data: null, error: null }}
                onSeek={
                  recordingUrl
                    ? (time) => {
                        if (!audio.current) return;
                        audio.current.currentTime = time;
                        audio.current.play().catch(() => {});
                      }
                    : undefined
                }
                translations={meeting.segments.map(
                  (s) => meeting.translations[s.id]?.text || "",
                )}
                translationLanguage={meeting.translationLanguage}
                mapTools={
                  <span className="muted">Evidence and summaries below</span>
                }
                transcriptTools={
                  <p className="muted">
                    Original transcript is preserved. Edit passages in
                    “Transcript corrections” below.
                  </p>
                }
              />
              <div className="saved-grid">
                <section id="help-highlights" tabIndex={-1} className="saved-card">
                  <h2>Cited highlights</h2>
                  {meeting.summary.length ? (
                    meeting.summary.map((p, i) => (
                      <article key={i}>
                        <p>{p.text}</p>
                        <References
                          citations={p.citations}
                          onSelect={selectCitation}
                        />
                      </article>
                    ))
                  ) : (
                    <p>
                      Highlights appear after processing. Corrected transcripts
                      clear old highlights immediately.
                    </p>
                  )}
                  <details>
                    <summary>Map and task evidence</summary>
                    {[
                      ...meeting.state.nodes.map((n) => ({
                        id: `node:${n.id}`,
                        text: n.label,
                      })),
                      ...meeting.state.actionItems.map((t) => ({
                        id: `task:${t.id}`,
                        text: t.text,
                      })),
                    ].map((item) => (
                      <article key={item.id}>
                        <strong>{item.text}</strong>
                        <References
                          citations={meeting.evidence[item.id]}
                          onSelect={selectCitation}
                        />
                        {editable && (
                          <select
                            aria-label={`Attach source for ${item.text}`}
                            disabled={locked}
                            value=""
                            onChange={(e) => {
                              const s = meeting.segments.find(
                                (s) => s.id === e.target.value,
                              );
                              if (s)
                                send({
                                  type: "evidence",
                                  target: item.id,
                                  citations: [
                                    {
                                      segmentId: s.id,
                                      revision: s.revision,
                                      quote: s.text,
                                    },
                                  ],
                                });
                            }}
                          >
                            <option value="">Attach / replace source…</option>
                            {meeting.segments.map((s) => (
                              <option key={s.id} value={s.id}>
                                {formatTime(s.time)} {s.text.slice(0, 70)}
                              </option>
                            ))}
                          </select>
                        )}
                      </article>
                    ))}
                  </details>
                </section>
                <section id="help-search" tabIndex={-1} className="saved-card">
                  <h2>Search and ask</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const id = meeting.id;
                      run(async () => {
                        const result = await client.search(id, query);
                        if (active.current === id) setHits(result);
                      });
                    }}
                  >
                    <label>
                      Find something in this meeting
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        maxLength={1000}
                        required
                        placeholder="Why did we change the launch date?"
                      />
                    </label>
                    <div className="saved-actions">
                      <button>Search transcript</button>
                      <button
                        type="button"
                        disabled={
                          asking || !query.trim() || config?.provider === "mock"
                        }
                        onClick={() =>
                          run(async () => {
                            const id = meeting.id;
                            setAsking(true);
                            try {
                              const result = await client.ask(id, query);
                              if (active.current === id) setAnswer(result);
                            } finally {
                              setAsking(false);
                            }
                          })
                        }
                      >
                        {asking ? "Checking evidence…" : "Ask this meeting"}
                      </button>
                    </div>
                  </form>
                  {answer && (
                    <article aria-live="polite">
                      <p>{answer.answer}</p>
                      <References
                        citations={answer.citations}
                        onSelect={selectCitation}
                      />
                      <p className="muted">
                        AI answer. Verify its cited passages.
                      </p>
                    </article>
                  )}
                  {hits.map((s) => (
                    <article key={s.id}>
                      <p>{s.text}</p>
                      <References
                        citations={[
                          {
                            segmentId: s.id,
                            revision: s.revision,
                            quote: s.text,
                          },
                        ]}
                        onSelect={selectCitation}
                      />
                    </article>
                  ))}
                </section>
                <section
                  className="saved-card"
                  id="source-inspector"
                  tabIndex={-1}
                >
                  <h2>Source passage</h2>
                  {source ? (
                    <>
                      <p>
                        <strong>
                          {formatTime(source.time)} ·{" "}
                          {source.speaker || "Speaker not identified"}
                        </strong>
                      </p>
                      <blockquote>{source.text}</blockquote>
                      {recordingUrl && (
                        <button
                          onClick={() =>
                            selectCitation({
                              segmentId: source.id,
                              revision: source.revision,
                            })
                          }
                        >
                          Play this moment
                        </button>
                      )}
                    </>
                  ) : (
                    <p>
                      Select a source link to inspect the original words and
                      jump to the recording.
                    </p>
                  )}
                  {meeting.recording && !recordingUrl && (
                    <button
                      onClick={() =>
                        run(async () => {
                          const id = meeting.id;
                          const blob = await client.recording(id);
                          if (active.current === id)
                            setRecordingUrl(URL.createObjectURL(blob));
                        })
                      }
                    >
                      Load private recording
                    </button>
                  )}
                  {recordingUrl && (
                    <audio
                      ref={audio}
                      controls
                      src={recordingUrl}
                      aria-label="Saved meeting recording"
                    />
                  )}
                  {editable && config?.recordings && (
                    <label>
                      Upload aligned WAV recording (64 MiB maximum)
                      <input
                        type="file"
                        accept=".wav,audio/wav"
                        disabled={locked}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 64 * 1024 * 1024) {
                            setError("Recording exceeds 64 MiB.");
                            return;
                          }
                          run(async () => {
                            const id = meeting.id;
                            const updated = await client.uploadRecording(
                              id,
                              meeting.revision,
                              file,
                            );
                            if (active.current === id) {
                              setMeeting(updated);
                              setRecordingUrl("");
                            }
                          });
                        }}
                      />
                    </label>
                  )}
                  <p className="muted">
                    Recording time zero must match the transcript. Storage is
                    private; playback requires meeting access.
                  </p>
                </section>
                <section id="help-decisions" tabIndex={-1} className="saved-card">
                  <h2>Decisions and open questions</h2>
                  {meeting.decisions.map((d) => (
                    <article key={d.id}>
                      <span className="saved-badge">
                        {d.kind} ·{" "}
                        {d.confirmed ? "Human confirmed" : "AI suggestion"}
                      </span>
                      <p>{d.text}</p>
                      <References
                        citations={d.citations}
                        onSelect={selectCitation}
                      />
                      {!d.confirmed && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            send({
                              type: "decision",
                              decision: { ...d, confirmed: true },
                            })
                          }
                        >
                          Confirm classification
                        </button>
                      )}
                      {d.kind === "question" && d.confirmed && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            send({
                              type: "decision",
                              decision: { ...d, resolved: !d.resolved },
                            })
                          }
                        >
                          {d.resolved ? "Reopen question" : "Mark resolved"}
                        </button>
                      )}
                      {d.supersedes && (
                        <p className="muted">
                          Replaces decision from an earlier meeting
                        </p>
                      )}
                    </article>
                  ))}
                  {editable && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        const supersedes = String(data.get("supersedes") ?? "");
                        const s = meeting.segments.find(
                          (s) => s.id === data.get("source"),
                        );
                        send({
                          type: "decision",
                          decision: {
                            id: crypto.randomUUID(),
                            text: String(data.get("text") ?? ""),
                            kind: data.get("kind") as SavedDecision["kind"],
                            confirmed: true,
                            supersedes: supersedes
                              ? {
                                  meetingId: supersedes.split("/")[0],
                                  decisionId: supersedes.split("/")[1],
                                }
                              : null,
                            citations: s
                              ? [
                                  {
                                    segmentId: s.id,
                                    revision: s.revision,
                                    quote: s.text,
                                  },
                                ]
                              : [],
                          },
                        });
                      }}
                    >
                      <label>
                        Record a human-reviewed item
                        <textarea name="text" required maxLength={2000} />
                      </label>
                      <label>
                        Classification
                        <select name="kind">
                          <option value="decision">Confirmed decision</option>
                          <option value="proposal">Proposal</option>
                          <option value="question">Open question</option>
                        </select>
                      </label>
                      <label>
                        Source
                        <select name="source">
                          <option value="">
                            Manual entry (no transcript evidence)
                          </option>
                          {meeting.segments.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.text.slice(0, 90)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Replaces earlier decision
                        <select name="supersedes">
                          <option value="">Does not replace a decision</option>
                          {sameSeries.flatMap((m) =>
                            m.decisions
                              .filter(
                                (d) => d.confirmed && d.kind === "decision",
                              )
                              .map((d) => (
                                <option
                                  key={`${m.id}-${d.id}`}
                                  value={`${m.id}/${d.id}`}
                                >
                                  {m.title}: {d.text}
                                </option>
                              )),
                          )}
                        </select>
                      </label>
                      <button disabled={locked}>Save item</button>
                    </form>
                  )}
                </section>
              </div>
              <section id="help-progress" tabIndex={-1} className="saved-card">
                <h2>Task progress</h2>
                {meeting.state.actionItems.length ? (
                  meeting.state.actionItems.map((t) => (
                    <label key={t.id} className="task-progress">
                      <span>{t.text}</span>
                      <select
                        disabled={locked}
                        value={meeting.taskStatus[t.id] || "open"}
                        onChange={(e) =>
                          send({
                            type: "task",
                            id: t.id,
                            status: e.target.value as WorkspaceMeeting["taskStatus"][string],
                          })
                        }
                      >
                        <option value="open">Open</option>
                        <option value="doing">In progress</option>
                        <option value="done">Done</option>
                      </select>
                      <References
                        citations={meeting.evidence[`task:${t.id}`]}
                        onSelect={selectCitation}
                      />
                    </label>
                  ))
                ) : (
                  <p>No agreed tasks captured yet.</p>
                )}
              </section>
              {editable && (
                <section id="help-corrections" tabIndex={-1} className="saved-card">
                  <h2>Transcript corrections</h2>
                  <p>
                    Corrections trigger reassessment. Intentional map and task
                    edits stay protected. Pending changes are encrypted on this
                    device until saved.
                  </p>
                  <details>
                    <summary>
                      Review and correct passages ({meeting.segments.length})
                    </summary>
                    {meeting.segments.map((s) => (
                      <TranscriptCorrection
                        key={`${s.id}-${s.revision}`}
                        segment={s}
                        disabled={locked || meeting.status !== "open"}
                        onSave={(updated) =>
                          send({ type: "segments", segments: [updated] })
                        }
                      />
                    ))}
                  </details>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      const time = Number(data.get("time"));
                      send({
                        type: "segments",
                        segments: [
                          {
                            id: crypto.randomUUID(),
                            revision: 1,
                            time,
                            end: time,
                            text: String(data.get("text") ?? ""),
                            speaker: String(data.get("speaker") ?? "") || null,
                          },
                        ],
                      });
                    }}
                  >
                    <label>
                      Add transcript passage
                      <textarea name="text" required maxLength={2000} />
                    </label>
                    <div className="saved-actions">
                      <label>
                        Time (seconds)
                        <input
                          name="time"
                          type="number"
                          min="0"
                          max="7200"
                          step="0.01"
                          defaultValue="0"
                          required
                        />
                      </label>
                      <label>
                        Speaker
                        <input name="speaker" maxLength={160} />
                      </label>
                      <button disabled={locked || meeting.status !== "open"}>
                        Save passage
                      </button>
                    </div>
                  </form>
                </section>
              )}
              <section id="help-history" tabIndex={-1} className="saved-card">
                <h2>Related meeting history</h2>
                {session.meetingId ? (
                  <p>
                    This embedded session is limited to this meeting. Open your
                    organization workspace to view history.
                  </p>
                ) : !meeting.series ? (
                  <p>Set a series or project below to connect meetings.</p>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        run(async () => setMeetings(await client.list()))
                      }
                    >
                      Refresh history
                    </button>
                    {sameSeries.map((m) => (
                      <article key={m.id}>
                        <button
                          disabled={saving || !!draft}
                          onClick={() => open(m.id)}
                        >
                          {m.title}
                        </button>
                        <ul>
                          {m.decisions.map((d) => (
                            <li key={d.id}>
                              {d.kind}
                              {d.kind === "question"
                                ? d.resolved
                                  ? " (resolved)"
                                  : " (open)"
                                : ""}
                              : {d.text}
                              {d.supersedes
                                ? " (replaces an earlier decision)"
                                : ""}
                              {d.confirmed ? "" : " (unconfirmed)"}
                            </li>
                          ))}
                          {m.tasks.map((t) => (
                            <li key={t.id}>
                              Task · {t.status}: {t.text}
                            </li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </>
                )}
              </section>
              {editable && (
                <details id="help-settings" tabIndex={-1} className="saved-card">
                  <summary>Meeting settings</summary>
                  <form
                    key={`${meeting.id}-${meeting.outputLanguage}-${meeting.translationLanguage}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      send({
                        type: "metadata",
                        title: String(d.get("title") ?? ""),
                        series: String(d.get("series") ?? ""),
                        outputLanguage: String(d.get("language") ?? ""),
                        translationLanguage: String(d.get("translation") ?? ""),
                      });
                    }}
                  >
                    <label>
                      Title
                      <input
                        name="title"
                        defaultValue={meeting.title}
                        maxLength={200}
                        required
                      />
                    </label>
                    <label>
                      Series / project
                      <input
                        name="series"
                        defaultValue={meeting.series}
                        maxLength={100}
                      />
                    </label>
                    <label>
                      Map and summary language
                      <input
                        name="language"
                        defaultValue={meeting.outputLanguage}
                        maxLength={60}
                      />
                    </label>
                    <label>
                      Transcript translation language (blank for original)
                      <input
                        name="translation"
                        defaultValue={meeting.translationLanguage}
                        maxLength={60}
                      />
                    </label>
                    <button disabled={locked}>Save settings</button>
                  </form>
                </details>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
