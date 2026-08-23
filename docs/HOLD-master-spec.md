# HOLD — master build spec

**The revenue recovery agent that knows when *not* to act.**

Track 03 · AI Revenue Recovery
Version 1.0 · Complete build specification

---

## 0. Read this first

This document is written so that you can build the entire frontend without a backend existing, and then hand sections 5–8 to Claude Code and get a working backend that plugs in with zero refactoring.

The single most important instruction in this whole document:

> **Build the frontend against the exact API contract in section 8, served by Mock Service Worker. When the real backend arrives, you delete one line that enables the mock worker. Nothing else changes.**

If you deviate from the contract while building the frontend, you will spend your last four hours reconciling shapes instead of rehearsing your demo. Teams lose hackathons this way constantly.

---

## 1. The thesis

### 1.1 What we are building

Every revenue recovery product on the market optimises one number: **recovery rate**. Percentage of failed payments that eventually convert.

That number is a lie, and here is why.

If a customer abandons their cart and would have come back on their own in four hours, and you send them a 10% discount code, your dashboard records a recovery. What actually happened is that you paid ₹340 for a sale you were already going to get. You did not recover revenue. You destroyed margin and recorded it as a win.

The correct objective is **incremental net profit**: money that would not have arrived without you, minus what it cost you to get it, minus what your intervention will cost you in the future.

Once you optimise that instead, something interesting happens. **Doing nothing becomes a real strategy** — often the winning one. And an agent whose most common decision is "hold, this one recovers itself" is a fundamentally different product from every dunning tool on the market.

### 1.2 The three things that make this win

**1. HOLD is a first-class action.** The agent computes an expected value for doing nothing, and acts only when some intervention beats it by a confidence margin. Restraint is measured, logged, and displayed as its own metric: *margin protected*.

**2. Discount farming defense.** If you always send 10% off after abandonment, customers learn the pattern and abandon deliberately. Your recovery system quietly becomes a permanent coupon. HOLD tracks behavioural signatures per customer and withdraws incentive-based actions from anyone who has learned to game them. Almost nobody at a hackathon thinks one move ahead like this.

**3. Honest measurement.** Uplift modelling with a proper holdout, Qini curve, and a simulator whose assumptions the judges can change live. An agent that only wins on your chosen parameters is not credible. One that wins across a swept range is.

### 1.3 The name

**HOLD.** Four letters, and it is your entire thesis. It reads as a trading term, which suits the aesthetic, and it names the signature action of the product.

Alternates if it is taken or clashes: **Netback**, **Withheld**, **Ledger Zero**.

### 1.4 The one-sentence pitch

> "Every recovery tool asks *can we win this back*. HOLD asks *is winning it back worth what it costs* — and about a third of the time, the answer is no."

---

## 2. Product decisions

### 2.1 Web app or mobile app?

**Web application. Desktop-first. Not responsive-first, not a mobile app.**

Reasoning, in order of weight:

1. **The user is a revenue operations analyst at a desk.** They are watching a batch of 5,000 payment failures process. This is a dense, multi-pane, information-heavy job. It is a terminal, not a phone screen.
2. **The demo is on a projector.** You need one screen that fills a 16:9 frame with movement and numbers. A mobile layout wastes 60% of that frame.
3. **Nobody's phone is the right place for a ₹47L decision.**

Build for 1440×900 as the design target. Add a *graceful* tablet breakpoint at 1024px so that resizing during the demo does not shatter the layout. Below 768px, show a polite "HOLD is built for a wider screen" card rather than a broken layout — that is a deliberate product statement, not a failure, and takes ten minutes.

### 2.2 Is it a SaaS product, an internal tool, or an agent?

Frame it as **an agent with a cockpit**. This matters for the demo narrative. The agent runs autonomously; the UI is where a human supervises it, audits it, and adjusts its leash. Every screen should feel like you are watching something work, not operating a form.

### 2.3 What we deliberately do NOT build

Write this list on your whiteboard and defend it. Judges respect scope discipline, and every one of these is a trap that has eaten a hackathon team before.

- No authentication. No login screen. Single-tenant, single-user. (If asked: "auth is a solved problem and worth zero points.")
- No real payment gateway integration. Simulated, and we are loud and honest about it.
- No actual outbound WhatsApp/SMS/email. Every message is composed for real by the LLM and rendered in a preview pane, then logged. Sending is a stubbed adapter.
- No multi-tenant, no roles, no permissions, no billing.
- No B2B invoice collections and no voice. Two verticals only: **failed subscription renewals** and **checkout abandonment**. Depth over breadth.
- No mobile app.

### 2.4 Scope: the two verticals

| Vertical | Trigger | Recoverable value | Why included |
|---|---|---|---|
| **Failed subscription renewal** | Card decline or UPI mandate failure on renewal day | MRR × expected remaining lifetime | Rich decline-code taxonomy, real retry-timing strategy, ML has real signal |
| **Checkout abandonment** | Payment initiated, no terminal state after 30 min | Cart value | Where the do-nothing insight is most dramatic and most counterintuitive |

Both flow through the same abstraction (section 5.3), so the second one costs you roughly 15% extra work, not 100%.

---

## 3. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SIMULATED WORLD  (the fake company, written by you)        │
│  · customer population generator                            │
│  · event generator: carts, renewals, declines               │
│  · response oracle: decides if an action actually works     │
│  · adversarial knobs exposed to judges                      │
└──────────────────────┬──────────────────────────────────────┘
                       │  writes rows
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  EVENT STORE  (Postgres — "the company's backend")          │
└──────────────────────┬──────────────────────────────────────┘
                       │  SWEEP: poll every N sim-minutes
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  THE AGENT LOOP                                             │
│                                                             │
│  DETECT ──▶ DIAGNOSE ──▶ SCORE ──▶ DECIDE ──▶ ACT ──▶ VERIFY│
│              (LLM +      (ML:      (EV max,   (bounded,     │
│               rules)      uplift)   incl HOLD) guardrailed) │
│                                                             │
│  every arrow writes an immutable audit entry                │
└──────────────────────┬──────────────────────────────────────┘
                       │  SSE stream
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  COCKPIT  (React frontend — what you build first)           │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 The six stages, precisely

| Stage | Input | Output | Powered by |
|---|---|---|---|
| **Detect** | Raw event rows | `risk_event` with `value_at_risk` | SQL sweep query + timer thresholds |
| **Diagnose** | Risk event + customer history | `cause_code` + confidence + narrative | Deterministic classifier, LLM writes narrative |
| **Score** | Features | `p_baseline`, `p_recover[action]`, CIs | scikit-learn (calibrated) |
| **Decide** | Scores + costs + policy | Chosen action + full EV table | Expected-value maximiser + policy filter |
| **Act** | Chosen action | Message / retry / nothing | Bounded executors + LLM composer |
| **Verify** | Action + world response | Outcome + realised net profit | Response oracle + attribution logic |

### 3.2 The critical design rule

**The agent must be able to run in three modes over the identical event stream:**

- `baseline` — dumb industry-standard rules (retry 3×, blast 10% off after 1h)
- `agent` — the full HOLD pipeline
- `holdout` — deliberately do nothing at all

You need all three to prove uplift. The holdout arm is what makes your numbers real rather than self-congratulatory, and it is a 20-line addition. Do not skip it.

---

## 4. The decision engine (the heart)

Everything else in this project is scaffolding around this section. Get this right and the rest is presentation.

### 4.1 The action space

Six actions. Fixed. Do not add more — every extra action needs its own uplift model and its own arm of training data.

| ID | Action | Direct cost | Notes |
|---|---|---|---|
| `HOLD` | Do nothing | ₹0 | The baseline. EV defined as 0. |
| `RETRY_NOW` | Immediate payment retry | ₹2 (gateway fee) | Free-ish, but burns a mandate attempt |
| `RETRY_SCHEDULED` | Retry at a computed optimal time | ₹2 | Salary day, post-payday, next business day |
| `NUDGE_FREE` | Message with no incentive | ₹0.35 (WhatsApp) | Reminder, update-card link, one-tap resume |
| `NUDGE_INCENTIVE` | Message with a discount or fee waiver | ₹0.35 + incentive | The dangerous one. Farming exposure. |
| `ESCALATE_HUMAN` | Route to a person | ₹85 (5 min of agent time) | High-value or ambiguous cases only |

Each non-HOLD action carries parameters: retry timing, channel, language, tone, incentive size. Those are chosen *after* the action type, by a second-stage policy (section 4.6).

### 4.2 The expected value equation

For risk event `e` with recoverable value `V` and gross margin rate `m`, and candidate action `a`:

```
EV(a) = uplift(a) · V · m
      − direct_cost(a)
      − incentive_cost(a)
      − annoyance_cost(a)
      − farming_cost(a)
```

where

```
uplift(a)          = p_recover(a) − p_baseline
p_baseline         = P(recovers with no intervention)      ← ML model A
p_recover(a)       = P(recovers given action a)            ← ML model B (per arm)

incentive_cost(a)  = discount_fraction(a) · V              (only for NUDGE_INCENTIVE)
annoyance_cost(a)  = p_optout(a) · LTV_remaining · m       ← ML model C
farming_cost(a)    = farming_score(customer) · expected_future_leakage(a)
```

`EV(HOLD) ≡ 0` by construction — every other action is measured as a deviation from doing nothing. This is not a stylistic choice; it is the mathematical expression of the entire product thesis, and you should say exactly that sentence on stage.

### 4.3 The decision rule with restraint

```python
candidates = [(a, ev(a), ci_low(a), ci_high(a)) for a in ALLOWED_ACTIONS]
candidates = policy_filter(candidates, event, customer)   # hard guardrails first

best = max(candidates, key=lambda c: c.ev)

if best.ev <= 0:
    decide(HOLD, reason="no action beats doing nothing")

elif best.ci_low <= 0:
    # the confidence interval straddles zero — we are not sure
    if V >= AMBIGUITY_ESCALATION_THRESHOLD:      # ₹15,000 default
        decide(ESCALATE_HUMAN, reason="high value, uncertain uplift")
    else:
        decide(HOLD, reason="uplift not distinguishable from zero")

elif best.ev < TAU:                               # τ = ₹5 minimum edge
    decide(HOLD, reason="edge too thin to justify contact")

else:
    decide(best.action)
```

Three separate paths to HOLD. Each one is a different, defensible reason for restraint, and each renders differently in the UI. This is the detail that makes the product feel real rather than demo-shaped.

### 4.4 Where the LLM goes — and where it does NOT

Be ruthlessly honest about this on stage. It is a strength, not a weakness.

**The LLM does NOT choose the action.** Expected value arithmetic on calibrated probabilities does. If a judge asks "why is this an AI agent and not a spreadsheet," the answer is that the spreadsheet part is *deliberately* a spreadsheet, because that part should be auditable, deterministic and cheap. An LLM guessing at probabilities would be strictly worse and much harder to defend.

The LLM does five things that genuinely need language and judgment:

| # | Job | Why it needs an LLM |
|---|---|---|
| 1 | **Diagnosis narrative** | Turns a feature vector into "third failure this quarter, all on the 28th — this looks like a salary-timing problem, not a churn signal" |
| 2 | **Message composition** | Per-customer, per-language (English / Hinglish / Tamil), tone matched to relationship age and failure cause, under hard policy constraints |
| 3 | **Ambiguous-case adjudication** | When the CI straddles zero on a high-value case, the LLM receives structured context + the policy document and returns a recommendation with reasoning. Output is schema-validated and clamped to the allowed action set. |
| 4 | **Audit rationale** | Plain-English explanation of every decision, generated once at decision time and frozen into the immutable log |
| 5 | **Policy authoring** | Operator types "never contact anyone within 6 hours of a failed delivery" → structured rule proposal → human confirms |

**Model:** `claude-sonnet-4-6` for jobs 2, 3, 5. `claude-haiku-4-5-20251001` for jobs 1 and 4 (high volume, low stakes) — you are generating narratives for hundreds of cases per run and cost/latency matters.

**Critical engineering note:** jobs 1 and 4 run on *every* case. At 500 cases per batch that is 1,000 LLM calls and your demo will crawl. Mitigations, in order:
- Generate narratives lazily — only when a case card is opened in the UI. The list view uses a templated one-liner.
- Cache by `(cause_code, decision, value_bucket, relationship_bucket)`. Roughly 40 distinct combinations cover 500 cases.
- Batch job 4 in groups of 20 at run completion.

### 4.5 Farming detection

A customer's `farming_score` ∈ [0,1] is a transparent weighted score. **Do not use a black-box model here** — you need to explain it in ten seconds on stage, and an operator needs to defend it if a customer complains.

| Signal | Weight | Description |
|---|---|---|
| `abandon_rate` | 0.25 | Abandoned carts ÷ initiated checkouts, last 90d |
| `post_incentive_conversion_rate` | 0.30 | Converts within 30 min of receiving an incentive |
| `incentive_dependency` | 0.20 | Fraction of their orders that used a recovery discount |
| `timing_regularity` | 0.15 | Low variance in abandon→convert interval (learned behaviour, not indecision) |
| `stage_consistency` | 0.10 | Always abandons at the same checkout step |

```
farming_score = Σ (normalised_signal × weight)
```

Thresholds:
- `< 0.35` — normal. All actions available.
- `0.35 – 0.65` — **watch**. `NUDGE_INCENTIVE` capped at half the standard discount.
- `> 0.65` — **flagged**. `NUDGE_INCENTIVE` removed from the action set entirely. `NUDGE_FREE` still allowed.

Requires a minimum of 8 observed checkouts before a score is assigned — otherwise a new customer's first abandonment looks like a 100% abandon rate. Say this on stage; it shows you thought about cold start.

**The demo moment:** show a customer whose farming score climbs across a run as they exploit the baseline system, and the exact case where HOLD cuts them off while the baseline keeps paying out. Show the cumulative rupee difference.

### 4.6 Second-stage parameter selection

Once the action *type* is chosen, pick parameters:

**Retry timing** (`RETRY_SCHEDULED`): a per-cause lookup, adjusted by customer history.
- `insufficient_funds` → next salary date (inferred from historical successful-payment day-of-month clustering), capped at +7 days
- `bank_downtime` → +4 hours
- `issuer_declined` / `do_not_honour` → +48h, different gateway route if available
- `expired_card` / `mandate_revoked` → **never retry**; only `NUDGE_FREE` with an update link

**Channel:** WhatsApp if opted in and phone verified, else email. Never both for the same event.

**Language:** customer's `preferred_language` field. Support `en`, `hinglish`, `ta`. Hinglish is a genuine differentiator for an Indian judging panel and the LLM handles it well — put a Hinglish message on screen during the demo.

**Incentive size:** the *minimum* that makes EV positive, not a flat 10%. Search over {0%, 5%, 8%, 12%} and take the smallest with `EV > τ`. This alone is worth mentioning — most systems have one discount and fire it at everyone.

---

## 5. The data model

### 5.1 Database choice

**PostgreSQL 16**, running in Docker locally.

- SQLite is tempting and would work, but you want `JSONB` for feature snapshots and decision traces, and proper concurrent writes while the sweep loop runs alongside API reads.
- Do not use Supabase or any hosted DB. Conference wifi has ended more demos than bad code has.
- Use SQLModel so that if Postgres fails on someone's laptop at 3am, you flip the connection string to SQLite and lose only JSONB indexing.

One `docker-compose.yml` with postgres + a volume. Nothing else.

### 5.2 Schema conventions

- Primary keys: `TEXT` ULIDs (sortable, human-readable in logs, no sequence contention). Prefix by type: `cus_`, `evt_`, `dec_`, `act_`.
- Every table gets `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Money is `INTEGER` **paise**, never floats. A field named `value_at_risk_paise` is impossible to misread. The frontend divides by 100 at the render boundary and only there.
- Time is doubled: `wall_time` (real clock) and `sim_time` (simulated clock). The whole point is compressing 30 days into 90 seconds, and mixing these up will cost you hours.
- Enums as `TEXT` with a CHECK constraint, not Postgres enum types — altering them mid-hackathon is painful.

### 5.3 The core abstraction

Both verticals produce the same shape:

```
customer ──< subscription ──< renewal_attempt ──┐
         │                                       ├──▶ risk_event ──▶ decision ──▶ action ──▶ outcome
         └─< checkout_session ────────────────────┘
```

`risk_event` is the join point. Everything downstream is vertical-agnostic. This is the single best structural decision in the project — it means adding a third vertical later is a day, not a week.

### 5.4 Tables

#### `customers`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `cus_...` |
| `display_name` | TEXT | Generated Indian names, realistic distribution |
| `email` | TEXT | |
| `phone` | TEXT | E.164, `+91...` |
| `city` | TEXT | Weighted to metro/tier-2 |
| `preferred_language` | TEXT | `en` \| `hinglish` \| `ta` |
| `whatsapp_opted_in` | BOOLEAN | |
| `email_opted_in` | BOOLEAN | |
| `signup_at` | TIMESTAMPTZ | |
| `segment` | TEXT | `new` \| `casual` \| `regular` \| `power` |
| `ltv_realised_paise` | INTEGER | Money actually collected to date |
| `ltv_expected_paise` | INTEGER | Model-projected remaining lifetime value |
| `gross_margin_bps` | INTEGER | Basis points. 2200 = 22%. Varies by segment. |
| `salary_day_of_month` | INTEGER NULL | Ground truth in sim; agent must *infer* it |
| `inferred_salary_day` | INTEGER NULL | What the agent worked out |
| `farming_score` | NUMERIC(4,3) | 0.000–1.000 |
| `farming_tier` | TEXT | `normal` \| `watch` \| `flagged` |
| `farming_signals` | JSONB | The five component scores, for the UI breakdown |
| `contactable_after` | TIMESTAMPTZ NULL | Cool-down enforcement |
| `hard_optout` | BOOLEAN | Permanent. Never contact. |
| `created_at` | TIMESTAMPTZ | |

#### `subscriptions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `sub_...` |
| `customer_id` | TEXT FK | |
| `plan_name` | TEXT | `basic` \| `plus` \| `pro` |
| `mrr_paise` | INTEGER | |
| `billing_day` | INTEGER | 1–28 |
| `mandate_type` | TEXT | `upi_autopay` \| `card` \| `nach` |
| `mandate_status` | TEXT | `active` \| `paused` \| `revoked` \| `expired` |
| `mandate_expires_at` | TIMESTAMPTZ NULL | |
| `consecutive_failures` | INTEGER | |
| `status` | TEXT | `active` \| `past_due` \| `cancelled` |
| `started_at` | TIMESTAMPTZ | |
| `cancelled_at` | TIMESTAMPTZ NULL | |

#### `checkout_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `cko_...` |
| `customer_id` | TEXT FK | |
| `cart_value_paise` | INTEGER | |
| `item_count` | INTEGER | |
| `category` | TEXT | `grocery` \| `electronics` \| `fashion` \| `pharmacy` |
| `delivery_fee_paise` | INTEGER | The fee-shock abandonment driver |
| `payment_method` | TEXT | `upi` \| `card` \| `netbanking` \| `cod` \| `wallet` |
| `stage` | TEXT | `cart` \| `address` \| `payment_selected` \| `payment_initiated` \| `paid` \| `abandoned` |
| `stage_entered_at` | TIMESTAMPTZ | Drives abandonment timer |
| `device` | TEXT | `android` \| `ios` \| `web` |
| `started_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ NULL | |

#### `payment_attempts`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `pay_...` |
| `customer_id` | TEXT FK | |
| `subscription_id` | TEXT FK NULL | |
| `checkout_session_id` | TEXT FK NULL | Exactly one of these two is set |
| `amount_paise` | INTEGER | |
| `method` | TEXT | |
| `gateway` | TEXT | `razorpay` \| `payu` \| `cashfree` |
| `issuer` | TEXT | `hdfc` \| `icici` \| `sbi` \| `axis` \| `kotak` |
| `status` | TEXT | `initiated` \| `success` \| `failed` \| `timeout` |
| `decline_code` | TEXT NULL | See taxonomy in 6.3 |
| `attempt_number` | INTEGER | 1-indexed within a risk event |
| `triggered_by` | TEXT | `scheduled` \| `agent_retry` \| `customer` |
| `attempted_at` | TIMESTAMPTZ | |

#### `risk_events` — the join point

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `evt_...` |
| `run_id` | TEXT FK | |
| `customer_id` | TEXT FK | |
| `kind` | TEXT | `failed_renewal` \| `abandoned_checkout` |
| `source_id` | TEXT | subscription_id or checkout_session_id |
| `value_at_risk_paise` | INTEGER | MRR × expected months, or cart value |
| `margin_rate_bps` | INTEGER | Copied from customer at detection time |
| `detected_at_sim` | TIMESTAMPTZ | |
| `detected_at_wall` | TIMESTAMPTZ | |
| `detection_rule` | TEXT | Which sweep query caught it — shown in UI |
| `cause_code` | TEXT NULL | Filled by diagnose |
| `cause_confidence` | NUMERIC(4,3) | |
| `cause_narrative` | TEXT NULL | LLM, lazy-generated |
| `status` | TEXT | `detected` \| `diagnosed` \| `scored` \| `decided` \| `acting` \| `resolved` \| `expired` |
| `arm` | TEXT | `agent` \| `baseline` \| `holdout` |
| `feature_snapshot` | JSONB | Exact features at scoring time — reproducibility |

#### `decisions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `dec_...` |
| `risk_event_id` | TEXT FK | |
| `chosen_action` | TEXT | One of the six |
| `chosen_params` | JSONB | timing, channel, language, incentive_bps |
| `reason_code` | TEXT | `positive_ev` \| `no_action_beats_hold` \| `uncertain_uplift` \| `edge_too_thin` \| `policy_blocked` \| `high_value_ambiguous` |
| `p_baseline` | NUMERIC(5,4) | |
| `best_ev_paise` | INTEGER | Can be negative |
| `best_ev_ci_low_paise` | INTEGER | |
| `best_ev_ci_high_paise` | INTEGER | |
| `hold_margin_protected_paise` | INTEGER | If HOLD: what we avoided spending. **The signature metric.** |
| `blocked_actions` | JSONB | `[{action, policy_id, policy_name}]` |
| `decided_by` | TEXT | `engine` \| `llm_adjudicator` \| `human_override` |
| `llm_rationale` | TEXT NULL | |
| `latency_ms` | INTEGER | |
| `decided_at_sim` | TIMESTAMPTZ | |

#### `decision_candidates` — one row per action considered

This table exists purely so the UI can render the full EV comparison. It is what turns "trust me" into "here is the arithmetic."

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `decision_id` | TEXT FK | |
| `action` | TEXT | |
| `p_recover` | NUMERIC(5,4) | |
| `uplift` | NUMERIC(5,4) | |
| `gross_gain_paise` | INTEGER | `uplift · V · m` |
| `direct_cost_paise` | INTEGER | |
| `incentive_cost_paise` | INTEGER | |
| `annoyance_cost_paise` | INTEGER | |
| `farming_cost_paise` | INTEGER | |
| `ev_paise` | INTEGER | |
| `ci_low_paise` | INTEGER | |
| `ci_high_paise` | INTEGER | |
| `allowed` | BOOLEAN | False if policy-filtered |
| `block_reason` | TEXT NULL | |
| `rank` | INTEGER | |

#### `actions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `act_...` |
| `decision_id` | TEXT FK | |
| `risk_event_id` | TEXT FK | Denormalised for query speed |
| `type` | TEXT | |
| `params` | JSONB | |
| `scheduled_for_sim` | TIMESTAMPTZ | |
| `executed_at_sim` | TIMESTAMPTZ NULL | |
| `status` | TEXT | `scheduled` \| `executed` \| `cancelled` \| `blocked` |
| `cancel_reason` | TEXT NULL | e.g. customer self-recovered before the scheduled retry |
| `cost_paise` | INTEGER | Realised cost |

#### `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `msg_...` |
| `action_id` | TEXT FK | |
| `channel` | TEXT | `whatsapp` \| `email` \| `sms` |
| `language` | TEXT | |
| `body` | TEXT | LLM-composed, real text |
| `incentive_bps` | INTEGER | 0 for free nudges |
| `tone` | TEXT | `warm` \| `neutral` \| `urgent` |
| `policy_checks_passed` | JSONB | `[{rule, passed}]` |
| `sent_at_sim` | TIMESTAMPTZ NULL | |
| `opened` | BOOLEAN | Simulated |
| `clicked` | BOOLEAN | Simulated |

#### `outcomes`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `risk_event_id` | TEXT FK UNIQUE | |
| `resolved` | BOOLEAN | Did the money arrive? |
| `resolution_path` | TEXT | `self_recovered` \| `agent_recovered` \| `lost` \| `expired` |
| `recovered_paise` | INTEGER | |
| `total_cost_paise` | INTEGER | Sum of all action costs |
| `net_profit_paise` | INTEGER | The number that matters |
| `counterfactual_recovered_paise` | INTEGER | What the oracle says would have happened under HOLD — sim-only ground truth |
| `incremental_profit_paise` | INTEGER | `net_profit − counterfactual · m`. **The scoreboard number.** |
| `customer_opted_out` | BOOLEAN | |
| `resolved_at_sim` | TIMESTAMPTZ | |

#### `policies`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `pol_...` |
| `name` | TEXT | Human-readable, shown in UI |
| `kind` | TEXT | `hard_block` \| `cap` \| `require_approval` |
| `rule` | JSONB | Structured predicate (see 9.2) |
| `applies_to` | JSONB | Action types this constrains |
| `enabled` | BOOLEAN | Toggleable live in the demo |
| `authored_by` | TEXT | `system` \| `operator` \| `llm_proposal` |
| `trigger_count` | INTEGER | Incremented on every block — shown as a badge |

#### `audit_entries`

Append-only. Never updated, never deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `run_id` | TEXT FK | |
| `risk_event_id` | TEXT FK NULL | |
| `customer_id` | TEXT FK NULL | |
| `stage` | TEXT | `detect` \| `diagnose` \| `score` \| `decide` \| `act` \| `verify` \| `policy` \| `override` |
| `summary` | TEXT | One line, plain English |
| `detail` | JSONB | Full structured payload |
| `actor` | TEXT | `engine` \| `llm` \| `human` \| `simulator` |
| `sim_time` | TIMESTAMPTZ | |
| `wall_time` | TIMESTAMPTZ | |
| `prev_hash` | TEXT | SHA-256 of previous entry |
| `hash` | TEXT | SHA-256 of this entry + prev_hash |

The hash chain takes 15 minutes to implement and lets you say "the audit log is tamper-evident" — worth far more than 15 minutes of anything else you could build.

#### `runs`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `run_...` |
| `world_config_id` | TEXT FK | |
| `arms` | JSONB | `["agent","baseline","holdout"]` |
| `population_size` | INTEGER | |
| `sim_days` | INTEGER | |
| `status` | TEXT | `pending` \| `running` \| `paused` \| `completed` \| `failed` |
| `seed` | INTEGER | **Reproducibility. Critical.** |
| `started_at` / `completed_at` | TIMESTAMPTZ | |
| `summary` | JSONB | Cached final metrics |

#### `world_configs`

The adversarial knobs. See section 6.4 for the full parameter list.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT | `default` \| `pessimistic` \| `judge_custom` |
| `params` | JSONB | All simulator parameters |
| `created_at` | TIMESTAMPTZ | |

#### `model_versions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT | `p_baseline` \| `p_recover_nudge_free` \| ... |
| `algo` | TEXT | `hist_gradient_boosting` |
| `trained_at` | TIMESTAMPTZ | |
| `train_rows` | INTEGER | |
| `metrics` | JSONB | AUC, Brier score, calibration error, Qini |
| `feature_names` | JSONB | |
| `artifact_path` | TEXT | joblib file |

### 5.5 Indexes that matter

```sql
CREATE INDEX ON risk_events (run_id, status, arm);
CREATE INDEX ON risk_events (customer_id, detected_at_sim DESC);
CREATE INDEX ON checkout_sessions (stage, stage_entered_at);   -- the sweep query
CREATE INDEX ON payment_attempts (subscription_id, attempted_at DESC);
CREATE INDEX ON audit_entries (run_id, sim_time DESC);
CREATE INDEX ON decision_candidates (decision_id, rank);
```

The `checkout_sessions (stage, stage_entered_at)` index is the one that stops your sweep loop from table-scanning every five seconds. Without it, a 20,000-row run visibly stutters.

---

## 6. The simulator (your most underrated asset)

### 6.1 Why this decides whether you win

Your recovery numbers come from a world you wrote. A sharp judge will spot this within one question: *"Isn't your agent just winning because you told the simulator it should?"*

There is exactly one good answer, and it has to be built in advance:

> "Change the parameters yourself. Here's the panel. Every assumption in this world is a slider, and I'll re-run it live at whatever settings you like."

An agent that wins across a swept parameter range is a finding. An agent that wins at your chosen numbers is a coincidence. Build the sweep.

### 6.2 The population generator

Generate `N` customers with correlated, realistic attributes — not independent uniform draws, which produce a mush where no strategy beats any other.

Four behavioural archetypes, mixed:

| Archetype | Share | Behaviour |
|---|---|---|
| **Self-recoverer** | 30% | Abandons often, returns unprompted within 2–8h. Intervening on these is pure margin destruction. |
| **Genuinely stuck** | 35% | Real friction — expired card, mandate revoked, fee shock. Responds well to the *right* nudge, ignores the wrong one. |
| **Price sensitive** | 20% | Only converts with an incentive. Genuinely incremental, but expensive. |
| **Farmer** | 15% | Learns the system. Starts as a self-recoverer, then adapts: if incentives arrive reliably, abandon rate climbs over the run. |

The farmer archetype must **adapt during the run**, not be static. That is what makes the watchlist screen come alive: judges watch the score climb in real time as the baseline arm trains its own customers to abandon.

### 6.3 Decline code taxonomy

Realism here is cheap credibility. Use real Indian payment failure modes.

| Code | Share | Self-recovery rate | Best action | Notes |
|---|---|---|---|---|
| `insufficient_funds` | 31% | 0.22 | `RETRY_SCHEDULED` (salary day) | Timing is everything |
| `issuer_declined` | 18% | 0.15 | `RETRY_SCHEDULED` + reroute | Opaque bank refusal |
| `do_not_honour` | 12% | 0.11 | `NUDGE_FREE` | Retrying rarely helps |
| `expired_card` | 9% | 0.04 | `NUDGE_FREE` (update link) | **Retrying is always wrong** |
| `mandate_revoked` | 7% | 0.02 | `NUDGE_FREE` | Customer actively cancelled |
| `upi_timeout` | 11% | 0.58 | `HOLD` | Usually resolves itself |
| `bank_downtime` | 6% | 0.71 | `HOLD` or `RETRY_SCHEDULED` +4h | Transient |
| `risk_declined` | 4% | 0.08 | `ESCALATE_HUMAN` | Possible fraud flag |
| `card_limit_exceeded` | 2% | 0.19 | `RETRY_SCHEDULED` | |

The two high self-recovery codes (`upi_timeout`, `bank_downtime`) are 17% of volume and are where the baseline system burns money for nothing. That is your demo's best individual case.

### 6.4 The response oracle

When the agent takes action `a` on event `e`, the oracle decides what actually happens. This is ground truth, and the agent never sees it.

```
p_true_recover(e, a) = clamp(
      base_self_recovery[cause_code]
    × archetype_multiplier[archetype]
    × timing_multiplier(a, salary_day, sim_time)
    × channel_multiplier(a.channel, opted_in)
    × incentive_response(archetype, incentive_bps)
    × fatigue_penalty(messages_sent_last_7d)
    × relationship_multiplier(segment, tenure)
, 0.001, 0.98)
```

And separately, the counterfactual: run the same event under `HOLD` and record what would have happened. **Use the same random seed for both draws**, so the comparison is a true paired counterfactual and not two independent coin flips. This is the single subtlest and most important line of code in the simulator.

Also model side effects:
- `p_optout(a)` rises with message frequency and falls with relationship tenure
- Farmers update their `abandon_propensity` upward after each successful incentive extraction
- Message fatigue: the third message in 7 days is roughly 40% as effective as the first

### 6.5 Adversarial knobs (the judge panel)

Every one of these is a slider in the World screen, editable live, with an immediate re-run:

| Parameter | Default | Range | What it attacks |
|---|---|---|---|
| `salary_timing_lift` | 2.4× | 1.0 – 4.0 | "Your retry-timing edge is fabricated" |
| `self_recovery_base` | 0.30 | 0.05 – 0.70 | "Nobody comes back on their own" |
| `incentive_elasticity` | 1.6× | 1.0 – 3.0 | "Discounts work better than you assume" |
| `farmer_share` | 0.15 | 0.00 – 0.40 | "Farming isn't real" |
| `farmer_learning_rate` | 0.12 | 0.0 – 0.5 | "Customers don't adapt that fast" |
| `message_fatigue` | 0.40 | 0.0 – 1.0 | "Spamming is free" |
| `margin_rate_bps` | 2200 | 500 – 6000 | "Your margins are unrealistic" |
| `optout_sensitivity` | 1.0 | 0.0 – 3.0 | "Annoyance costs nothing" |
| `population_size` | 2000 | 200 – 20000 | Scale |
| `sim_days` | 30 | 7 – 90 | |
| `seed` | 42 | any int | Reproducibility |

**Pre-compute a parameter sweep before the demo.** Run 200 configurations offline, store the results, and put a small chart on the Ledger screen: *"HOLD beats baseline on net profit in 187 of 200 sampled worlds."* Then name the 13 where it loses and explain why (very low margins make every intervention unprofitable, so HOLD converges on doing nothing and ties). Volunteering your own failure cases is disproportionately persuasive to judges.

### 6.6 Training data bootstrap — the cold start problem

Your ML models need training data that does not exist at t=0. Solve it explicitly:

1. **Warm-up phase** (sim days −60 to 0): the simulator runs a *random policy* — every risk event gets a uniformly random action from the allowed set. This produces unbiased data across all six arms. Roughly 4,000 labelled events.
2. **Train** models A, B, C on the warm-up data.
3. **Live phase** (sim days 0 to 30): the agent uses trained models, but 8% of events are randomly assigned an exploration action to keep collecting unbiased data.
4. **Retrain** at the end of each run.

This is standard contextual-bandit practice and saying "8% epsilon-exploration to avoid feedback loops in the training data" is a strong signal that you know what you're doing.

---

## 7. Machine learning — precise specification

### 7.1 Does this project involve ML? Yes, genuinely.

Three supervised models plus a calibration layer. Not deep learning, and that is the correct choice — you have tabular data with ~30 features and a few thousand rows, where gradient boosting beats a neural net on accuracy, training time, and explainability simultaneously.

### 7.2 The models

| Model | Target | Algorithm | Rows |
|---|---|---|---|
| **A — `p_baseline`** | Did the event resolve with no intervention? | `HistGradientBoostingClassifier` | Holdout arm only (~1,200) |
| **B — `p_recover[a]`** | Did it resolve given action `a`? | One model per action arm (T-learner), 5 arms | ~800 each |
| **C — `p_optout`** | Did the customer opt out within 7 days? | `HistGradientBoostingClassifier` | All contacted events |

**Why a T-learner** (one model per action) rather than an S-learner (one model with action as a feature): with only five arms and cheap synthetic data, the T-learner captures arm-specific interaction structure and, more importantly, it lets you show per-action feature importance in the UI. The S-learner tends to under-use the treatment variable when it is one column among thirty.

### 7.3 Calibration — do not skip this

Raw classifier outputs are scores, not probabilities. The EV equation multiplies them by rupees, so a miscalibrated model produces confidently wrong money.

```python
from sklearn.calibration import CalibratedClassifierCV
model = CalibratedClassifierCV(base_estimator, method="isotonic", cv=5)
```

Report **Brier score** and plot a **reliability diagram** in the Ledger screen. When a judge asks how you know your probabilities are trustworthy, you point at the diagonal. Very few hackathon teams will have this and it is a five-line change.

### 7.4 Feature list (~30 features)

**Customer:** tenure_days, segment, ltv_expected, gross_margin_bps, prior_recovery_count, prior_abandon_count, abandon_rate_90d, farming_score, days_since_last_purchase, messages_received_7d, messages_received_30d, prior_optout_signals, preferred_language, whatsapp_opted_in

**Event:** kind, value_at_risk, value_percentile_for_customer, cause_code, cause_confidence, attempt_number, hour_of_day, day_of_month, days_to_inferred_salary_day, is_weekend, days_since_event_detected

**Context:** payment_method, issuer, gateway, gateway_success_rate_1h, cart_category, delivery_fee_ratio, device, checkout_stage_at_abandon

**Engineered — the ones that carry the signal:**
- `days_to_inferred_salary_day` — infer from the day-of-month distribution of the customer's past successful payments. This single feature is where most of the retry-timing uplift lives.
- `delivery_fee_ratio` = delivery_fee ÷ cart_value. Fee shock is a distinct abandonment cause and this feature isolates it.
- `abandon_convert_interval_variance` — low variance is the tell for a farmer.
- `value_percentile_for_customer` — a ₹4,000 cart means something different to a power user than to a new customer.

### 7.5 Uncertainty estimation

You need confidence intervals for the restraint rule. Two options:

**Preferred (fast, good enough):** bootstrap ensemble. Train 20 models on bootstrap resamples per arm, take the 10th and 90th percentile of predicted probability as the CI. Trains in under a minute on this data size, works with any estimator, and requires no extra libraries.

**Fallback if training time hurts:** approximate the CI from a fitted Beta distribution over the k nearest training neighbours in feature space. Cruder, but instant.

Propagate the probability CI through the EV equation to get `ci_low_paise` and `ci_high_paise`. That interval is what the restraint rule tests against zero, and it is what the case-file UI draws as a horizontal bar crossing the zero line — the most information-dense visual in the entire product.

### 7.6 Evaluation

- **AUC + Brier + calibration curve** per model
- **Qini curve** and **Qini coefficient** for the uplift models. This is the standard uplift-modelling metric and naming it correctly signals you did not just wire up an LLM.
- **Uplift at k**: if we could only intervene on 20% of events, does the model pick the right 20%?
- **Policy value**: total incremental net profit under the agent's policy vs baseline vs holdout — the headline.

---

## 8. Backend specification

### 8.1 Tech stack, with reasoning

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| Language | **Python 3.11** | The ML is real. sklearn/pandas is the fastest path. Node would mean either a Python sidecar or hand-rolled ML — both worse. |
| Framework | **FastAPI** | Auto-generated OpenAPI spec, which you feed to Claude Code to generate a typed frontend client. Async-native for the SSE stream. |
| ORM | **SQLModel** | Pydantic models and SQLAlchemy tables in one class definition. Halves your model code. |
| DB | **Postgres 16 (Docker)** | JSONB, concurrent writes. SQLite fallback via one connection-string change. |
| Migrations | **None — `create_all` + a reset endpoint** | Alembic is correct engineering and wrong for 24 hours. Your schema will change 30 times; you want `POST /api/dev/reset` instead. |
| Scheduler | **APScheduler** | The sweep loop. In-process, no Celery, no Redis, no broker. |
| Realtime | **SSE via `sse-starlette`** | One-directional server→client. Simpler than WebSockets, survives proxies, trivially debuggable with `curl`. |
| ML | **scikit-learn + pandas + numpy + joblib** | |
| LLM | **`anthropic` Python SDK** | Sonnet 4.6 for composition/adjudication, Haiku 4.5 for narratives |
| Validation | **Pydantic v2** | Shapes shared with the frontend via generated TypeScript types |
| Tests | **pytest — six tests only** | All six on guardrails (section 9.4). Nothing else earns its time. |
| Lint | **Ruff** | |

### 8.2 Project structure

```
backend/
├─ docker-compose.yml
├─ pyproject.toml
├─ app/
│  ├─ main.py                 # FastAPI app, CORS, routers
│  ├─ config.py               # env, constants, τ thresholds
│  ├─ db.py                   # engine, session, create_all
│  ├─ models/                 # SQLModel table definitions (one file per group)
│  ├─ schemas/                # Pydantic request/response DTOs
│  ├─ api/
│  │  ├─ runs.py  cases.py  policies.py  watchlist.py
│  │  ├─ audit.py  world.py  metrics.py  dev.py
│  │  └─ stream.py            # SSE endpoint
│  ├─ agent/
│  │  ├─ detect.py            # sweep queries
│  │  ├─ diagnose.py          # cause classification
│  │  ├─ score.py             # model inference + CIs
│  │  ├─ decide.py            # EV maximiser + restraint rule
│  │  ├─ policy.py            # guardrail engine
│  │  ├─ act.py               # bounded executors
│  │  ├─ verify.py            # outcome attribution
│  │  └─ farming.py           # farming score
│  ├─ llm/
│  │  ├─ client.py  prompts.py  compose.py
│  │  ├─ adjudicate.py  narrate.py  cache.py
│  ├─ ml/
│  │  ├─ features.py  train.py  predict.py  calibrate.py  qini.py
│  ├─ sim/
│  │  ├─ population.py  events.py  oracle.py  clock.py  sweep.py
│  └─ audit.py                # hash-chained append-only writer
└─ tests/test_guardrails.py
```

### 8.3 The sim clock

One class, and it governs everything.

```python
class SimClock:
    def __init__(self, start, speed=2880):   # 2880× → 1 sim day per 30 real seconds
        ...
    @property
    def now(self) -> datetime: ...
    def pause(self): ...
    def resume(self): ...
    def set_speed(self, x): ...
```

The demo needs **pause**. When a judge says "wait, go back to that one" and you can freeze a run mid-flight, that is worth more than any feature you could build in the same hour. Every timestamp written by the agent uses `clock.now`, never `datetime.now()`.

### 8.4 API contract

Base URL `http://localhost:8000`. All responses JSON. Money in **paise as integers**. Timestamps ISO 8601 with timezone.

**Build every one of these as an MSW mock first.**

#### Runs

```
POST   /api/runs
       body: { world_config_id, arms: string[], population_size, sim_days, seed }
       201 → RunSummary

GET    /api/runs                      → RunSummary[]
GET    /api/runs/{run_id}             → RunDetail
POST   /api/runs/{run_id}/pause       → RunDetail
POST   /api/runs/{run_id}/resume      → RunDetail
POST   /api/runs/{run_id}/speed       body: { speed: number }
DELETE /api/runs/{run_id}             → 204
GET    /api/runs/{run_id}/stream      → text/event-stream
GET    /api/runs/{run_id}/summary     → RunMetrics
```

```jsonc
// RunSummary
{
  "id": "run_01HX...",
  "status": "running",
  "arms": ["agent", "baseline", "holdout"],
  "population_size": 2000,
  "sim_days": 30,
  "seed": 42,
  "progress": { "sim_day": 12, "total_days": 30, "events_processed": 431, "events_total": 1180 },
  "started_at": "2026-08-23T10:14:02Z",
  "completed_at": null
}
```

```jsonc
// RunMetrics — powers the Ledger screen
{
  "run_id": "run_01HX...",
  "arms": {
    "agent": {
      "events": 1180,
      "value_at_risk_paise": 74210000,
      "recovered_paise": 31840000,
      "spend_paise": 1892000,
      "net_profit_paise": 5117000,
      "incremental_profit_paise": 3402000,
      "recovery_rate": 0.429,
      "actions_taken": 786,
      "holds": 394,
      "margin_protected_paise": 2210000,
      "optouts": 11,
      "messages_sent": 612
    },
    "baseline": { /* same shape */ },
    "holdout":  { /* same shape */ }
  },
  "deltas": {
    "net_profit_vs_baseline_paise": 2894000,
    "net_profit_vs_baseline_pct": 0.563,
    "spend_reduction_pct": 0.41,
    "recovery_rate_delta": -0.018
  },
  "series": [
    { "sim_day": 1, "agent_net_paise": 41000, "baseline_net_paise": 38000, "holdout_net_paise": 22000 }
  ],
  "qini": { "coefficient": 0.187, "points": [{ "fraction": 0.1, "agent": 0.21, "random": 0.10 }] },
  "calibration": [{ "predicted": 0.05, "observed": 0.047, "n": 88 }]
}
```

Note the deliberately ugly `"recovery_rate_delta": -0.018`. **Your agent should have a slightly WORSE recovery rate than the baseline and a much better net profit.** Do not hide it — put it on screen with a label reading *"we recover less, and make more."* That single line is your best chance of being remembered.

#### Cases

```
GET  /api/cases?run_id=&arm=&status=&decision=&cause=&min_value=&q=&cursor=&limit=
     → { items: CaseListItem[], next_cursor: string | null }

GET  /api/cases/{id}                  → CaseDetail
POST /api/cases/{id}/override         body: { action, params, reason } → CaseDetail
GET  /api/cases/{id}/narrative        → { narrative: string }   # lazy LLM
```

```jsonc
// CaseListItem — the live feed row
{
  "id": "evt_01HX...",
  "customer": { "id": "cus_...", "display_name": "Meera Raghavan", "segment": "regular",
                "farming_tier": "normal", "city": "Chennai" },
  "kind": "abandoned_checkout",
  "value_at_risk_paise": 340000,
  "cause_code": "upi_timeout",
  "cause_confidence": 0.86,
  "status": "resolved",
  "arm": "agent",
  "decision": {
    "action": "HOLD",
    "reason_code": "no_action_beats_hold",
    "best_ev_paise": -4200,
    "margin_protected_paise": 34000
  },
  "outcome": { "resolution_path": "self_recovered", "net_profit_paise": 74800 },
  "detected_at_sim": "2026-09-04T14:32:11Z",
  "headline": "Returned on their own in 3h 12m. We spent nothing."
}
```

```jsonc
// CaseDetail — powers the trace screen
{
  "event": { /* CaseListItem fields */ },
  "customer_context": {
    "tenure_days": 412, "ltv_expected_paise": 2840000, "gross_margin_bps": 2200,
    "abandon_rate_90d": 0.31, "messages_received_7d": 0,
    "inferred_salary_day": 28, "farming_score": 0.19,
    "farming_signals": { "abandon_rate": 0.31, "post_incentive_conversion": 0.12,
                         "incentive_dependency": 0.05, "timing_regularity": 0.22,
                         "stage_consistency": 0.40 },
    "recent_events": [{ "id": "evt_...", "kind": "...", "outcome": "self_recovered", "at": "..." }]
  },
  "diagnosis": {
    "cause_code": "upi_timeout", "confidence": 0.86,
    "narrative": "UPI collect request timed out at 14:32. This customer has timed out twice before and completed payment within four hours both times.",
    "evidence": [{ "signal": "gateway_upi_success_rate_1h", "value": "71%", "weight": 0.34 }]
  },
  "scoring": {
    "p_baseline": 0.61, "p_baseline_ci": [0.54, 0.68],
    "model_version": "p_baseline@2026-08-23T09:11Z",
    "top_features": [{ "name": "cause_code=upi_timeout", "contribution": 0.28 },
                     { "name": "prior_self_recoveries", "contribution": 0.19 }]
  },
  "candidates": [
    { "action": "HOLD", "p_recover": 0.61, "uplift": 0.0, "gross_gain_paise": 0,
      "direct_cost_paise": 0, "incentive_cost_paise": 0, "annoyance_cost_paise": 0,
      "farming_cost_paise": 0, "ev_paise": 0, "ci_low_paise": 0, "ci_high_paise": 0,
      "allowed": true, "rank": 1 },
    { "action": "NUDGE_INCENTIVE", "p_recover": 0.74, "uplift": 0.13,
      "gross_gain_paise": 9724, "incentive_cost_paise": 34000, "annoyance_cost_paise": 1180,
      "farming_cost_paise": 400, "ev_paise": -25891, "ci_low_paise": -38200,
      "ci_high_paise": -12400, "allowed": true, "rank": 5 }
    /* ... all six ... */
  ],
  "decision": {
    "chosen_action": "HOLD", "reason_code": "no_action_beats_hold",
    "decided_by": "engine", "latency_ms": 34,
    "explanation": "Every intervention costs more than the margin it would add. This customer recovers on their own 61% of the time after a UPI timeout, and a 10% incentive would buy 13 points of uplift for ₹340 of margin on a ₹3,400 cart worth ₹748 in gross profit.",
    "blocked_actions": []
  },
  "actions": [],
  "messages": [],
  "outcome": {
    "resolution_path": "self_recovered", "recovered_paise": 340000,
    "total_cost_paise": 0, "net_profit_paise": 74800,
    "counterfactual_recovered_paise": 340000, "incremental_profit_paise": 0,
    "resolved_at_sim": "2026-09-04T17:44:03Z"
  },
  "audit_trail": [{ "stage": "detect", "summary": "...", "sim_time": "...", "actor": "engine" }]
}
```

#### Watchlist, policies, world, audit, metrics

```
GET  /api/watchlist?run_id=&tier=            → WatchlistEntry[]
GET  /api/watchlist/{customer_id}            → WatchlistDetail   (score timeline + events)

GET  /api/policies                           → Policy[]
PUT  /api/policies/{id}                      body: { enabled?, rule? } → Policy
POST /api/policies/propose                   body: { text } → PolicyProposal   (LLM)
POST /api/policies/simulate                  body: { run_id, policies } → { blocked_count, net_profit_delta_paise }

GET  /api/world/configs                      → WorldConfig[]
POST /api/world/configs                      body: { name, params } → WorldConfig
GET  /api/world/sweep                        → { results: [{ params, agent_net, baseline_net, agent_wins }] }

GET  /api/audit?run_id=&stage=&customer_id=&cursor=&limit=   → { items: AuditEntry[], next_cursor }
GET  /api/audit/verify?run_id=               → { intact: true, entries_checked: 4812 }
GET  /api/audit/export.csv?run_id=           → text/csv

GET  /api/metrics/models                     → ModelVersion[]
POST /api/dev/reset                          → 204
POST /api/dev/seed                           body: { config } → 201
```

### 8.5 SSE event stream

`GET /api/runs/{run_id}/stream` emits named events. This is what drives the live feed.

```
event: run.progress
data: {"sim_day":12,"events_processed":431,"events_total":1180,"speed":2880}

event: case.detected
data: {"id":"evt_...","customer":{...},"kind":"abandoned_checkout","value_at_risk_paise":340000,"arm":"agent"}

event: case.decided
data: {"id":"evt_...","action":"HOLD","reason_code":"no_action_beats_hold","margin_protected_paise":34000,"best_ev_paise":-4200}

event: case.acted
data: {"id":"evt_...","action_id":"act_...","type":"NUDGE_FREE","channel":"whatsapp","cost_paise":35}

event: case.outcome
data: {"id":"evt_...","resolution_path":"self_recovered","net_profit_paise":74800,"incremental_profit_paise":0}

event: guardrail.blocked
data: {"id":"evt_...","action":"NUDGE_INCENTIVE","policy_id":"pol_...","policy_name":"Quiet hours 20:00–09:00"}

event: farming.escalated
data: {"customer_id":"cus_...","display_name":"Rohit Menon","from_tier":"watch","to_tier":"flagged","score":0.71}

event: metrics.tick
data: {"agent":{"net_profit_paise":5117000,"margin_protected_paise":2210000,"holds":394},"baseline":{...}}

event: run.completed
data: {"run_id":"run_...","summary":{...}}
```

**Throttle `metrics.tick` to 4/second maximum.** At 2880× sim speed the raw event rate will melt React's reconciler. Batch on the server, not the client.

### 8.6 LLM prompt contracts

Every LLM call returns strict JSON, validated with Pydantic, with a deterministic fallback on failure. **Never let an LLM failure break the run** — if adjudication fails, fall back to `HOLD` and log it. Failing safe toward restraint is thematically perfect and you should mention it.

```jsonc
// adjudicate.py — the ambiguous-case call
{
  "recommended_action": "NUDGE_FREE",        // must be in allowed_actions
  "confidence": 0.72,
  "reasoning": "Two sentences maximum.",
  "key_factor": "customer_tenure",
  "dissenting_consideration": "If the mandate is genuinely revoked, no message will help."
}
```

```jsonc
// compose.py — message generation
{
  "body": "...",
  "language": "hinglish",
  "tone": "warm",
  "incentive_mentioned": false,
  "estimated_read_seconds": 8,
  "policy_self_check": { "no_urgency_pressure": true, "no_third_party_mention": true, "under_320_chars": true }
}
```

The composer prompt must receive the policy document and be told which constraints are hard. Then the guardrail engine re-checks the output independently — the LLM's self-check is a hint, never the enforcement. Say this out loud on stage: *"the model checks itself, and then we don't trust it and check again."*

---

## 9. Guardrails, policy and compliance

### 9.1 Why this is scoreable, not decoration

The track explicitly asks for "compliant escalation, stopping rules, and an audit trail." Most teams will build 20% of this and spend the time on a prettier chart. Doing all of it rigorously moves you into the top group before your idea is even considered.

### 9.2 The policy engine

Policies are structured JSON predicates evaluated *before* the EV comparison. They remove actions from the candidate set — they never overrule a decision after the fact. That ordering matters: a blocked action must never appear as "chosen then reverted" in the audit log.

```jsonc
{
  "id": "pol_quiet_hours",
  "name": "Quiet hours 20:00–09:00 IST",
  "kind": "hard_block",
  "applies_to": ["NUDGE_FREE", "NUDGE_INCENTIVE"],
  "rule": { "any": [ { "field": "sim_time.hour", "op": "gte", "value": 20 },
                     { "field": "sim_time.hour", "op": "lt",  "value": 9 } ] },
  "enabled": true
}
```

### 9.3 The eleven shipped policies

| # | Policy | Kind | Rule |
|---|---|---|---|
| 1 | Quiet hours 20:00–09:00 IST | hard_block | All messaging outside 09:00–20:00 |
| 2 | Hard opt-out is permanent | hard_block | `customer.hard_optout == true` → no contact, ever |
| 3 | Maximum 3 contacts per event | cap | Contact count on this risk event |
| 4 | Maximum 1 message per customer per 24h | cap | Across all events |
| 5 | Maximum 5 messages per customer per 7 days | cap | Fatigue ceiling |
| 6 | No retries on `expired_card` / `mandate_revoked` | hard_block | Retrying a dead mandate is pure waste |
| 7 | Maximum 4 mandate retry attempts | cap | Regulatory ceiling on autopay retries |
| 8 | No incentives to `flagged` farmers | hard_block | `farming_tier == "flagged"` |
| 9 | Half incentive to `watch` farmers | cap | `incentive_bps ≤ 500` |
| 10 | Human approval above ₹25,000 | require_approval | Queued, not auto-executed |
| 11 | 72h cool-down after resolution | hard_block | Never chase a resolved event |

### 9.4 Stopping rules (distinct from policies)

Policies constrain *what* you may do. Stopping rules end the pursuit entirely and close the case:

- Event resolved → stop, cancel all scheduled actions
- Customer opted out at any point → stop, mark `hard_optout`
- 3 actions taken with no movement → stop, mark `lost`
- `value_at_risk < ₹40` → never start (the message costs more than the margin)
- Event older than 14 sim-days → expire
- Every open action has an explicit **cancel path** when the customer self-recovers first — this is the detail that separates a real system from a demo. Show a cancelled scheduled retry on stage.

### 9.5 The six tests worth writing

```
test_quiet_hours_blocks_message_at_21_00
test_hard_optout_blocks_every_action_type
test_flagged_farmer_cannot_receive_incentive
test_expired_card_never_produces_a_retry
test_scheduled_action_cancels_on_self_recovery
test_audit_hash_chain_detects_tampering
```

Run them live on stage if you have a spare 20 seconds. `6 passed` on a terminal next to a compliance claim is disproportionately convincing.

### 9.6 Audit trail

Hash-chained, append-only, exportable to CSV. Every stage transition writes an entry. The verify endpoint recomputes the chain and reports intact/broken. Demonstrate tamper-evidence by manually `UPDATE`-ing one row in psql and hitting verify — it goes red and names the entry. That is a 10-second demo beat that buys enormous credibility.

---

## 10. Frontend specification

This is the part you are building first. Everything below is decided.

### 10.1 Tech stack

| Concern | Choice | Reasoning |
|---|---|---|
| Framework | **React 19 + TypeScript 5.7** | |
| Build | **Vite 6** | Next.js buys you SSR you do not need and costs you config time |
| Styling | **Tailwind CSS v4** | CSS-first `@theme` config, no `tailwind.config.js` |
| Primitives | **shadcn/ui**, restyled | Use only Dialog, Sheet, Tooltip, Popover, Tabs, Switch, Slider, Command. **Change the default radius and colours immediately** — default shadcn is instantly recognisable and reads as "we had no design opinion." |
| Server state | **TanStack Query v5** | Caching, polling, invalidation for free |
| UI state | **Zustand** | Selected case, filters, stream buffer. Small store, no Redux. |
| Routing | **React Router v7** (declarative) | |
| Charts | **Recharts** | Faster to ship than visx. Restyle axes and grid to hairlines. |
| Motion | **motion** (Framer Motion) | Used in exactly four places (10.4) |
| Validation | **zod** | Parse every API response. Catches contract drift instantly. |
| Mocks | **MSW v2** | The whole strategy depends on this |
| Utils | **date-fns**, **clsx**, **tailwind-merge** | |
| Icons | **lucide-react** | Sparingly. Stroke width 1.5. |
| Numbers | **Intl.NumberFormat('en-IN')** | ₹ lakh/crore grouping, not thousands. Non-negotiable for an Indian panel. |

### 10.2 The design direction

**Grounding:** this is a clearing-house terminal. The visual world is printed bank settlement statements, NSE end-of-day reports, RBI circulars — dense, ruled, monospaced numerals, zero ornament, everything justified to a grid.

**The deliberate risk:** the entire product is **light**, not dark. Every AI-built dashboard right now is near-black with an acid accent. A light, hairline-ruled, statement-dense terminal will be the only one of its kind in the room, and it photographs better on a projector.

#### Tokens

```css
@theme {
  --color-paper:  #F2F1ED;   /* app ground — cool paper, NOT cream */
  --color-card:   #FFFFFF;
  --color-rule:   #DAD8D1;   /* hairlines, everywhere */
  --color-ink:    #14161A;
  --color-muted:  #6B6E75;
  --color-faint:  #9B9DA3;

  --color-hold:   #3B3A8F;   /* indigo — RESERVED for HOLD. Never used for anything else. */
  --color-gain:   #12694A;   /* money recovered */
  --color-burn:   #A32D2D;   /* money spent / lost */
  --color-warn:   #8A5A0B;   /* policy blocks, farming */

  --radius: 4px;             /* the only radius in the product */
}
```

Nine colours total. The rule that makes it feel designed rather than assembled: **indigo appears only when the agent holds.** A judge will not consciously notice, but by minute three they will have learned what indigo means without being told.

#### Type

- **Display / UI:** `Instrument Sans` (Google Fonts) — 400 and 500 only. Never 600 or 700.
- **Data / numerals:** `JetBrains Mono`, with `font-variant-numeric: tabular-nums`. **Every rupee figure, probability, percentage and ID in the product is mono.** No exceptions. This is the aesthetic risk and it must be total to work.
- **Eyebrow labels:** Instrument Sans, 11px, `letter-spacing: 0.09em`, uppercase, `--color-faint`.
- No serif face anywhere. A deliberate refusal.

Scale: 11 / 13 / 15 / 20 / 32 / 48. Body 13px — this is a dense terminal, not a marketing page. Line-height 1.45 for text, 1.2 for data rows.

#### Structure

- 8px baseline grid. Every vertical measurement is a multiple of 8.
- 1px `--color-rule` hairlines separate everything. No shadows. No borders thicker than 1px anywhere in the product.
- Cards are white on paper with a hairline. No elevation.
- Data tables have **no vertical rules** and **no zebra striping** — horizontal hairlines only, like a printed statement.
- All monetary columns right-aligned with aligned decimals.

#### The signature element

**The Hold Ledger.** A permanent 280px strip down the right edge of the Floor screen. Every time the agent holds, a line prints into it — customer, cause, and the rupee amount *not* spent — and a running total labelled **MARGIN PROTECTED** ticks upward in 32px indigo mono at the top.

Nothing else in the product uses indigo. The strip fills up over a run and becomes the visual argument for the entire thesis. When a judge asks what makes this different from Chargebee, you point at the strip.

**Second signature moment:** when a case resolves as HOLD, its card does not slide away. It **greys and receives a stamp** — a small indigo `HELD` mark, rotated −4°, with a hairline box, animating from scale 1.06 to 1 over 180ms. Restraint rendered as a rubber stamp on a form. It is the one piece of ornament in the product and it earns its place because it encodes the thesis.

### 10.3 Copy voice

Plain, declarative, slightly clinical. Never exclamatory. The interface is a clerk, not a salesperson.

| Instead of | Write |
|---|---|
| "Great news! We recovered ₹34,000!" | "Recovered ₹34,000." |
| "Optimizing recovery strategy…" | "Scoring 6 actions." |
| "Oops! Something went wrong." | "The run stopped at sim-day 12. The event stream disconnected." |
| "No data yet" | "No runs yet. Start one from the World screen." |
| "Submit" | "Start run" |
| "AI-powered decision" | "Decision" |

Every empty state names the next action. Every error names what happened and what to do.

### 10.4 Motion — exactly four uses

1. Rupee counters tick with a 400ms ease-out interpolation, mono digits, no bounce.
2. New feed rows enter with 120ms fade + 2px rise. No stagger, no spring.
3. The `HELD` stamp: 180ms scale 1.06 → 1.
4. The EV bar in the case file draws left-to-right over 300ms on open.

Nothing else moves. Wrap all four in `prefers-reduced-motion: no-preference`.

### 10.5 Routes

| Path | Screen | Purpose |
|---|---|---|
| `/` | **The Floor** | Live run. The money shot. |
| `/cases` | **Cases** | Filterable table of all events |
| `/cases/:id` | **Case file** | Full decision trace (also opens as a sheet from the Floor) |
| `/ledger` | **Ledger** | Results, agent vs baseline vs holdout, Qini, calibration |
| `/watchlist` | **Watchlist** | Farming detection |
| `/policy` | **Policy** | Guardrail console |
| `/world` | **World** | Simulator controls, adversarial knobs, run launcher |
| `/audit` | **Audit** | Hash-chained log, verify, export |

### 10.6 Screen 1 — The Floor

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ HOLD    Floor  Cases  Ledger  Watchlist  Policy  World  Audit   ● run_01HX  ⏸ │
├──────────────────┬──────────────────────────────────┬─────────────────────────┤
│ DETECTED         │ DECISION STAGE                   │ HOLD LEDGER             │
│ 41 open          │                                  │                         │
│                  │  ┌────────────────────────────┐  │  MARGIN PROTECTED       │
│ ┌──────────────┐ │  │ Meera Raghavan · Chennai   │  │  ₹22,10,400             │
│ │ ₹3,400       │ │  │ Abandoned checkout ₹3,400  │  │  394 holds              │
│ │ upi_timeout  │ │  │ upi_timeout · conf 0.86    │  │  ─────────────────────  │
│ │ Meera R.     │ │  │                            │  │  14:32 Meera R.  ₹340   │
│ └──────────────┘ │  │  HOLD          ev  ₹0  ██  │  │  14:32 Arjun K.  ₹128   │
│ ┌──────────────┐ │  │  NUDGE_FREE   −₹42  ▌      │  │  14:31 Sana M.   ₹890   │
│ │ ₹1,299       │ │  │  RETRY_NOW    −₹18  ▌      │  │  14:31 Vikram P. ₹210   │
│ │ insufficient │ │  │  NUDGE_INC   −₹259  ▌      │  │  14:30 Nisha R.  ₹455   │
│ │ Arjun K.     │ │  │  ESCALATE    −₹850  ▌      │  │       ⋮                 │
│ └──────────────┘ │  │                            │  │                         │
│       ⋮          │  │  Every intervention costs  │  │                         │
│                  │  │  more than the margin it   │  │                         │
│                  │  │  would add.                │  │                         │
│                  │  └────────────────────────────┘  │                         │
│                  │                                  │                         │
│                  │  RESOLVED                        │                         │
│                  │  ┌──────────┐ ┌──────────┐       │                         │
│                  │  │ ╱HELD╱   │ │ RECOVERED│       │                         │
│                  │  │ Rahul S. │ │ Priya N. │       │                         │
│                  │  └──────────┘ └──────────┘       │                         │
├──────────────────┴──────────────────────────────────┴─────────────────────────┤
│ AGENT ₹51,17,000 net  │ BASELINE ₹22,23,000  │ HOLDOUT ₹17,15,000  │ +56.3%   │
│ sim-day 12/30 ████████░░░░░░░░  431/1180 events   speed 2880×   [pause]        │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Components**

- `<RunBar>` — run id, status dot, pause/resume, speed selector (1×, 720×, 2880×, 8640×), sim-day progress. Sticky top.
- `<DetectQueue>` — left column, virtualised list of `<DetectCard>`. Newest at top, max 40 rendered.
- `<DetectCard>` — value (mono, 15px), cause code (11px eyebrow), customer name, detection rule on hover.
- `<DecisionStage>` — centre. Shows the case currently being decided, holds it for a minimum of 900ms so the eye can follow, then moves it to Resolved. **This minimum dwell time is essential** — at 2880× the real decision takes 34ms and nothing is visible. Queue the stream and drain it at a watchable rate.
- `<EVTable>` — six rows, action name (mono), EV in mono right-aligned, horizontal bar proportional to |EV| with zero at a fixed x-position so negative bars extend left. Chosen row gets a 2px left border in its decision colour.
- `<DecisionExplanation>` — one or two sentences from `decision.explanation`, 13px, `--color-muted`.
- `<ResolvedGrid>` — small cards, `HELD` stamps on holds, `RECOVERED`/`LOST` labels on others. Max 24 shown, then "+ 370 more" linking to `/cases`.
- `<HoldLedger>` — **the signature**. Big mono total, hold count, then a printing feed of held amounts. `overflow-hidden`, entries fade out at the bottom edge with a mask (not opacity per-row — one CSS mask on the container).
- `<ScoreStrip>` — bottom. Three arm totals + delta. Counters animate.

**States**

- No run → the whole Floor is replaced by an empty state: "No run in progress. Start one from World." with a primary button.
- Run paused → a hairline amber band under the RunBar reading "Paused at sim-day 12."
- Stream disconnected → amber band: "Event stream disconnected. Reconnecting." with auto-retry, exponential backoff, max 5.
- Run completed → the Floor freezes and a bar appears: "Run complete. 1,180 events. See Ledger." with a button.

**Interactions**

- Click any card → Case file opens as a right sheet over the Floor (not a navigation). Escape closes.
- Spacebar → pause/resume.
- `j` / `k` → move through the resolved grid.
- `/` → focus search (Command palette, `cmdk`).

### 10.7 Screen 2 — Case file

Opens as a 720px right sheet from the Floor, or full page at `/cases/:id`. Same component, two containers.

```
┌────────────────────────────────────────────────────────────┐
│ evt_01HXQ4…                          Meera Raghavan  ✕     │
│ Abandoned checkout · ₹3,400 at risk · sim 04 Sep 14:32     │
├────────────────────────────────────────────────────────────┤
│ ① DETECTED                                                  │
│   Rule: payment_initiated with no terminal state > 30 min   │
│                                                             │
│ ② DIAGNOSED          upi_timeout        confidence 0.86     │
│   UPI collect request timed out at 14:32. This customer     │
│   has timed out twice before and completed payment within   │
│   four hours both times.                                    │
│   Evidence  gateway_upi_success_rate_1h  71%       w 0.34   │
│             prior_self_recoveries         2        w 0.22   │
│                                                             │
│ ③ SCORED             p_baseline 0.61  CI [0.54, 0.68]       │
│   ▁▂▅█▅▂▁  ← distribution                                   │
│   Top features   cause_code=upi_timeout        +0.28        │
│                  prior_self_recoveries         +0.19        │
│                                                             │
│ ④ CANDIDATES                                                │
│   action          uplift   gain    cost      EV    interval │
│   HOLD              —        —       —       ₹0    ·        │
│   NUDGE_FREE      0.04    ₹299    ₹341     −₹42    ├──┼──┤  │
│   RETRY_NOW       0.02    ₹149    ₹167     −₹18    ├─┼─┤    │
│   NUDGE_INCENTIVE 0.13   ₹9,724  ₹35,580  −₹259  ├────┼──┤  │
│   ESCALATE_HUMAN  0.09   ₹6,732  ₹85,000  −₹850                │
│                                          ↑ zero              │
│ ⑤ DECIDED            HOLD    no_action_beats_hold   34ms    │
│   Every intervention costs more than the margin it would    │
│   add. This customer recovers on their own 61% of the time  │
│   after a UPI timeout, and a 10% incentive would buy 13     │
│   points of uplift for ₹340 of margin on ₹748 gross profit. │
│   [ Override decision ]                                     │
│                                                             │
│ ⑥ OUTCOME            self_recovered      +₹748 net          │
│   Returned unprompted at 17:44 (3h 12m). Counterfactual:    │
│   identical. Incremental profit ₹0 — correctly, we added    │
│   nothing, and spent nothing to add it.                     │
│                                                             │
│ AUDIT  6 entries  chain intact ✓                            │
└────────────────────────────────────────────────────────────┘
```

The numbered stages ①–⑥ are legitimate here — the content genuinely is an ordered pipeline and the order carries information the reader needs.

**Components:** `<CaseHeader>`, `<StageBlock>` (generic, numbered), `<EvidenceTable>`, `<FeatureBars>`, `<CandidateTable>` with `<EVInterval>` (the CI bar crossing a fixed zero line — the single most information-dense element in the product), `<DecisionBlock>`, `<OverrideDialog>`, `<OutcomeBlock>`, `<AuditStrip>`.

**Override flow:** a dialog with the six actions, a required free-text reason, and a warning if the chosen action was policy-blocked ("Policy 8 removed this action. Overriding will be recorded against your name in the audit log."). On confirm, `POST /api/cases/{id}/override`, the case re-renders with `decided_by: human_override`, and a new audit entry appears. Demonstrate this — human-in-the-loop with an audit trail is directly on the track's stated bar.

### 10.8 Screen 3 — Ledger

The results screen. Where you spend your last 90 seconds on stage.

Top row — three large mono figures, hairline-separated:

```
NET PROFIT              MARGIN PROTECTED         RECOVERY RATE
₹51,17,000              ₹22,10,400               42.9%
+56.3% vs baseline      394 holds                −1.8pts vs baseline
```

**Put the negative recovery-rate delta on screen in the same size as the others.** Directly beneath it, in 13px muted: *"We recover less than the baseline and make 56% more. Recovery rate was always the wrong metric."* This is the line your demo is built around.

Below:
- `<ProfitWaterfall>` — value at risk → recovered → minus spend → minus opt-out cost → net. Recharts, hairline axes, gain in `--color-gain`, spend in `--color-burn`.
- `<ArmComparison>` — three-line time series over sim days for agent / baseline / holdout. Holdout as a dashed hairline.
- `<QiniCurve>` — model curve vs random diagonal, coefficient printed in mono. Caption: "Uplift model quality. Random targeting is the diagonal."
- `<CalibrationPlot>` — predicted vs observed with the perfect-calibration diagonal and Brier score.
- `<SweepResult>` — the parameter sweep bar: "HOLD wins in 187 of 200 sampled worlds," with an expandable list of the 13 losses and a one-line reason for each.
- `<ActionMix>` — stacked bar, agent vs baseline, by action type. The visual punchline: the agent's largest block is HOLD (indigo), and the baseline has no indigo at all.

### 10.9 Screen 4 — Watchlist

```
CUSTOMER          TIER      SCORE   ABANDONS  INCENTIVES  EXTRACTED
Rohit Menon       flagged   0.71    14/17     9           ₹4,120
Kavya Iyer        flagged   0.68    11/14     7           ₹3,340
Sana Mehta        watch     0.52     8/15     3           ₹  980
```

- Row click → `<FarmingDetail>`: a score-over-time line (the climb is the story), the five signal contributions as a horizontal bar breakdown, and the customer's event history with the exact case where HOLD cut them off — annotated inline.
- A live counter at the top: **"₹1,84,200 in incentives the baseline paid to flagged farmers. HOLD paid ₹0."**
- Tier badges use `--color-warn`, never red. These are customers, not criminals — a small copy/design judgment a thoughtful judge will register.

### 10.10 Screen 5 — Policy

- Table of the eleven policies: name, kind, applies-to chips, a trigger-count badge (mono), and a `<Switch>`.
- Toggling a policy is instant and shows a hairline note: "Takes effect on the next decision."
- `<PolicyImpact>` panel: "Quiet hours blocked 71 messages this run. Estimated net profit effect: −₹18,200." Being willing to show that a compliance rule *costs* you money — and keeping it on anyway — is a strong, specific, memorable moment.
- `<ProposePolicy>` — a text input: "never contact anyone within 6 hours of a failed delivery." → `POST /api/policies/propose` → the LLM returns a structured rule → render it as JSON in a diff-style block with **Add policy** / **Discard**. Human confirms; nothing auto-applies.

### 10.11 Screen 6 — World

The judge panel. Left: sliders for every parameter in section 6.5, each with its default marked as a tick on the track, current value in mono, and a one-line description of what it attacks. Right: a live preview of the resulting population mix.

Bottom: **Start run** — arms (multi-select), population size, sim days, seed. Presets: `Default`, `Pessimistic` (every knob set against you), `Judge custom`.

Copy under the presets: *"Pessimistic sets every assumption against the agent. It still wins by 19%."* Have that run pre-computed and cached so it loads instantly — never re-run it live from cold.

### 10.12 Screen 7 — Audit

- Virtualised table: sim time (mono), stage chip, actor, summary, hash prefix (first 8 chars, mono).
- Filters: run, stage, customer, free text.
- Row expands to the full JSON payload.
- **Verify chain** button → `GET /api/audit/verify` → green "4,812 entries, chain intact" or red "Broken at entry 3,180."
- **Export CSV** button.

### 10.13 Frontend project structure

```
frontend/src/
├─ main.tsx  App.tsx  router.tsx
├─ api/
│  ├─ client.ts          # fetch wrapper, zod parsing, error normalisation
│  ├─ schemas.ts         # zod schemas — THE contract, mirrors section 8.4
│  ├─ queries.ts         # TanStack Query hooks
│  └─ stream/
│     ├─ RunStream.ts    # interface
│     ├─ SseRunStream.ts # real EventSource
│     └─ MockRunStream.ts# fixture replay on setInterval
├─ store/
│  ├─ useRunStore.ts     # stream buffer, selected case, dwell queue
│  └─ useUiStore.ts      # filters, sheet open state
├─ components/
│  ├─ primitives/        # Button, Card, Rule, Eyebrow, Money, Metric, Badge, Sheet…
│  ├─ floor/  case/  ledger/  watchlist/  policy/  world/  audit/
├─ lib/
│  ├─ money.ts           # paise → ₹ with en-IN grouping. THE ONLY place this happens.
│  ├─ format.ts  cn.ts  shortcuts.ts
├─ mocks/
│  ├─ browser.ts  handlers.ts
│  └─ fixtures/          # runs.json, cases.json, stream-events.json, metrics.json
└─ styles/index.css      # @theme tokens, fonts, base
```

### 10.14 The mock strategy — read this twice

1. Write `api/schemas.ts` from section 8.4 **first**, before any component.
2. Write MSW handlers returning fixtures that satisfy those schemas.
3. Write `MockRunStream` — reads `stream-events.json` and emits on `setInterval` at a configurable rate. MSW does not handle SSE well; do not fight it, just abstract the stream behind an interface.
4. Build every screen against mocks.
5. When the backend lands, set `VITE_USE_MOCKS=false`. `RunStream` switches to `SseRunStream`, MSW does not start, and zod immediately tells you about any contract drift with a precise path.

**Generate your fixtures with real thought.** 200 cases with a realistic decision mix (roughly 33% HOLD, 24% NUDGE_FREE, 18% RETRY_SCHEDULED, 12% RETRY_NOW, 9% NUDGE_INCENTIVE, 4% ESCALATE), realistic Indian names and cities, real Hinglish message bodies. A demo built on `Customer 1 / Customer 2 / ₹100` looks unfinished no matter how good the engineering is. This takes 40 minutes and is the highest-leverage 40 minutes in the frontend build.

### 10.15 Frontend build order

| # | Task | Est. | Why this order |
|---|---|---|---|
| 1 | Vite + TS + Tailwind v4 + fonts + tokens | 45m | |
| 2 | `schemas.ts` — the full contract in zod | 60m | Everything downstream depends on it |
| 3 | Fixtures (realistic, Indian, varied) | 40m | |
| 4 | MSW handlers + `MockRunStream` | 45m | |
| 5 | Primitives: `Money`, `Metric`, `Eyebrow`, `Rule`, `Badge`, `Card` | 60m | `Money` first — it is used 200 times |
| 6 | App shell + routing + `RunBar` | 45m | |
| 7 | **The Floor** — full screen with live stream | 3h | The demo lives or dies here |
| 8 | **Hold Ledger** — the signature | 60m | Do not compress this |
| 9 | **Case file** sheet + `EVInterval` | 2.5h | Your depth argument |
| 10 | **Ledger** screen + charts | 2h | Your closing argument |
| 11 | **World** screen (sliders + launcher) | 90m | Your credibility argument |
| 12 | **Watchlist** | 90m | |
| 13 | **Policy** | 75m | |
| 14 | **Audit** | 60m | |
| 15 | Empty / error / loading states everywhere | 60m | |
| 16 | Keyboard shortcuts + command palette | 45m | Cheap, and makes it feel like a real terminal |

Roughly 18 hours of focused frontend work. Screens 12–14 are the ones to cut if you are behind — but cut them entirely rather than shipping them half-built. A product with five finished screens beats one with eight rough ones.

### 10.16 Handing off to Claude Code

When the frontend is done, give Claude Code:

1. This document, sections 4–9 in full.
2. Your `api/schemas.ts` — the authoritative contract.
3. Your `mocks/fixtures/*.json` — worked examples of every shape.

Then instruct it explicitly:

> "Build the FastAPI backend implementing exactly the endpoints in section 8.4. Every response must validate against the zod schemas in schemas.ts. Start with the simulator (section 6), then the ML pipeline (section 7), then the agent loop (section 4), then the API layer, then SSE. Write the six guardrail tests first and keep them passing. Do not change any response shape without telling me."

Build it in that order — simulator, ML, agent, API — because each layer needs the one below to generate data. Ask for the simulator to be runnable standalone via `python -m app.sim.run --seed 42 --days 30` so you can inspect its output before any API exists.

---

## 11. Metrics — what you put on the scoreboard

### 11.1 The hierarchy

| Rank | Metric | Definition | Why |
|---|---|---|---|
| 1 | **Incremental net profit** | `Σ (recovered − counterfactual) × margin − spend − optout_cost` | The only honest number. Your headline. |
| 2 | **Margin protected** | `Σ` cost avoided on HOLD decisions | The thesis, quantified. Nobody else will have this metric. |
| 3 | **Profit per rupee spent** | net profit ÷ spend | Efficiency. Agent should be 3–5× baseline. |
| 4 | **Qini coefficient** | Uplift model quality | Proves the ML is real |
| 5 | **Opt-outs caused** | Customers lost to over-contact | The cost nobody counts |
| 6 | Recovery rate | Recovered ÷ at-risk | **Deliberately not the headline.** Shown, and argued against. |

### 11.2 Target numbers for the demo

Tune your simulator so a default run produces roughly:

- Agent net profit **50–65% above baseline** (above ~80% looks fabricated; below ~30% is not exciting)
- Agent recovery rate **1–3 points below** baseline (the counterintuitive hook)
- Agent spend **35–45% below** baseline
- HOLD chosen on **30–38%** of events (below 25% weakens the thesis; above 45% looks like a broken agent)
- Opt-outs: agent ~11, baseline ~40

If your real numbers come out wildly different, **do not fudge them** — investigate. Either the simulator or the agent has a bug, and finding it is worth more than the pretty number. Judges ask follow-ups; fabricated numbers collapse under one.

---

## 12. Build timeline (36-hour hackathon, 3–4 people)

| Hours | Person A (frontend) | Person B (backend + sim) | Person C (ML + LLM) | Person D (demo + integration) |
|---|---|---|---|---|
| 0–2 | Scaffold, tokens, schemas.ts | Docker, DB, models, migrations | Feature spec, training harness plan | Fixtures, names, message copy |
| 2–6 | Primitives, shell, RunBar | Simulator: population + events | Warm-up data generation | Demo script v1, deck outline |
| 6–12 | **The Floor** + Hold Ledger | Oracle, sweep, agent loop skeleton | Train models A/B/C, calibrate | Policy definitions, guardrail tests |
| 12–18 | **Case file** + EVInterval | EV engine, policy engine, audit chain | Bootstrap CIs, Qini | Integration: first real end-to-end run |
| 18–24 | **Ledger** + charts | API layer, SSE | LLM: compose, adjudicate, narrate | Parameter sweep (200 configs, offline) |
| 24–30 | World, Watchlist, Policy | Wire everything, fix contract drift | Model metrics into the Ledger endpoint | **Rehearse the demo 3×** |
| 30–34 | Audit, empty states, polish | Bug fixes only | Bug fixes only | Rehearse 3× more, record backup video |
| 34–36 | **Freeze.** No new code. | Freeze. | Freeze. | Final rehearsal, backup laptop check |

**The two-hour freeze is not optional.** More hackathon demos die from a commit at T−20min than from any missing feature.

### 12.1 If you are solo or a pair

Cut in this order, and cut *completely*:

1. Audit screen (keep the backend hash chain; show it in the case file)
2. Policy screen (ship the policies working, no UI for them)
3. Watchlist screen (keep farming in the engine; show it in the case file and the Ledger)
4. The `holdout` arm (weakens your numbers — resist this one)
5. `ESCALATE_HUMAN` action

Never cut: the Floor, the Case file, the Hold Ledger, the World knobs, the EV table.

---

## 13. The demo (7 minutes)

Rehearse this until it is muscle memory. The script, minute by minute:

**0:00–0:40 — The wrong metric.**
"Every recovery tool on the market optimises recovery rate. Here's a cart worth ₹3,400. The customer abandoned at UPI. The standard system sends 10% off, they buy, and it records a recovery. What actually happened is we paid ₹340 for a sale we were already getting — they come back on their own 61% of the time. That's not recovery. That's a discount with extra steps."

**0:40–1:30 — The reframe.**
Open the Case file for that exact event. Walk the EV table. Point at HOLD sitting at zero and every other action below it. "Doing nothing is a strategy, and it's a strategy you can only find if you're measuring incremental profit instead of recovery rate."

**1:30–3:30 — The Floor, live.**
Start a run. Let it move. Talk over it: detection, diagnosis, six actions scored, decision. Let the Hold Ledger fill. "Every line in that right-hand strip is money we chose not to spend." Pause the run mid-flight and open one case — showing you can freeze it reads as control.

**3:30–4:30 — The farming defense.**
Watchlist. Rohit Menon's score climbing across the run. "The baseline system taught him to abandon. It paid him ₹4,120 to learn. We cut him off at 0.65 and paid him nothing." Show the cutoff case.

**4:30–5:45 — The Ledger.**
Three numbers. Then, deliberately: "Our recovery rate is 1.8 points *worse* than the baseline. And we made 56% more money. That gap is the whole product."
Then the sweep: "187 of 200 sampled worlds." Then the Qini and calibration: "and these are calibrated probabilities, not model scores — the EV maths multiplies them by rupees, so they have to be real."

**5:45–6:30 — The bar.**
Fast: policy toggle with its cost shown, a blocked action in the audit log, the hash-chain verify going green, `pytest` showing 6 passed, the CSV export.

**6:30–7:00 — Hand them the knobs.**
"Everything you just saw came from a world I wrote. So change it." Open World, hand over the trackpad, invite them to move a slider and re-run.

That last move is the whole game. Nobody else will do it, and it converts your biggest vulnerability into your strongest moment.

### 13.1 Demo hygiene

- Run everything **locally**. No conference wifi in the critical path. Stub the LLM calls behind a cache so even the API is optional — pre-warm the cache for every case you will open on stage.
- **Record a full-run video** at hour 30. If anything breaks live, you play it and narrate.
- Second laptop with the identical stack, running.
- Fixed seed for the demo run. You should know exactly which cases will appear.
- Browser at 1440×900, zoom 100%, no bookmarks bar, no notifications.
- Have `run_demo_01` pre-computed and cached so the Ledger loads instantly if the live run is slow.

---

## 14. Judge Q&A — prepared answers

**"Isn't this just Chargebee / Stripe smart dunning?"**
Those optimise recovery rate. We optimise incremental net profit, which means we have an action they structurally cannot take — doing nothing — and we take it on a third of events. Point at the Hold Ledger.

**"Your simulator decides your results."**
Correct, which is why it is a control panel and not a hidden constant. Here are 200 sampled worlds; we win in 187. Here are the 13 where we lose and why. Now change a slider yourself.

**"Where is the AI? This looks like arithmetic."**
The decision is arithmetic on purpose — it has to be auditable and cheap. The ML is three calibrated uplift models with bootstrap confidence intervals, here is the Qini curve. The LLM does the four things that need language and judgment: diagnosis narrative, message composition in three languages, adjudication when the confidence interval straddles zero, and the audit rationale. An LLM guessing probabilities would be worse and indefensible.

**"How do you know the probabilities are right?"**
Isotonic calibration, and here is the reliability diagram and the Brier score. Uncalibrated scores multiplied by rupees produce confidently wrong money.

**"What happens on your first day at a real company with no training data?"**
Epsilon-exploration. Start at 100% random policy, collect unbiased data across all six arms, decay to 8% as models stabilise. Roughly two weeks of traffic at moderate volume. And with no models at all, the restraint rule degrades gracefully to HOLD, which is the safe default — we fail toward doing nothing.

**"Isn't holding just losing revenue you could have captured?"**
Only if the intervention was free and had no side effects. It costs a message, an incentive, an opt-out risk, and it trains farmers. Here is the opt-out count: 11 versus 40. Those 29 customers are worth more than the events we passed on.

**"Would this actually work at Blinkit scale?"**
The models are gradient boosting on 30 tabular features — sub-millisecond inference, batched. The bottleneck is LLM calls, which is why they are lazy and cached at roughly 40 distinct combinations covering 500 cases. The sweep is a single indexed query. Nothing here is architecturally blocked at 10M events a day.

**"What's the biggest weakness?"**
Attribution. In the simulator we have the true counterfactual; in production you never do. You would need a permanent holdout arm — 5% of events deliberately untouched — which costs real money to run. That is the honest answer and we would rather say it than pretend.

*(Volunteering a real weakness at the end of a Q&A consistently reads as confidence rather than doubt.)*

---

## 15. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Contract drift between FE and BE | High | zod parsing + schemas.ts as single source of truth |
| LLM latency melts the demo | High | Lazy narratives, cache, pre-warm every demo case |
| SSE floods React | Medium | Server-side throttle to 4/s, client dwell queue |
| Numbers look fabricated | Medium | Sweep + live knobs + volunteered failure cases |
| Simulator bug produces impossible results | Medium | Assert invariants: recovered ≤ at_risk, spend ≥ 0, counterfactual uses paired seed |
| Postgres fails on a teammate's laptop | Low | SQLite fallback via connection string |
| Someone commits at T−20min | Medium | **Hard freeze at hour 34.** Enforce socially. |

---

## 16. Stretch goals (only after everything above works)

1. **Gateway degradation detection** — success rate by issuer/gateway on a rolling window, CUSUM change detection, auto-reroute. Visually the most gripping thing in the track, and a strong second act if you have six spare hours.
2. **Hinglish voice recovery** — one pre-recorded call with promise-to-pay extraction. High ceiling, high risk; only if someone has shipped voice before.
3. **Counterfactual explorer** — a case-file toggle: "what would the baseline have done here?" side by side.
4. **Live A/B on the Floor** — split-screen agent vs baseline on the same event stream, simultaneously.

---

## 17. Every decision, in one table

| Question | Decision |
|---|---|
| Web or mobile? | Web, desktop-first, 1440×900 target |
| Framework | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind v4, restyled shadcn/ui, 4px radius only |
| Charts | Recharts, hairline-styled |
| Server state | TanStack Query v5 |
| UI state | Zustand |
| Mocking | MSW v2 + a `RunStream` interface with a mock implementation |
| Backend language | Python 3.11 |
| Backend framework | FastAPI |
| ORM | SQLModel |
| Database | Postgres 16 in Docker, SQLite fallback |
| Migrations | None — `create_all` + reset endpoint |
| Realtime | SSE, not WebSockets |
| Scheduler | APScheduler in-process |
| ML | scikit-learn `HistGradientBoostingClassifier`, isotonic calibration, T-learner, bootstrap CIs |
| Does it involve ML? | Yes — 3 supervised models + calibration + uplift evaluation |
| LLM | Sonnet 4.6 (compose, adjudicate, propose) + Haiku 4.5 (narrate, audit) |
| LLM chooses the action? | **No.** Expected value arithmetic does. |
| Money representation | Integer paise everywhere; formatted `en-IN` at the render boundary only |
| Time | Dual `sim_time` / `wall_time` |
| Auth | None |
| Deployment | Local for the demo; Railway/Vercel as backup |
| Verticals | Failed subscription renewals + checkout abandonment. Nothing else. |
| Actions | Exactly six, `HOLD` first-class with EV ≡ 0 |
| Headline metric | Incremental net profit |
| Signature UI element | The Hold Ledger strip + the `HELD` stamp |
| Signature colour | Indigo `#3B3A8F`, used only for HOLD |
| Aesthetic risk | Light, hairline-ruled, all-mono numerals — a printed clearing statement, not a dark dashboard |

---

## 18. The one thing to remember

If you build only one thing well, build the moment where the Ledger shows a **worse recovery rate** and a **much higher profit**, and you say out loud that recovery rate was always the wrong metric.

Everything else in this document exists to make that moment credible.
