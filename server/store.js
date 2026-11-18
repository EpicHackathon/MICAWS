import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { applyCommand, fail, newMeeting } from "../src/shared/savedMeeting.js";
import { isDeepStrictEqual } from "node:util";

export class MeetingStore {
  constructor(pool, { retentionDays = 30 } = {}) {
    this.pool = pool;
    this.retentionDays = retentionDays;
  }
  async migrate() {
    await this.pool.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
  }
  async transaction(fn) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async get(org, id, db = this.pool, lock = false) {
    const result = await db.query(
      `SELECT document FROM meetings WHERE org=$1 AND id=$2 AND expires_at > now()${lock ? " FOR UPDATE" : ""}`,
      [org, id],
    );
    if (!result.rows.length) fail(404, "Meeting not found or expired.");
    return result.rows[0].document;
  }
  async list(org) {
    const { rows } = await this.pool.query(
      "SELECT document,updated_at FROM meetings WHERE org=$1 AND expires_at > now() ORDER BY updated_at DESC LIMIT 200",
      [org],
    );
    return rows.map(({ document: m, updated_at }) => ({
      id: m.id,
      title: m.title,
      series: m.series,
      status: m.status,
      revision: m.revision,
      updatedAt: updated_at,
      decisions: m.decisions,
      tasks: m.state.actionItems.map((t) => ({
        ...t,
        status: m.taskStatus[t.id] || "open",
      })),
    }));
  }
  async create(org, input) {
    const m = newMeeting(input);
    const expires = new Date(Date.now() + this.retentionDays * 86400000);
    await this.pool.query(
      "INSERT INTO meetings(org,id,document,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(org,id) DO NOTHING",
      [org, m.id, JSON.stringify(m), expires],
    );
    return this.get(org, m.id);
  }
  async write(db, org, m) {
    await db.query(
      "UPDATE meetings SET document=$3,revision=$4,updated_at=now() WHERE org=$1 AND id=$2",
      [org, m.id, JSON.stringify(m), m.revision],
    );
    await db.query(
      "INSERT INTO meeting_events(org,meeting_id,revision) VALUES($1,$2,$3)",
      [org, m.id, m.revision],
    );
  }
  async command(org, id, revision, command, key) {
    return this.transaction(async (db) => {
      const m = await this.get(org, id, db, true);
      const digest = createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex");
      if (key) {
        const receipt = (
          await db.query(
            "SELECT digest FROM command_receipts WHERE org=$1 AND meeting_id=$2 AND key=$3",
            [org, id, key],
          )
        ).rows[0];
        if (receipt) {
          if (receipt.digest !== digest)
            fail(
              409,
              "Idempotency key was already used for a different change.",
            );
          return m;
        }
      }
      if (m.revision !== revision)
        fail(
          409,
          "Meeting changed. Refresh and review your draft before saving again.",
        );
      const result = applyCommand(m, command);
      if (result.changed) await this.write(db, org, result.meeting);
      if (result.reprocess)
        await db.query(
          "INSERT INTO jobs(org,meeting_id) VALUES($1,$2) ON CONFLICT(org,meeting_id) DO UPDATE SET attempts=0,available_at=now()",
          [org, id],
        );
      if (key)
        await db.query(
          "INSERT INTO command_receipts(org,meeting_id,key,digest) VALUES($1,$2,$3,$4)",
          [org, id, key, digest],
        );
      return result.meeting;
    });
  }
  async remove(org, id) {
    return this.transaction(async (db) => {
      const m = await this.get(org, id, db, true);
      if (m.recording)
        await db.query(
          "INSERT INTO object_cleanup(key) VALUES($1) ON CONFLICT DO NOTHING",
          [m.recording.key],
        );
      await db.query("DELETE FROM meetings WHERE org=$1 AND id=$2", [org, id]);
    });
  }
  async setRecording(org, id, revision, recording) {
    return this.transaction(async (db) => {
      const m = await this.get(org, id, db, true);
      if (m.revision !== revision)
        fail(409, "Meeting changed. Retry the recording upload.");
      if (m.recording)
        await db.query(
          "INSERT INTO object_cleanup(key) VALUES($1) ON CONFLICT DO NOTHING",
          [m.recording.key],
        );
      m.recording = recording;
      m.revision += 1;
      await this.write(db, org, m);
      await db.query("DELETE FROM object_cleanup WHERE key=$1", [
        recording.key,
      ]);
      return m;
    });
  }
  async events(org, id, after) {
    await this.get(org, id);
    return (
      await this.pool.query(
        "SELECT seq,revision FROM meeting_events WHERE org=$1 AND meeting_id=$2 AND seq>$3 ORDER BY seq LIMIT 100",
        [org, id, after],
      )
    ).rows;
  }
  async claim() {
    return this.transaction(async (db) => {
      const { rows } = await db.query(
        "SELECT * FROM jobs WHERE available_at <= now() AND (lease_until IS NULL OR lease_until < now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!rows.length) return null;
      const job = { ...rows[0], lease: randomUUID() };
      await db.query(
        "UPDATE jobs SET lease=$3,lease_until=now() + interval '5 minutes' WHERE org=$1 AND meeting_id=$2",
        [job.org, job.meeting_id, job.lease],
      );
      return job;
    });
  }
  async finish(job, snapshot, result, error) {
    return this.transaction(async (db) => {
      // Lock meetings before jobs, matching command() to avoid lock inversions.
      let m;
      try {
        m = await this.get(job.org, job.meeting_id, db, true);
      } catch (e) {
        if (e.status === 404) return;
        throw e;
      }
      const { rows } = await db.query(
        "SELECT * FROM jobs WHERE org=$1 AND meeting_id=$2 FOR UPDATE",
        [job.org, job.meeting_id],
      );
      if (rows[0]?.lease !== job.lease) return;
      // An append must not starve long-running inference. Accept a prefix result only
      // when no correction, manual edit, or setting change occurred in the meantime.
      const previous = typeof snapshot === "number" ? null : snapshot;
      const revision = previous ? previous.revision : snapshot;
      const appendOnly =
        previous &&
        previous.segments.every((s) =>
          m.segments.some((n) => isDeepStrictEqual(n, s)),
        ) &&
        [
          "state",
          "lockedIds",
          "lockedTaskIds",
          "deletedNodes",
          "deletedTaskIds",
          "outputLanguage",
          "translationLanguage",
          "decisions",
          "evidence",
          "lockedEvidenceTargets",
        ].every((key) => isDeepStrictEqual(m[key], previous[key]));
      if (m.revision !== revision && (!appendOnly || error)) {
        await db.query(
          "UPDATE jobs SET lease=NULL,lease_until=NULL,available_at=now() WHERE org=$1 AND meeting_id=$2",
          [job.org, job.meeting_id],
        );
        return;
      }
      if (error) {
        const attempts = rows[0].attempts + 1;
        m.processing = attempts >= 5 ? "failed" : "retrying";
        m.processingError =
          "Processing unavailable. Your input is saved; check provider configuration or retry.";
        if (attempts >= 5)
          await db.query("DELETE FROM jobs WHERE org=$1 AND meeting_id=$2", [
            job.org,
            job.meeting_id,
          ]);
        else
          await db.query(
            "UPDATE jobs SET lease=NULL,lease_until=NULL,attempts=$3,available_at=$4 WHERE org=$1 AND meeting_id=$2",
            [
              job.org,
              job.meeting_id,
              attempts,
              new Date(Date.now() + Math.min(60000, 2000 * 2 ** attempts)),
            ],
          );
      } else {
        const caughtUp = !previous || m.inputVersion === previous.inputVersion;
        Object.assign(m, result, {
          processing: caughtUp ? "idle" : "queued",
          processingError: null,
          processedVersion: previous?.inputVersion ?? m.inputVersion,
        });
        if (caughtUp)
          await db.query("DELETE FROM jobs WHERE org=$1 AND meeting_id=$2", [
            job.org,
            job.meeting_id,
          ]);
        else
          await db.query(
            "UPDATE jobs SET lease=NULL,lease_until=NULL,attempts=0,available_at=now() WHERE org=$1 AND meeting_id=$2",
            [job.org, job.meeting_id],
          );
      }
      m.revision += 1;
      await this.write(db, job.org, m);
    });
  }
  async reserveCall(org, limit) {
    const { rows } = await this.pool.query(
      "INSERT INTO ai_usage(org,day,calls) VALUES($1,CURRENT_DATE,1) ON CONFLICT(org,day) DO UPDATE SET calls=ai_usage.calls+1 WHERE ai_usage.calls < $2 RETURNING calls",
      [org, limit],
    );
    if (!rows.length)
      fail(429, "Daily AI request budget reached. Input remains saved.");
  }
  async sweep(objects) {
    await this.transaction(async (db) => {
      const { rows } = await db.query(
        "SELECT document FROM meetings WHERE expires_at <= now() FOR UPDATE",
      );
      for (const { document: m } of rows)
        if (m.recording)
          await db.query(
            "INSERT INTO object_cleanup(key) VALUES($1) ON CONFLICT DO NOTHING",
            [m.recording.key],
          );
      await db.query("DELETE FROM meetings WHERE expires_at <= now()");
    });
    if (objects)
      for (const { key } of (
        await this.pool.query(
          "SELECT key FROM object_cleanup WHERE available_at <= now() LIMIT 50",
        )
      ).rows) {
        await objects.remove(key);
        await this.pool.query("DELETE FROM object_cleanup WHERE key=$1", [key]);
      }
  }
}
