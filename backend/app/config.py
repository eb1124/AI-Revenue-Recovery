from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Section 5.1: Postgres 16 in Docker by default; flip to a sqlite:/// URL
    # if Postgres won't cooperate on-site — no other code change needed.
    database_url: str = "postgresql+psycopg://hold:hold@localhost:5432/hold"

    anthropic_api_key: str = ""

    # --- Decision engine thresholds (section 4.3) ---------------------------
    # τ — minimum EV edge required to act instead of holding.
    tau_paise: int = 500  # ₹5
    # Above this value_at_risk, an uncertain (CI straddles zero) case escalates
    # to a human instead of defaulting to HOLD.
    ambiguity_escalation_threshold_paise: int = 1_500_000  # ₹15,000

    # --- Stopping rules (section 9.4) ----------------------------------------
    # Below this value_at_risk, a case never starts — the message would cost
    # more than the margin it could protect.
    min_value_at_risk_paise: int = 4_000  # ₹40
    lost_after_n_actions: int = 3
    event_expiry_sim_days: int = 14
    cooldown_hours_after_resolution: int = 72

    # --- Policy caps (section 9.3) -------------------------------------------
    max_contacts_per_event: int = 3
    max_messages_per_customer_24h: int = 1
    max_messages_per_customer_7d: int = 5
    max_mandate_retry_attempts: int = 4
    human_approval_threshold_paise: int = 2_500_000  # ₹25,000
    watch_tier_max_incentive_bps: int = 500  # half of the standard 10% ceiling

    # --- Farming detection (section 4.5) -------------------------------------
    farming_watch_threshold: float = 0.35
    farming_flagged_threshold: float = 0.65
    farming_min_observed_checkouts: int = 8

    # --- Sim clock / bootstrap (sections 8.3, 6.6) ---------------------------
    default_sim_speed: int = 2880  # 1 sim day per 30 real seconds
    warmup_sim_days: int = 60
    epsilon_exploration_rate: float = 0.08

    # --- Retry timing (section 4.6) ------------------------------------------
    retry_scheduled_max_days: int = 7
    bank_downtime_retry_delay_hours: int = 4
    issuer_declined_retry_delay_hours: int = 48

    # --- Metrics stream throttle (section 8.5) --------------------------------
    metrics_tick_max_per_second: int = 4


settings = Settings()
