# RepTrack — Phased Roadmap

Four phases. Each is shippable on its own. The hard architectural decisions live in Phase 1 so nothing has to be torn up later — especially the offline→networked seam that opens at Phase 3.

---

## Phase 1 — Single-user activity tracker (the foundation)

**Goal:** one person, gym + runs, progression tracking. Simple graphics, minimal input beyond what actually happens in a session.

- Session lifecycle (start/end, auto-duration), calendar diary (day/week/month/year).
- Set logging: reps, weight, RPE — by tap or by voice (one-shot on mic-tap, transcript only, audio discarded, must not interrupt music).
- **Runs/cardio:** log distance, duration, pace. Keep input light — a run is a few fields, not a form.
- Progression charts per exercise; PR flags; quiet "ready to add load" nudge.
- Fully offline, no account, IndexedDB, PWA, < 50 MB.

**Design-for-later (do this now, even though it's invisible):**
- Give every record a stable UUID and a `lastModified` timestamp — this is the hook future sync needs.
- Add a `visibility` field to Session/SetEntry now (`private` default) even though nothing reads it yet. Phase 3 flips it on; retrofitting it later means a data migration.
- Keep all storage access behind a single `store.js` module so Phase 3 can add a sync adapter without touching feature code.

---

## Phase 2 — Nutrition & bodyweight

**Goal:** add nutrition logging and bodyweight tracking, still single-user, still offline.

- Nutrition entries (kcal + macros, quick-add favourites). This is the reserved v2 slot from the Phase 1 data model — build it out now.
- Bodyweight log with a variance chart; overlay against training volume so trends are visible.
- Keep logging fast — a barcode/text quick-add beats a giant food database for a personal app. Consider an optional local food dictionary the user builds up, rather than shipping a huge DB (footprint discipline holds).

**Still no server.** Everything remains on-device.

---

## Phase 3 — Multi-user (the architectural fork)

**Goal:** compare gains with friends, mutual accountability on skip/cheat days.

> **This is where the app stops being purely offline.** Comparing with friends requires accounts, a backend, and data leaving the device. Everything in Phases 1–2 was built to make this a clean addition rather than a rewrite — that's why the UUIDs, timestamps, `visibility` field, and `store.js` seam exist.

- Accounts + a sync backend (see "Backend note" below).
- Small trusted circles ("crews"), **not** a public feed — the research is clear that public visibility drains as many people as it motivates. Friends-you-chose, not strangers.
- Compare progression and consistency within a crew; streaks with a **floor you can always hit** so a bad week doesn't nuke the chain.
- **Opt-out is a first-class control, not buried:** per-category sharing toggles (workouts separately from nutrition), and a one-tap **"Holiday / pause sharing"** mode that cleanly stops sharing without leaving the crew or losing your own data. Make this prominent and reversible.
- Accountability tone: a miss triggers a **nudge, not a trial.** No shaming mechanics anywhere — shame makes people hide and quit. Bake this into copy and notification design.

**Backend note:** keep the on-device store as source of truth and sync deltas up; the backend stores only what a user has explicitly shared. Minimise what leaves the device by design — it's cheaper, more private, and easier to make compliant.

---

## Phase 4 — Finalised, secured, social polish

**Goal:** production-ready, secure, with light social warmth and safety rails.

- **Auth & security:** password/passcode protection on the app; proper account auth on the backend; encryption in transit and at rest; a security-compliance pass (see checklist below).
- **Invites:** invite others to your crew (link/code based).
- **Light chat:** emoji reactions + a *limited* chat scoped to cheering crew-mates on. Keep it deliberately small — reactions and short messages, not a full messenger — to avoid moderation and abuse surface.
- **Steps / background activity:** integrate step count (via Health Connect on Android). For a long walk that should count, offer an explicit **"add this walk to today's total" button** rather than silent always-on background tracking — user-initiated, battery-friendly, privacy-respecting.
- **Activity-level nudges (handle with care):**
  - *Under-activity:* gentle, dismissible "want to get a session in this week?" — low risk, fine.
  - *Over-activity:* a **soft, non-diagnostic, fully dismissible** prompt at most — e.g. "you've trained hard several days running; rest days are part of progress." It must never diagnose, never set or police targets, never shame, and must be switch-off-able entirely in settings. This feature errs toward saying less. It is a gentle flag that steps back, not a monitor.

---

## Later build — class & PT attendance (spec; schema reserved, nothing built)

The data hook already exists so this needs no migration: every `Session` carries
`sessionType` (`gym | run | class | pt`, default `gym`) and the optional, currently
unused `className`, `instructor`, `location` and `attendance`
(`attended | missed | cancelled`). Database version 2 stamped `gym` onto every session
recorded before the field existed. Nothing user-facing reads any of it yet.

When this is built:

- **Logging.** From Today, "Log a class" / "Log a PT session" opens the existing confirm
  sheet with: name (class name, or "PT"), instructor or trainer, location, duration, and
  attended / missed / cancelled. Same rule as everything else — nothing commits without
  that confirmation. Voice can come later via a new intent in `parser.js`.
- **Counting toward progress.** An *attended* class or PT session is a training day, so it
  counts toward `streakLevel` and `monthPercent` exactly as a gym session or run does —
  `consistency.trainingDays()` gains one filter (`attendance !== 'missed' && attendance
  !== 'cancelled'`) and nothing else in the metric changes.
- **A cancelled class is never a lapse.** Cancelled is something that happened *to* the
  user. It must not count as a training day, and it must not count against them either:
  frost, the glow and both metrics treat that date as if nothing were logged — never as a
  miss. A *missed* class is recorded for the user's own reference only and is equally
  invisible to every visual (the activity visuals never speak — see `CLAUDE.md`).
- **Weekly summary.** `summary.js` gains an "Attendance" block: classes and PT sessions
  attended this week, by name, with duration. Missed and cancelled are listed only if the
  user turns that on, and are never totalled into a "missed N" line.
- **Diary.** Class/PT sessions appear on the calendar like any other session, with the
  class name in place of the exercise list.

## Security & compliance checklist (Phase 4 gate)

- [ ] Auth with hashed+salted credentials; no plaintext secrets; secure session tokens.
- [ ] TLS in transit; encryption at rest for shared data.
- [ ] Principle of least data: backend stores only explicitly-shared content.
- [ ] Per-category sharing consent + holiday pause, both tested.
- [ ] Full data export and account/data deletion ("right to be forgotten") paths.
- [ ] Clear privacy policy covering what's shared, with whom, and how to stop.
- [ ] Chat: rate-limited, reportable, crew-scoped; basic abuse handling.
- [ ] Dependency/security audit; no known-vuln packages.
- [ ] If it ever hits an app store, meet Google Play data-safety disclosure requirements.

---

## Market comparison — features to consider for later builds

From current top accountability/social trackers (Strava, Hevy, Strong, Fitbod, Jefit, GymRats, Stridekick, Habit Huddle, MyFitnessPal):

**Worth including:**
- **Crew challenges** with flexible scoring (count / minutes / miles / volume) — GymRats' model.
- **Visible daily check-in** as the accountability unit — one tap, everyone sees it (lighter weight than sharing full workout data).
- **Streaks with a hittable floor** so bad weeks survive.
- **Wearable/tracker sync** (Health Connect, Apple Health, Garmin, Fitbit) so mixed-device crews can compare — Stridekick's key advantage.
- **Milestone badges / shout-outs** for dopamine-positive reinforcement (kept warm, not competitive-toxic).
- **Kudos/reactions** rather than open comments, to keep tone supportive.
- **Programme templates** (5/3/1, nSuns, GZCLP) if you ever want guided progression — Boostcamp/Jefit territory.
- **Plate calculator & rest timer** — small, high-value logging aids (Hevy/Strong).
- **Estimated 1RM tracking** and volume-over-time analytics.

**Deliberately skip / defer:**
- Public global feeds and stranger leaderboards — high drain, moderation burden.
- Huge bundled food databases — footprint killer; prefer user-built local dictionary.
- Commitment-contract money stakes (StickK model) — heavy, off-brand for a friends tracker.
- Full messaging — scope creep + moderation liability; the limited cheer-chat is the right ceiling.

---

## One cross-cutting principle

The healthiest accountability design the research converges on: **the group's job when someone misses is a nudge, not a trial.** Shame produces hiding; hiding kills groups. Every social and reminder feature in Phases 3–4 should be measured against that.
